"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ratingsBrowser, browserSkip } = require("../test-support/ratingsBrowser.cjs");

test("ratings recover from network errors and reject stale private session responses", { skip: browserSkip, timeout: 120000 }, async t => {
    const f = await ratingsBrowser(t), page = await f.page(), b = await f.page();
    await f.register(page, "recovery-a@example.test"); await f.register(b, "recovery-b@example.test");
    const details = f.origin + "/details.html?id=movie-004", own = "**/api/ratings/movie-004/me";
    async function seed(p, itemId, score, reviewText) {
        const result = await p.context().request.put(`${f.origin}/api/ratings/${itemId}/me`, { headers: { Origin: f.origin }, data: { score, reviewText } });
        assert.equal(result.status(), 200);
    }
    await seed(page, "movie-004", 5, "Private A editor"); await seed(page, "show-001", 3, "A show");
    await seed(b, "movie-004", 2, "Private B editor");
    await page.evaluate(() => localStorage.setItem("cineflixPersonalRatings", '{"movie-004":3}'));
    await page.goto(details); await f.saved(page, 5);

    await t.test("failed private reads disable writes and retry reads MongoDB instead of guest data", async () => {
        await page.route(own, route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
        await page.locator("#refresh-ratings").click();
        await page.waitForFunction(() => document.getElementById("rating-message").textContent.includes("temporarily unavailable"));
        assert.equal(await page.locator('[data-rating="1"]').isDisabled(), true);
        assert.equal(await page.locator("#rating-review").inputValue(), "");
        await page.unroute(own); await page.locator("#refresh-ratings").click(); await f.saved(page, 5);
    });

    await t.test("a lost successful write response requires reload before another save", async () => {
        await page.route(own, async route => {
            if (route.request().method() !== "PUT") return route.continue();
            const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort();
        });
        await page.locator('[data-rating="4"]').click(); await page.locator("#rating-review").fill("Committed but lost response");
        await page.locator("#save-rating").click();
        await page.waitForFunction(() => document.getElementById("rating-message").textContent.includes("Unable to reach ratings"));
        assert.equal(await page.locator("#save-rating").isDisabled(), true);
        await page.unroute(own); await page.locator("#refresh-ratings").click(); await f.saved(page, 4);
        assert.equal(await page.locator("#rating-review").inputValue(), "Committed but lost response");
        assert.equal(await page.evaluate(() => localStorage.getItem("cineflixPersonalRatings")), '{"movie-004":3}');
    });

    await t.test("summary failures preserve successful writes and auth failures do not activate guest fallback", async () => {
        await page.route("**/api/ratings/movie-004", route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
        await f.save(page, 5, "Private A editor");
        assert.match(await page.locator("#rating-summary").textContent(), /Your change was saved/);
        await page.unroute("**/api/ratings/movie-004");
        await page.route("**/api/auth/me", route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
        await page.locator("#refresh-ratings").click();
        await page.waitForFunction(() => document.getElementById("rating-mode").textContent.includes("could not be checked"));
        assert.equal(await page.locator('[data-rating]:disabled').count(), 5);
        assert.equal(await page.locator("#rating-review").inputValue(), "");
        await page.unroute("**/api/auth/me"); await page.locator("#refresh-ratings").click(); await f.saved(page, 5);
    });

    async function holdNext(pattern, action) {
        let entered, release, finished, held = false;
        const intercepted = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const fulfilled = new Promise(resolve => { finished = resolve; });
        await page.route(pattern, async route => {
            if (held || route.request().method() !== "GET") return route.continue();
            held = true;
            const response = await route.fetch(); entered(); await gate;
            await route.fulfill({ response }); finished();
        });
        await action(); await intercepted;
        return async () => { release(); await fulfilled; await page.unroute(pattern); };
    }
    const tab = await page.context().newPage(); await tab.goto(f.origin + "/login.html");
    async function login(email) { await tab.evaluate(values => window.CineFlixAuth.login(values), { email, password: f.password }); }
    await t.test("delayed Details data from an old account cannot replace the new account editor", async () => {
        const release = await holdNext(own, () => page.locator("#refresh-ratings").click());
        await tab.evaluate(() => window.CineFlixAuth.logout());
        await page.waitForFunction(() => document.getElementById("rating-mode").textContent.includes("Guest rating"));
        assert.equal(await page.locator("#rating-review").inputValue(), "");
        await login("recovery-b@example.test"); await f.saved(page, 2);
        await release();
        assert.equal(await page.locator("#rating-review").inputValue(), "Private B editor");
    });
    await t.test("delayed dashboard collections cannot restore another account's count or rated titles", async () => {
        await login("recovery-a@example.test"); await page.goto(f.origin + "/login.html");
        await page.waitForFunction(() => document.getElementById("account-rating-count").textContent === "2");
        const release = await holdNext("**/api/ratings", () => page.locator("#account-rated-tab").click());
        await login("recovery-b@example.test");
        await page.waitForFunction(() => document.getElementById("account-rating-count").textContent === "1");
        await release();
        assert.equal(await page.locator("#account-rating-count").textContent(), "1");
        assert.equal(await page.locator('a[href="details.html?id=show-001"].account-title-card').count(), 0);
        assert.match(await page.locator(".account-title-rating").textContent(), /2 \/ 5/);
    });
    await t.test("expired browser cookies clear private controls and cannot mutate account records", async () => {
        await page.goto(details); await f.saved(page, 2); await page.context().clearCookies();
        await page.locator('[data-rating="1"]').click(); await page.locator("#save-rating").click();
        await page.waitForFunction(() => document.getElementById("rating-mode").textContent.includes("Guest rating"));
        assert.equal(await page.locator("#rating-review").inputValue(), "");
        assert.equal(await page.locator('[data-rating="3"]').getAttribute("aria-pressed"), "true");
        assert.equal(await f.Rating.countDocuments({ itemId: "movie-004", score: 2 }), 1);
    });
    assert.deepEqual(f.errors, []);
});
