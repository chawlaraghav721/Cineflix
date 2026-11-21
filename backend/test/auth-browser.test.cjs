"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { chromium } = require("playwright");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");
const { loadAuthConfig } = require("../src/config/auth");
const { seedCatalogue } = require("../src/scripts/seedCatalogue");
const User = require("../src/models/User");

const executable = process.env.CINEFLIX_CHROME_PATH || chromium.executablePath();

test("browser accounts, cookies, cross-tab logout and refresh persistence with isolated MongoDB", {
    skip: !existsSync(executable) && "Install Playwright Chromium or set CINEFLIX_CHROME_PATH.", timeout: 60000
}, async t => {
    const mongo = await MongoMemoryServer.create();
    t.after(async () => { await disconnectDatabase(); await mongo.stop(); });
    await connectDatabase(mongo.getUri());
    await User.createIndexes();
    await seedCatalogue();
    await disconnectDatabase();
    t.diagnostic("Isolated database and catalogue prepared.");
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const origin = "http://127.0.0.1:" + port;
    const authConfig = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("hex"), APP_ORIGIN: origin });
    let backend;
    async function startBackend() {
        backend = spawn(process.execPath, [path.resolve(__dirname, "../src/server.js")], {
            env: { ...process.env, NODE_ENV: "test", PORT: String(port), APP_ORIGIN: origin,
                JWT_SECRET: authConfig.secret, MONGODB_URI: mongo.getUri() }, stdio: ["ignore", "pipe", "pipe"]
        });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Backend test process startup timed out.")), 10000);
            backend.once("error", () => { clearTimeout(timer); reject(new Error("Backend test process could not start.")); });
            backend.once("exit", () => { clearTimeout(timer); reject(new Error("Backend test process stopped before listening.")); });
            backend.stdout.on("data", chunk => { if (chunk.toString().includes("listening on port")) { clearTimeout(timer); resolve(); } });
            backend.stderr.on("data", () => {}); // Never print environment values or database error details.
        });
    }
    async function stopBackend() {
        if (!backend || backend.exitCode !== null) return;
        const processToStop = backend;
        await new Promise(resolve => {
            const timer = setTimeout(() => processToStop.kill("SIGKILL"), 5000);
            processToStop.once("exit", () => { clearTimeout(timer); resolve(); });
            processToStop.kill("SIGTERM");
        });
    }
    t.after(stopBackend);
    await startBackend();
    t.diagnostic("Shared server process started.");
    const browser = await chromium.launch({ headless: true, executablePath: executable });
    t.after(() => browser.close());
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    t.after(async () => { await contextA.close(); await contextB.close(); });
    const errors = [];
    const password = "a safe browser test password";
    const emailA = "browser-a@example.test", emailB = "browser-b@example.test";
    for (const context of [contextA, contextB]) {
        await context.route("https://**/*", route => route.abort());
        context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    }
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    await a.goto(origin + "/login.html");
    await a.locator("#email").fill("unregistered@example.test");
    await a.locator("#password").fill(password);
    await a.locator("#auth-submit").click();
    await a.waitForFunction(() => document.querySelector("#login-feedback").textContent.includes("User does not exist"));
    assert.equal(await a.locator("#email").getAttribute("aria-invalid"), "true");
    assert.equal(await a.locator("#login-feedback").getAttribute("data-state"), "error");
    assert.equal(await a.locator("#auth-toggle").isVisible(), true);
    if (process.env.CINEFLIX_AUTH_SCREENSHOTS) {
        mkdirSync(process.env.CINEFLIX_AUTH_SCREENSHOTS, { recursive: true });
        await a.screenshot({ path: path.join(process.env.CINEFLIX_AUTH_SCREENSHOTS, "unknown-account.png"), fullPage: true });
    }
    t.diagnostic("Unknown accounts show an actionable sign-in error.");
    async function signup(page, name, email) {
        await page.goto(origin + "/login.html?mode=register");
        await page.locator("#registration-name:not([hidden])").waitFor();
        await page.locator("#name").fill(name);
        await page.locator("#email").fill(email);
        await page.locator("#password").fill(password);
        await page.locator("#auth-submit").click();
        await page.locator("#account-panel:not([hidden])").waitFor();
        await page.waitForFunction(() => document.querySelector(".login-link").textContent === "My Account");
    }
    await signup(a, "<script>viewer</script>", emailA);
    t.diagnostic("Initial account registration and cookie login passed.");
    assert.match(await a.locator("#account-message").textContent(), /<script>viewer<\/script>/);
    assert.equal(await a.locator("#account-message script").count(), 0);
    assert.equal(await a.locator("#profile-name").textContent(), "<script>viewer</script>");
    assert.equal(await a.locator("#profile-name script").count(), 0);
    await a.waitForFunction(() => document.querySelector("#account-list-count").textContent === "0");
    assert.match(await a.locator("#account-library-status").textContent(), /Explore movies/);
    const storedCookie = (await contextA.cookies()).find(cookie => cookie.name === authConfig.cookieName);
    assert(storedCookie);
    assert.equal(storedCookie.httpOnly, true);
    assert.equal(storedCookie.sameSite, "Strict");
    assert.equal(storedCookie.secure, false);
    assert(storedCookie.expires * 1000 > Date.now());
    assert(!(await a.evaluate(() => document.cookie)).includes(authConfig.cookieName));
    const storage = await a.evaluate(() => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(" "));
    assert(!storage.includes(password)); assert(!storage.includes(emailA)); assert(!storage.includes(storedCookie.value));

    // Restart the actual server process while retaining the isolated test database.
    await stopBackend();
    t.diagnostic("Server stopped for persistence check.");
    await startBackend();
    t.diagnostic("Server restarted against the same isolated database.");
    await a.reload();
    await a.locator("#account-panel:not([hidden])").waitFor();
    assert.match(await a.locator("#account-message").textContent(), /browser-a/);
    await signup(b, "Viewer B", emailB);
    const userA = await contextA.request.get(origin + "/api/auth/me");
    const userB = await contextB.request.get(origin + "/api/auth/me");
    assert.notEqual((await userA.json()).user.id, (await userB.json()).user.id);

    const otherTab = await contextA.newPage();
    await otherTab.goto(origin + "/movies.html");
    await otherTab.getByRole("button", { name: "Sign Out", exact: true }).waitFor();
    await otherTab.getByRole("button", { name: "Sign Out", exact: true }).click();
    await otherTab.waitForURL("**/login.html");
    await a.waitForFunction(() => document.querySelector(".login-link").textContent === "Login");
    assert.equal((await contextA.request.get(origin + "/api/auth/me")).status(), 401);
    assert.equal((await contextB.request.get(origin + "/api/auth/me")).status(), 200);

    await a.locator("#email").fill(emailA);
    await a.locator("#password").fill("wrong password");
    await a.locator("#auth-submit").click();
    await a.waitForFunction(() => document.querySelector("#login-feedback").textContent.includes("incorrect"));
    await a.locator("#password").fill(password);
    await a.locator("#auth-submit").click();
    await a.locator("#account-panel:not([hidden])").waitFor();
    await a.locator("#account-signout").click();
    await a.locator("#login-form:not([hidden])").waitFor();
    await a.locator("#auth-toggle").click();
    await a.locator("#name").fill("Duplicate Viewer");
    await a.locator("#email").fill(emailA);
    await a.locator("#password").fill(password);
    await a.locator("#auth-submit").click();
    await a.waitForFunction(() => document.querySelector("#login-feedback").textContent.includes("already exists"));

    // Exercise the real shared pages and leave their existing feature code intact.
    for (const name of ["index.html", "movies.html", "shows.html", "details.html?id=movie-004", "mylist.html", "movie-night.html"]) {
        await b.goto(origin + "/" + name);
        await b.waitForFunction(() => document.querySelector(".login-link").textContent === "My Account");
    }
    await b.evaluate(() => {
        localStorage.setItem("cineflixMyList", JSON.stringify(["movie-001", "show-001", "missing-id"]));
        localStorage.setItem("cineflixPersonalRatings", JSON.stringify({ "movie-001": 4, "missing-id": 5, "movie-002": 9 }));
    });
    await b.goto(origin + "/login.html");
    await b.locator("#account-panel:not([hidden])").waitFor();
    await b.waitForFunction(() => document.querySelector("#account-list-count").textContent === "0");
    // Guest storage cannot populate the signed-in dashboard. Seed this account through its real API.
    for (const itemId of ["movie-001", "show-001"]) {
        const result = await contextB.request.post(origin + "/api/my-list", { headers: { Origin: origin }, data: { itemId } });
        assert.equal(result.status(), 201);
    }
    await b.reload();
    await b.waitForFunction(() => document.querySelector("#account-list-count").textContent === "2");
    assert.equal(await b.locator("#profile-name").textContent(), "Viewer B");
    assert.equal(await b.locator("#profile-email").textContent(), emailB);
    assert.equal(await b.locator("#account-rating-count").textContent(), "1");
    assert.equal(await b.locator(".account-title-card").count(), 2);
    await b.locator("#account-rated-tab").click();
    await b.waitForFunction(() => document.querySelector("#account-library-grid").getAttribute("aria-busy") === "false");
    assert.equal(await b.locator(".account-title-card").count(), 1);
    assert.match(await b.locator(".account-title-rating").textContent(), /4 \/ 5/);
    await b.locator("#account-saved-tab").click();
    await b.waitForFunction(() => document.querySelectorAll(".account-title-card").length === 2);
    await b.evaluate(() => {
        localStorage.setItem("cineflixMyList", JSON.stringify(["movie-001", "show-001"]));
        window.dispatchEvent(new StorageEvent("storage", { key: "cineflixMyList" }));
    });
    for (const width of [1440, 768, 390, 320]) {
        await b.setViewportSize({ width, height: 1000 });
        assert(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Account layout overflow at " + width);
        if (process.env.CINEFLIX_AUTH_SCREENSHOTS) {
            mkdirSync(process.env.CINEFLIX_AUTH_SCREENSHOTS, { recursive: true });
            await b.evaluate(() => scrollTo(0, 0));
            await b.screenshot({ path: path.join(process.env.CINEFLIX_AUTH_SCREENSHOTS, "account-" + width + ".png"), fullPage: true });
        }
    }

    await b.evaluate(() => {
        localStorage.setItem("cineflixMyList", "not-json");
        localStorage.setItem("cineflixPersonalRatings", "[]");
        window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    await b.waitForFunction(() => document.querySelector("#account-rating-count").textContent === "0");
    assert.equal(await b.locator("#account-list-count").textContent(), "2");
    assert.equal(await b.locator(".account-title-card").count(), 2);

    await b.evaluate(() => {
        window.restoreAccountStorage = Storage.prototype.getItem;
        Storage.prototype.getItem = () => { throw new DOMException("Blocked", "SecurityError"); };
        window.dispatchEvent(new StorageEvent("storage", { key: "cineflixPersonalRatings" }));
    });
    await b.locator("#account-rated-tab").click();
    await b.waitForFunction(() => document.querySelector("#account-library-status").textContent.includes("Enable browser storage"));
    assert.equal(await b.locator("#account-list-count").textContent(), "2");
    assert.equal(await b.locator("#account-library-retry").isVisible(), true);
    await b.locator("#account-saved-tab").click();
    await b.waitForFunction(() => document.querySelectorAll(".account-title-card").length === 2);
    await b.evaluate(() => {
        Storage.prototype.getItem = window.restoreAccountStorage;
        delete window.restoreAccountStorage;
        localStorage.setItem("cineflixMyList", '["movie-001","show-001"]');
        localStorage.setItem("cineflixPersonalRatings", '{"movie-001":4}');
    });

    await b.route("**/api/catalogue", route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
    await b.reload();
    await b.waitForFunction(() => document.querySelector("#account-library-status").textContent.includes("couldn't load"));
    assert.equal(await b.locator("#account-library-retry").isVisible(), true);
    assert.equal(await b.evaluate(() => localStorage.getItem("cineflixMyList")), '["movie-001","show-001"]');
    await b.unroute("**/api/catalogue");
    await b.locator("#account-library-retry").click();
    await b.waitForFunction(() => document.querySelector("#account-list-count").textContent === "2");
    t.diagnostic("Account dashboard collections, storage failures, catalogue retry and mobile layouts passed.");
    await b.locator("#account-signout").click();
    await b.locator("#login-form:not([hidden])").waitFor();
    await b.locator("#auth-toggle").click();
    for (const width of [1440, 390, 320]) {
        await b.setViewportSize({ width, height: 1000 });
        assert(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Registration layout overflow at " + width);
        if (process.env.CINEFLIX_AUTH_SCREENSHOTS) await b.screenshot({ path: path.join(process.env.CINEFLIX_AUTH_SCREENSHOTS, "registration-" + width + ".png") });
    }
    assert.deepEqual(errors, []);
});
