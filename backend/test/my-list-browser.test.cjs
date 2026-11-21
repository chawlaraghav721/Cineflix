"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { chromium } = require("playwright");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");
const { seedCatalogue } = require("../src/scripts/seedCatalogue");
const { startBackendProcess } = require("../test-support/movieNightServerProcess.cjs");
const executable = process.env.CINEFLIX_CHROME_PATH || chromium.executablePath();

test("watchlist browser lifecycle with real cookies, MongoDB, account switching and server restart", {
    skip: !existsSync(executable) && "Install Playwright Chromium or set CINEFLIX_CHROME_PATH.", timeout: 120000
}, async t => {
    const mongo = await MongoMemoryServer.create();
    t.after(async () => { await disconnectDatabase(); await mongo.stop(); });
    await connectDatabase(mongo.getUri());
    await seedCatalogue();
    await disconnectDatabase();
    const secret = randomBytes(48).toString("hex");
    let server = await startBackendProcess({ mongoUri: mongo.getUri(), secret });
    t.after(async () => { await server.close(); });
    const browser = await chromium.launch({ headless: true, executablePath: executable });
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    await context.route("https://**/*", route => route.abort());
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    const page = await context.newPage();
    const password = "a safe watchlist browser password";
    const go = url => page.goto(server.origin + "/" + url);
    async function account(email, register = true) {
        await go("login.html" + (register ? "?mode=register" : ""));
        if (register) {
            await page.locator("#registration-name:not([hidden])").waitFor();
            await page.locator("#name").fill("Watchlist Viewer");
        }
        await page.locator("#email").fill(email);
        await page.locator("#password").fill(password);
        await page.locator("#auth-submit").click();
        await page.locator("#account-panel:not([hidden])").waitFor();
    }
    async function add(id) {
        await go("details.html?id=" + id);
        await page.getByRole("button", { name: "Add to My List", exact: true }).click();
        await page.getByRole("button", { name: "Remove from My List", exact: true }).waitFor();
    }
    async function count(number) {
        await page.waitForFunction(n => document.querySelector(".mylist-count")?.textContent === String(n), number);
    }
    async function list(number) {
        await go("mylist.html");
        await page.locator('#mylist-grid[aria-busy="false"]').waitFor();
        assert.equal(await page.locator(".mylist-card").count(), number);
        await count(number);
    }

    await add("show-001"); // Explicit guest-only persistence.
    await list(1);
    assert.match(await page.locator("#mylist-session").textContent(), /Guest list/);
    await account("watchlist-a@example.test");
    await list(0); // No implicit migration into A.
    for (const id of ["movie-004", "movie-011", "show-001"]) await add(id);
    await list(3);
    const first = page.locator('.mylist-card[data-id="movie-004"]');
    await first.locator("select").selectOption("watched");
    await page.waitForFunction(() => document.querySelector('.mylist-card[data-id="movie-004"] select')?.value === "watched" && !document.querySelector('.mylist-card[data-id="movie-004"] select')?.disabled);
    await page.locator("#mylist-filter").selectOption("watched");
    assert.equal(await page.locator(".mylist-card").count(), 1);
    await page.locator("#mylist-filter").selectOption("watching");
    assert.equal(await page.locator(".mylist-card").count(), 0);
    assert.match(await page.locator("#mylist-status").textContent(), /No saved titles/);
    await page.locator("#mylist-filter").selectOption("want-to-watch");
    assert.equal(await page.locator(".mylist-card").count(), 2);
    await page.locator("#mylist-filter").selectOption("all");
    await page.locator("#mylist-search").fill("no matching title");
    assert.equal(await page.locator(".mylist-card").count(), 0);
    await page.locator("#mylist-search").fill("");
    await page.reload();
    await page.locator('#mylist-grid[aria-busy="false"]').waitFor();
    assert.equal(await first.locator("select").inputValue(), "watched");
    await go("login.html");
    await page.waitForFunction(() => document.querySelector("#account-list-count").textContent === "3");
    assert.equal(await page.locator(".account-title-card").count(), 3);

    const port = server.port;
    await server.close();
    server = await startBackendProcess({ mongoUri: mongo.getUri(), secret, port });
    await list(3);
    assert.equal(await first.locator("select").inputValue(), "watched");
    t.diagnostic("Guest isolation, three saved titles, status filters, dashboard and server restart passed.");

    const tab = await context.newPage();
    await tab.goto(server.origin + "/details.html?id=movie-011");
    await tab.getByRole("button", { name: "Remove from My List", exact: true }).click();
    await tab.getByRole("button", { name: "Add to My List", exact: true }).waitFor();
    await count(2);
    await page.waitForFunction(() => document.querySelectorAll(".mylist-card").length === 2);
    await tab.close();
    await page.evaluate(() => window.CineFlixAuth.logout());
    await page.waitForFunction(() => document.querySelector("#mylist-session").textContent.includes("Guest list"));
    await count(1);
    await account("watchlist-b@example.test");
    await list(0);
    await add("movie-012");
    await list(1);
    await page.evaluate(() => window.CineFlixAuth.logout());
    await account("watchlist-a@example.test", false);
    await list(2);
    assert.equal(await first.locator("select").inputValue(), "watched");
    t.diagnostic("Cross-tab removal and A → guest → B → A account isolation passed.");

    await page.route("**/api/my-list", route => route.request().method() === "GET"
        ? route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"message":"private error"}}' }) : route.continue());
    await page.reload();
    await page.locator("#mylist-retry:not([hidden])").waitFor();
    assert.equal(await page.locator(".mylist-card").count(), 0);
    assert.match(await page.locator("#mylist-error").textContent(), /temporarily unavailable/);
    await page.waitForFunction(() => document.querySelector(".mylist-count").getAttribute("aria-label") === "Saved title count unavailable");
    await page.unroute("**/api/my-list");
    await page.locator("#mylist-retry").click();
    await count(2);
    await page.locator('#mylist-grid[aria-busy="false"]').waitFor();
    await page.route("**/api/my-list/movie-004", route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
    await first.locator("select").selectOption("watching");
    await page.waitForFunction(() => document.querySelector("#mylist-error").textContent.includes("temporarily unavailable"));
    assert.equal(await first.locator("select").inputValue(), "watched");
    await page.unroute("**/api/my-list/movie-004");

    for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "My List overflow at " + width);
        if (process.env.CINEFLIX_MYLIST_SCREENSHOTS) {
            mkdirSync(process.env.CINEFLIX_MYLIST_SCREENSHOTS, { recursive: true });
            await page.screenshot({ path: path.join(process.env.CINEFLIX_MYLIST_SCREENSHOTS, "my-list-" + width + ".png"), fullPage: true });
        }
    }
    page.on("dialog", dialog => dialog.accept());
    await page.locator("#mylist-clear").click();
    await count(0);
    await page.waitForFunction(() => document.querySelector("#mylist-status").textContent.includes("empty"));
    await page.reload();
    await count(0);
    await page.evaluate(() => window.CineFlixAuth.logout());
    await account("watchlist-b@example.test", false);
    await list(1); // A's clear did not affect B.
    assert.deepEqual(errors, []);
});
