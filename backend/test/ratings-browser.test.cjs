"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
const { ratingsFixture } = require("../test-support/ratingsIntegration.cjs");
const { startBackendProcess } = require("../test-support/movieNightServerProcess.cjs");
const executable = process.env.CINEFLIX_CHROME_PATH || chromium.executablePath();

test("Details ratings in a real browser with isolated MongoDB and the shared server", {
    skip: !existsSync(executable) && "Install Chromium or set CINEFLIX_CHROME_PATH.", timeout: 120000
}, async t => {
    const f = await ratingsFixture(t);
    let server = await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret });
    t.after(async () => { await server.close(); });
    const browser = await chromium.launch({ headless: true, executablePath: executable });
    t.after(() => browser.close());
    const a = await browser.newContext(), b = await browser.newContext(), guest = await browser.newContext();
    t.after(async () => { await Promise.all([a.close(), b.close(), guest.close()]); });
    const errors = [];
    for (const context of [a, b, guest]) {
        await context.route("https://**/*", route => route.abort());
        context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    }
    const page = await a.newPage(), other = await b.newPage(), demo = await guest.newPage();
    const password = "a private ratings browser password";
    const details = () => server.origin + "/details.html?id=movie-004";
    const ownPattern = "**/api/ratings/movie-004/me";
    const saved = async (p, score) => p.waitForFunction(value => {
        const message = document.getElementById("rating-message").textContent;
        return message.includes(value + " out of 5") && message.includes("saved") && document.querySelector(".personal-rating").getAttribute("aria-busy") === "false";
    }, score);
    const ready = p => p.waitForFunction(() => document.querySelector('.rating-stars button[data-rating="1"]')?.disabled === false);
    async function signup(p, email) {
        await p.goto(server.origin + "/login.html?mode=register");
        await p.locator("#registration-name:not([hidden])").waitFor();
        await p.locator("#name").fill("Ratings Viewer"); await p.locator("#email").fill(email);
        await p.locator("#password").fill(password); await p.locator("#auth-submit").click();
        await p.locator("#account-panel:not([hidden])").waitFor();
    }

    await t.test("guest storage stays separate when signing in, account review saves and survives reload", async () => {
        await page.goto(details()); await ready(page);
        await page.locator('[data-rating="2"]').click();
        assert.equal(await page.locator("#ratings-account").isVisible(), false);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cineflixPersonalRatings"))["movie-004"]), 2);
        await signup(page, "ratings-browser-a@example.test");
        await page.goto(details()); await ready(page);
        assert.match(await page.locator("#rating-message").textContent(), /No account rating/);
        assert.equal(await page.locator('[aria-pressed="true"][data-rating]').count(), 0);
        await page.locator('[data-rating="5"]').click(); await saved(page, 5);
        await page.locator("#rating-review").fill("<img src=x onerror=alert(1)> A thoughtful film.");
        await page.locator("#save-review").click(); await saved(page, 5);
        await page.waitForFunction(() => document.getElementById("ratings-reviews").textContent.includes("thoughtful"));
        assert.equal(await page.locator("#ratings-reviews img").count(), 0);
        assert.match(await page.locator("#details-meta").textContent(), /8.1\/10/);
        await page.reload(); await saved(page, 5);
        assert.match(await page.locator("#rating-review").inputValue(), /thoughtful/);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cineflixPersonalRatings"))["movie-004"]), 2);
        await page.goto(server.origin + "/login.html");
        await page.waitForFunction(() => document.getElementById("account-rating-count").textContent === "1");
        assert.equal(await page.locator("#account-rated-tab").textContent(), "Guest ratings");
        await page.locator("#account-rated-tab").click();
        await page.waitForFunction(() => document.querySelector(".account-title-rating")?.textContent.includes("2 / 5"));
        assert.equal(await page.locator("#account-library-title").textContent(), "Guest ratings on this device");
        assert.match(await page.locator(".account-settings").textContent(), /Account ratings and reviews are saved to your account/);
        await page.goto(details()); await saved(page, 5);
    });

    await t.test("editing, two accounts and public averages use persisted records", async () => {
        await page.locator('[data-rating="4"]').click(); await saved(page, 4);
        await page.locator("#rating-review").fill("Edited review A"); await page.locator("#save-review").click(); await saved(page, 4);
        await signup(other, "ratings-browser-b@example.test"); await other.goto(details()); await ready(other);
        assert.equal(await other.locator("#rating-review").inputValue(), "");
        await other.locator('[data-rating="2"]').click(); await saved(other, 2);
        await other.locator("#rating-review").fill("Review B"); await other.locator("#save-review").click(); await saved(other, 2);
        await page.locator("#retry-ratings").click(); await saved(page, 4);
        await page.waitForFunction(() => document.getElementById("ratings-summary").textContent.includes("3.0 out of 5 · 2 ratings"));
        assert.equal(await page.locator("#rating-review").inputValue(), "Edited review A");
        assert.equal(await f.Rating.countDocuments({ itemId: "movie-004" }), 2);
    });

    await t.test("database records survive restarting the actual backend process", async () => {
        const port = server.port; await server.close();
        server = await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret, port });
        await page.reload(); await saved(page, 4);
        assert.equal(await page.locator("#rating-review").inputValue(), "Edited review A");
    });

    await t.test("failed reads and uncertain writes offer retry and preserve guest data", async () => {
        await page.route(ownPattern, route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"code":"UNAVAILABLE"}}' }));
        await page.locator("#retry-ratings").click();
        await page.waitForFunction(() => document.getElementById("rating-message").textContent.includes("could not be loaded"));
        assert.equal(await page.locator('[data-rating="5"]').isDisabled(), true);
        await page.unroute(ownPattern); await page.locator("#retry-ratings").click(); await saved(page, 4);
        await page.route(ownPattern, route => route.request().method() === "PUT" ? route.abort() : route.continue());
        await page.locator('[data-rating="5"]').click();
        await page.waitForFunction(() => document.getElementById("rating-message").textContent.includes("Unable to confirm"));
        assert.equal(await page.locator('[data-rating="5"]').isDisabled(), true);
        await page.unroute(ownPattern); await page.locator("#retry-ratings").click(); await saved(page, 4);
        await page.route("**/api/ratings/movie-004", route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
        await page.locator('[data-rating="5"]').click(); await saved(page, 5);
        await page.waitForFunction(() => document.getElementById("ratings-summary").textContent.includes("Your change was saved"));
        await page.unroute("**/api/ratings/movie-004"); await page.locator("#retry-ratings").click(); await saved(page, 5);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cineflixPersonalRatings"))["movie-004"]), 2);
    });

    await t.test("desktop and mobile layouts keep controls visible without horizontal overflow", async () => {
        for (const width of [1440, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
                buttons: [...document.querySelectorAll(".rating-stars button")].map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })) }));
            assert(layout.scroll <= layout.width, JSON.stringify(layout));
            assert(layout.buttons.every(button => button.width >= 44 && button.height >= 44));
            const screenshot = path.join(os.tmpdir(), `cineflix-ratings-${width}.png`);
            await page.locator(".personal-rating").screenshot({ path: screenshot });
            t.diagnostic(`Visual evidence: ${screenshot}`);
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
    });

    await t.test("stale private responses cannot survive logout or switching accounts in another tab", async () => {
        let release, entered, finished;
        const gate = new Promise(resolve => { release = resolve; });
        const intercepted = new Promise(resolve => { entered = resolve; });
        const fulfilled = new Promise(resolve => { finished = resolve; });
        let held = false;
        await page.route(ownPattern, async route => {
            if (route.request().method() !== "GET" || held) return route.continue();
            held = true;
            const response = await route.fetch(); entered(); await gate; await route.fulfill({ response }); finished();
        });
        await page.locator("#retry-ratings").click(); await intercepted;
        const tab = await a.newPage(); await tab.goto(server.origin + "/login.html");
        await tab.evaluate(() => window.CineFlixAuth.logout());
        await page.waitForFunction(() => document.getElementById("ratings-mode-note").textContent.includes("Guest rating"));
        release(); await fulfilled; await page.unroute(ownPattern);
        assert.equal(await page.locator("#ratings-account").isVisible(), false);
        assert.equal(await page.locator("#rating-review").inputValue(), "");
        assert.equal(await page.locator('[data-rating="2"]').getAttribute("aria-pressed"), "true");
        await tab.evaluate(values => window.CineFlixAuth.login(values), { email: "ratings-browser-b@example.test", password });
        await saved(page, 2);
        assert.equal(await page.locator("#rating-review").inputValue(), "Review B");
        await tab.close();
    });

    await t.test("expired cookie refuses writes and deletion removes only the signed-in account", async () => {
        await b.clearCookies();
        await other.locator('[data-rating="1"]').click();
        await other.waitForFunction(() => document.getElementById("ratings-account").hidden);
        assert.equal((await f.Rating.findOne({ itemId: "movie-004", score: 2 }).lean()).reviewText, "Review B");
        await page.locator("#clear-rating").click();
        await page.waitForFunction(() => document.getElementById("rating-message").textContent.includes("were removed"));
        await page.waitForFunction(() => document.getElementById("ratings-summary").textContent.includes("5.0 out of 5 · 1 rating"));
        assert.equal(await page.locator("#rating-review").inputValue(), "");
        await demo.goto(details()); await ready(demo);
        assert.match(await demo.locator("#ratings-reviews").textContent(), /Edited review A/);
        assert.equal(await demo.locator("#ratings-account").isVisible(), false);
        assert.equal(await f.Rating.countDocuments({ itemId: "movie-004" }), 1);
    });
    assert.deepEqual(errors, []);
});
