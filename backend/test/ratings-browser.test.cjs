"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { ratingsBrowser, browserSkip } = require("../test-support/ratingsBrowser.cjs");

test("Details account ratings reviews and persistence in real Chrome", { skip: browserSkip, timeout: 90000 }, async t => {
    const f = await ratingsBrowser(t), a = await f.page(), b = await f.page();
    const details = f.origin + "/details.html?id=movie-004";
    await t.test("guest scores stay separate while account ratings and safe written reviews survive reload", async () => {
        await a.goto(details); await f.ready(a); await a.locator('[data-rating="2"]').click();
        assert.equal(await a.locator("#rating-editor").isVisible(), false);
        await f.register(a, "ratings-a@example.test"); await a.goto(details); await f.ready(a);
        assert.equal(await a.locator('[data-rating][aria-pressed="true"]').count(), 0);
        await f.save(a, 5, '<img src=x onerror="window.reviewExecuted=true"> A review');
        assert.equal(await a.locator("#community-reviews img").count(), 0);
        assert.match(await a.locator("#community-reviews").textContent(), /<img/);
        assert.equal(await a.evaluate(() => Boolean(window.reviewExecuted)), false);
        await a.reload(); await f.saved(a, 5);
        assert.match(await a.locator("#rating-review").inputValue(), /A review/);
        assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem("cineflixPersonalRatings"))["movie-004"]), 2);
        assert.match(await a.locator("#details-meta").textContent(), /8.1\/10/);
    });
    await t.test("editing clearing written text and independent accounts update actual averages", async () => {
        await f.save(a, 4, "Edited A");
        await f.register(b, "ratings-b@example.test"); await b.goto(details); await f.ready(b);
        assert.equal(await b.locator("#rating-review").inputValue(), "");
        await f.save(b, 2, "B review");
        await a.locator("#refresh-ratings").click(); await f.saved(a, 4);
        await a.waitForFunction(() => document.getElementById("rating-summary").textContent.includes("3.0 out of 5 · 2 ratings"));
        await f.save(a, 4, "");
        assert.equal(await a.locator("#community-reviews li").count(), 1);
        await f.save(a, 4, "Edited A");
        assert.equal(await f.Rating.countDocuments({ itemId: "movie-004" }), 2);
    });
    await t.test("actual backend restart retains the account rating and review", async () => {
        await f.restart(); await a.reload(); await f.saved(a, 4);
        assert.equal(await a.locator("#rating-review").inputValue(), "Edited A");
    });
    await t.test("keyboard selection desktop and mobile layout and own deletion", async () => {
        await a.locator('[data-rating="5"]').focus(); await a.keyboard.press("Enter");
        assert.equal(await a.locator('[data-rating="5"]').getAttribute("aria-pressed"), "true");
        await a.locator("#save-rating").focus(); await a.keyboard.press("Enter"); await f.saved(a, 5);
        for (const width of [1440, 390, 320]) {
            await a.setViewportSize({ width, height: 1000 });
            assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
            const target = path.join(os.tmpdir(), `cineflix-account-ratings-${width}.png`);
            await a.screenshot({ path: target, fullPage: true }); t.diagnostic("Screenshot: " + target);
        }
        await a.locator("#clear-rating").click();
        await a.waitForFunction(() => document.getElementById("rating-message").textContent.includes("were removed"));
        await a.waitForFunction(() => document.getElementById("rating-summary").textContent.includes("2.0 out of 5 · 1 rating"));
        assert.equal(await a.locator("#rating-review").inputValue(), "");
        assert.equal(await f.Rating.countDocuments({ itemId: "movie-004" }), 1);
    });
    assert.deepEqual(f.errors, []);
});
