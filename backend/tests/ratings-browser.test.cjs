"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
let playwright;
let express;
if (process.env.CINEFLIX_PLAYWRIGHT_PATH && process.env.CINEFLIX_EXPRESS_PATH) {
    playwright = require(process.env.CINEFLIX_PLAYWRIGHT_PATH);
    express = require(process.env.CINEFLIX_EXPRESS_PATH);
}

test("Chrome Details guest/account journeys at desktop/mobile widths (fixture APIs)", { skip: !playwright }, async t => {
    const root = path.resolve(__dirname, "../..");
    const app = express();
    app.use(express.static(root)); // Test-only local hosting, not a production app.
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await playwright.chromium.launch({ headless: true,
        ...(process.env.CINEFLIX_CHROME_PATH ? { executablePath: process.env.CINEFLIX_CHROME_PATH } : {}) });
    t.after(() => browser.close());
    const url = "http://127.0.0.1:" + server.address().port + "/details.html?id=movie-004";
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**/*", route => route.abort()); // External posters/trailers not under test.
    await page.goto(url);
    await page.locator('.personal-rating:not([hidden])').waitFor();
    await page.locator('[data-rating="4"]').click();
    assert.match(await page.locator("#rating-message").textContent(), /4 out of 5/);
    assert.equal(await page.locator("#ratings-account").isVisible(), false);

    // Intercept activation and account endpoints only inside this browser test.
    let user = "alice";
    let failWrite = false;
    const rows = new Map();
    await page.route("**/details.html?*", route => route.fulfill({ contentType: "text/html",
        body: fs.readFileSync(path.join(root, "details.html"), "utf8").replace('data-ratings-mode="guest"', 'data-ratings-mode="account"') }));
    await page.route("**/api/**", async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        let data;
        let status = 200;
        if (pathname === "/api/auth/me") {
            data = user ? { user: { id: user } } : { error: { code: "AUTH_REQUIRED", message: "Sign in." } };
            if (!user) status = 401;
        } else if (pathname.endsWith("/me")) {
            if (!user) { status = 401; data = {}; }
            else if (request.method() === "PUT") {
                if (failWrite) { status = 500; data = {}; }
                else { data = request.postDataJSON(); rows.set(user, data); }
            } else if (request.method() === "DELETE") { rows.delete(user); status = 204; }
            else data = { rating: rows.get(user) || null };
        } else {
            const ratings = [...rows.values()];
            data = { average: ratings.length ? ratings.reduce((total, value) => total + value.score, 0) / ratings.length : null,
                count: ratings.length, reviews: ratings.filter(value => value.reviewText) };
        }
        await route.fulfill({ status, ...(status === 204 ? {} : { json: data }) });
    });
    await page.reload();
    await page.locator('[data-rating="5"]:enabled').waitFor();
    assert.equal(await page.locator('[aria-pressed="true"]').count(), 0); // Guest 4 never merged.
    await page.locator("#rating-review").fill("<script>window.reviewExecuted=true</script> Great film!");
    await page.locator('[data-rating="5"]').click();
    await page.waitForFunction(() => document.querySelector("#rating-message").textContent.includes("saved"));
    assert.equal(await page.evaluate(() => window.reviewExecuted), undefined);
    assert.match(await page.locator("#ratings-reviews").textContent(), /<script>/);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-rating="5"]').getAttribute("aria-pressed") === "true");
    user = "bob";
    await page.evaluate(() => window.dispatchEvent(new Event("cineflix:session-updated")));
    await page.locator('[data-rating="1"]:enabled').waitFor();
    assert.equal(await page.locator("#rating-review").inputValue(), "");
    await page.locator('[data-rating="1"]').click();
    await page.waitForFunction(() => document.querySelector("#ratings-summary").textContent.includes("3.0 out of 5"));
    failWrite = true;
    await page.locator('[data-rating="3"]').click();
    await page.waitForFunction(() => document.querySelector("#rating-message").textContent.includes("Unable to confirm"));
    assert.equal(await page.locator('[data-rating="1"]').getAttribute("aria-pressed"), "true");
    failWrite = false;
    await page.locator("#retry-ratings").click();
    await page.locator('[data-rating="1"]:enabled').waitFor();
    const evidence = process.env.CINEFLIX_RATINGS_SCREENSHOTS;
    for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Horizontal overflow at " + width);
        assert(await page.locator("#ratings-account").isVisible());
        if (evidence) {
            fs.mkdirSync(evidence, { recursive: true });
            await page.screenshot({ path: path.join(evidence, "ratings-" + width + ".png"), fullPage: true });
        }
    }
    await page.locator("#clear-rating").click();
    await page.waitForFunction(() => document.querySelector("#ratings-summary").textContent.includes("5.0 out of 5"));
    assert(rows.has("alice"));
    assert(!rows.has("bob"));
    user = null;
    await page.evaluate(() => window.dispatchEvent(new Event("cineflix:session-updated")));
    await page.waitForFunction(() => document.querySelector("#rating-message").textContent.includes("Sign in"));
    assert.equal(await page.locator(".rating-stars button:enabled").count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cineflixPersonalRatings"))["movie-004"]), 4);
    assert.deepEqual(errors, []);
});
