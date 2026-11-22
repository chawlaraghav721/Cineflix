"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { ratingsHttp } = require("../test-support/ratingsHttp.cjs");
const Title = require("../src/models/Title");
const User = require("../src/models/User");

test("ratings HTTP contracts on the shared app with real MongoDB and cookie accounts", { timeout: 60000 }, async t => {
    const f = await ratingsHttp(t), a = await f.account(), b = await f.account();
    const base = "/api/ratings/movie-004", own = base + "/me";
    const save = (agent, body, url = own) => agent.put(url).set("Origin", f.config.origin).send(body);
    const remove = agent => agent.delete(own).set("Origin", f.config.origin);

    await t.test("public empty summary and private create read edit clear delete contracts", async () => {
        const metadata = (await Title.findOne({ id: "movie-004" }).lean()).rating;
        assert.deepEqual((await request(f.app).get(base).expect(200)).body, { average: null, count: 0, reviews: [] });
        assert.deepEqual((await a.agent.get(own).expect(200)).body, { rating: null });
        assert.deepEqual((await save(a.agent, { score: 5, reviewText: " A " }).expect(200)).body, { score: 5, reviewText: "A" });
        assert.deepEqual((await save(a.agent, { score: 4 }).expect(200)).body, { score: 4, reviewText: "A" });
        await save(b.agent, { score: 2, reviewText: "<script>literal review</script>" }).expect(200);
        const summary = await request(f.app).get(base).expect(200);
        assert.equal(summary.headers["cache-control"], "no-store");
        assert.equal(summary.body.average, 3); assert.equal(summary.body.count, 2);
        for (const review of summary.body.reviews) assert.deepEqual(Object.keys(review).sort(), ["createdAt", "reviewText", "score", "updatedAt"]);
        assert(!JSON.stringify(summary.body).includes(a.user.id)); assert(!JSON.stringify(summary.body).includes(b.user.email));
        assert.deepEqual((await a.agent.get(own)).body.rating, { score: 4, reviewText: "A" });
        await save(a.agent, { score: 1, reviewText: "" }).expect(200);
        assert.equal((await request(f.app).get(base)).body.reviews.length, 1);
        await remove(a.agent).expect(204); await remove(a.agent).expect(204);
        assert.deepEqual((await a.agent.get(own)).body, { rating: null });
        assert.equal((await b.agent.get(own)).body.rating.score, 2);
        assert.equal((await request(f.app).get(base)).body.average, 2);
        assert.equal((await Title.findOne({ id: "movie-004" }).lean()).rating, metadata);
    });

    await t.test("invalid bodies IDs queries and missing titles never create records", async () => {
        for (const body of [null, [], {}, { score: 0 }, { score: 6 }, { score: 2.5 }, { score: "4" }, { score: true },
            { score: { $gt: 0 } }, { score: 4, user: b.user.id }, { score: 4, userId: b.user.id },
            { score: 4, $set: {} }, { score: 4, reviewText: null }, { score: 4, reviewText: "x".repeat(2001) }]) await save(a.agent, body).expect(400);
        await a.agent.put(own).set("Origin", f.config.origin).set("Content-Type", "application/json").send('{"score":').expect(400);
        await a.agent.put(own).set("Origin", f.config.origin).set("Content-Type", "text/plain").send("score=4").expect(400);
        await save(a.agent, { score: 4, reviewText: "x".repeat(110000) }).expect(413);
        await a.agent.delete(own).set("Origin", f.config.origin).send({ userId: b.user.id }).expect(400);
        for (const id of ["%20", "%24ne", "x".repeat(129)]) await request(f.app).get("/api/ratings/" + id).expect(400);
        await request(f.app).get(base + "?userId=other").expect(400);
        for (const method of ["get", "put", "delete"]) await a.agent[method]("/api/ratings/missing/me")
            .set("Origin", f.config.origin).send(method === "put" ? { score: 4 } : undefined).expect(404);
        await request(f.app).get("/api/ratings/missing").expect(404);
        await request(f.app).get("/api/ratings/").expect(401);
        assert.equal(await f.Rating.countDocuments({ user: a.user.id, itemId: "movie-004" }), 0);
    });

    await t.test("real middleware rejects unauthenticated tampered expired and deleted-user sessions", async () => {
        const expired = jwt.sign({}, f.config.secret, { subject: a.user.id, issuer: f.config.issuer, audience: f.config.audience, expiresIn: -1 });
        for (const token of [null, "invalid", expired]) {
            for (const method of ["get", "put", "delete"]) {
                const req = request(f.app)[method](own).set("Origin", f.config.origin);
                if (token) req.set("Cookie", `${f.config.cookieName}=${token}`);
                await req.send(method === "put" ? { score: 4 } : undefined).expect(401);
            }
        }
        const deleted = await f.account(); await User.deleteOne({ _id: deleted.user.id });
        await save(deleted.agent, { score: 4 }).expect(401);
    });

    await t.test("Origin Referer and expected-account guards enforce the existing security policy", async () => {
        for (const origin of ["https://evil.test", "null", f.config.origin + ".evil"]) {
            await a.agent.put(own).set("Origin", origin).send({ score: 5 }).expect(403);
            await a.agent.delete(own).set("Origin", origin).expect(403);
        }
        await a.agent.put(own).send({ score: 5 }).expect(403);
        await a.agent.put(own).set("Origin", f.config.origin).set("Sec-Fetch-Site", "cross-site").send({ score: 5 }).expect(403);
        await a.agent.put(own).set("Referer", f.config.origin + "/details.html").send({ score: 4 }).expect(200);
        for (const method of ["get", "put", "delete"]) await b.agent[method](own)
            .set("Origin", f.config.origin).set("X-Ratings-Account", a.user.id)
            .send(method === "put" ? { score: 1 } : undefined).expect(409);
        assert.equal((await b.agent.get(own)).body.rating.score, 2);
    });

    await t.test("concurrent cookie-authenticated updates retain one row and accurate statistics", async () => {
        await Promise.all(Array.from({ length: 20 }, (_, i) => save(a.agent, { score: i % 5 + 1 }, "/api/ratings/show-001/me").expect(200)));
        assert.equal(await f.Rating.countDocuments({ user: a.user.id, itemId: "show-001" }), 1);
        const saved = (await a.agent.get("/api/ratings/show-001/me")).body.rating;
        const summary = (await request(f.app).get("/api/ratings/show-001")).body;
        assert.equal(summary.count, 1); assert.equal(summary.average, saved.score);
    });

    await t.test("unexpected errors remain generic and do not expose internal details", async () => {
        const original = Title.exists;
        try {
            Title.exists = () => { throw new Error("test-only private connection failure"); };
            assert.deepEqual((await request(f.app).get(base).expect(500)).body,
                { error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
        } finally { Title.exists = original; }
    });
});
