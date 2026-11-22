"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ratingsBrowser, browserSkip } = require("../test-support/ratingsBrowser.cjs");

test("account dashboard ratings coexist with authenticated My List", { skip: browserSkip, timeout: 90000 }, async t => {
    const f = await ratingsBrowser(t), a = await f.page(), b = await f.page();
    await f.register(a, "dashboard-a@example.test");
    await f.register(b, "dashboard-b@example.test");
    async function seed(page, itemId, score) {
        const result = await page.context().request.put(`${f.origin}/api/ratings/${itemId}/me`, { headers: { Origin: f.origin }, data: { score } });
        assert.equal(result.status(), 200);
    }
    await seed(a, "movie-004", 5); await seed(a, "show-001", 3); await seed(b, "movie-005", 1);
    const listed = await a.context().request.post(f.origin + "/api/my-list", { headers: { Origin: f.origin }, data: { itemId: "movie-004", status: "watching" } });
    assert.equal(listed.status(), 201);
    await t.test("counts titles and badges reflect database ratings while guest storage stays untouched", async () => {
        await a.evaluate(() => localStorage.setItem("cineflixPersonalRatings", '{"movie-005":2,"movie-004":1}'));
        await a.reload(); await a.waitForFunction(() => document.getElementById("account-rating-count").textContent === "2");
        assert.equal(await a.locator("#account-list-count").textContent(), "1");
        assert.match(await a.locator(".account-title-rating").textContent(), /5 \/ 5/);
        await a.locator("#account-rated-tab").click();
        await a.waitForFunction(() => document.querySelectorAll(".account-title-card").length === 2);
        assert.equal(await a.locator(".account-title-card").first().getAttribute("href"), "details.html?id=movie-004");
        assert.equal(await a.locator('a[href="details.html?id=movie-005"].account-title-card').count(), 0);
        assert.equal(await a.evaluate(() => localStorage.getItem("cineflixPersonalRatings")), '{"movie-005":2,"movie-004":1}');
        await b.reload(); await b.waitForFunction(() => document.getElementById("account-rating-count").textContent === "1");
        assert.equal(await b.locator("#account-list-count").textContent(), "0");
    });
    await t.test("ratings API failure never hides a healthy watchlist and retry restores real ratings", async () => {
        await a.route("**/api/ratings", route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
        await a.locator("#account-rated-tab").click();
        await a.waitForFunction(() => document.getElementById("account-library-status").textContent.includes("account ratings could not be loaded"));
        assert.equal(await a.locator("#account-rating-count").textContent(), "—");
        assert.equal(await a.locator("#account-list-count").textContent(), "1");
        assert.equal(await a.locator(".account-title-card").count(), 0);
        await a.locator("#account-saved-tab").click();
        await a.waitForFunction(() => document.querySelectorAll(".account-title-card").length === 1);
        await a.unroute("**/api/ratings"); await a.locator("#account-library-retry").click();
        await a.waitForFunction(() => document.getElementById("account-rating-count").textContent === "2");
        assert.equal(await a.locator("#account-list-count").textContent(), "1");
    });
    await t.test("account switching replaces ratings and preserves separate account watchlists", async () => {
        await a.evaluate(() => window.CineFlixAuth.logout());
        await a.evaluate(values => window.CineFlixAuth.login(values), { email: "dashboard-b@example.test", password: f.password });
        await a.waitForFunction(() => document.getElementById("account-rating-count").textContent === "1");
        await a.locator("#account-rated-tab").click();
        await a.waitForFunction(() => document.querySelectorAll(".account-title-card").length === 1);
        assert.equal(await a.locator(".account-title-card").getAttribute("href"), "details.html?id=movie-005");
        assert.equal(await a.locator("#account-list-count").textContent(), "0");
    });
    assert.deepEqual(f.errors, []);
});
