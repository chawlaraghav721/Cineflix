"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ratingsBrowser, browserSkip } = require("../test-support/ratingsBrowser.cjs");

test("missing ratings assets cannot silently turn an account rating into guest storage", { skip: browserSkip, timeout: 60000 }, async t => {
    const f = await ratingsBrowser(t), page = await f.page();
    await f.register(page, "ratings-assets@example.test");
    await page.evaluate(() => localStorage.setItem("cineflixPersonalRatings", '{"movie-004":2}'));
    for (const file of ["ratings-api.js", "ratings-account.js"]) {
        const pattern = "**/js/" + file;
        await page.route(pattern, route => route.abort());
        await page.goto(f.origin + "/details.html?id=movie-004");
        await page.waitForFunction(() => document.getElementById("rating-message").textContent.includes("controls could not be loaded"));
        assert.equal(await page.locator('[data-rating]:disabled').count(), 5);
        assert.equal(await page.locator("#clear-rating").isDisabled(), true);
        assert.equal(await page.locator("#details-content").isVisible(), true);
        assert.equal(await page.evaluate(() => localStorage.getItem("cineflixPersonalRatings")), '{"movie-004":2}');
        await page.unroute(pattern);
    }
    await page.reload(); await f.ready(page);
    assert.match(await page.locator("#rating-message").textContent(), /No account rating/);
    assert.deepEqual(f.errors, []);
});
