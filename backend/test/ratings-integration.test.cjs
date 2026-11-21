"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { ratingsFixture } = require("../test-support/ratingsIntegration.cjs");
const Title = require("../src/models/Title");

test("ratings API with real JWT cookies and isolated MongoDB", { timeout: 60000 }, async t => {
    const f = await ratingsFixture(t);
    const a = await f.account(), b = await f.account();
    const own = "/api/ratings/movie-004/me", summary = "/api/ratings/movie-004";
    const put = (agent, body, path = own) => agent.put(path).set("Origin", f.config.origin).send(body);
    const del = (agent, path = own) => agent.delete(path).set("Origin", f.config.origin);

    await t.test("all endpoints, review edits, separate users and accurate community totals", async () => {
        const metadata = (await Title.findOne({ id: "movie-004" }).lean()).rating;
        assert.deepEqual((await request(f.app).get(summary).expect(200)).body, { average: null, count: 0, reviews: [] });
        assert.deepEqual((await a.agent.get(own).expect(200)).body, { rating: null });
        assert.deepEqual((await put(a.agent, { score: 5, reviewText: " Nice " }).expect(200)).body, { score: 5, reviewText: "Nice" });
        assert.deepEqual((await put(a.agent, { score: 4 }).expect(200)).body, { score: 4, reviewText: "Nice" });
        await put(b.agent, { score: 2, reviewText: "<img src=x onerror=alert(1)>" }).expect(200);
        const result = await request(f.app).get(summary).expect(200);
        assert.equal(result.headers["cache-control"], "no-store");
        assert.equal(result.body.average, 3); assert.equal(result.body.count, 2);
        assert.equal(result.body.reviews.length, 2);
        for (const review of result.body.reviews) {
            assert.deepEqual(Object.keys(review).sort(), ["createdAt", "reviewText", "score", "updatedAt"]);
        }
        assert(!JSON.stringify(result.body).includes(a.user.id));
        assert(!JSON.stringify(result.body).includes(b.user.email));
        assert.deepEqual((await b.agent.get(own).expect(200)).body.rating, { score: 2, reviewText: "<img src=x onerror=alert(1)>" });
        await put(a.agent, { score: 1, reviewText: "" }).expect(200);
        assert.equal((await request(f.app).get(summary)).body.reviews.length, 1);
        await del(a.agent).expect(204); await del(a.agent).expect(204);
        assert.equal((await request(f.app).get(summary)).body.average, 2);
        assert.equal((await a.agent.get(own)).body.rating, null);
        assert.equal((await b.agent.get(own)).body.rating.score, 2);
        await del(b.agent).expect(204);
        assert.deepEqual((await request(f.app).get(summary)).body, { average: null, count: 0, reviews: [] });
        assert.equal((await Title.findOne({ id: "movie-004" }).lean()).rating, metadata);
        await put(a.agent, { score: 3 }, "/api/ratings/show-001/me").expect(200);
    });

    await t.test("rejects malformed bodies, unsafe values and forged ownership without changes", async () => {
        const bad = [null, [], {}, { score: "5" }, { score: true }, { score: 0 }, { score: 6 }, { score: 1.5 },
            { score: { $gt: 1 } }, { score: 4, reviewText: null }, { score: 4, reviewText: {} },
            { score: 4, reviewText: "x".repeat(2001) }, { score: 4, user: b.user.id },
            { score: 4, userId: b.user.id }, { score: 4, itemId: "show-001" }, { score: 4, $set: { user: b.user.id } }];
        for (const body of bad) await put(a.agent, body).expect(400);
        await a.agent.put(own).set("Origin", f.config.origin).set("Content-Type", "application/json").send('{"score":').expect(400);
        await a.agent.put(own).set("Origin", f.config.origin).set("Content-Type", "text/plain").send("score=4").expect(400);
        await a.agent.put(own).set("Origin", f.config.origin).send({ score: 5, reviewText: "x".repeat(110000) }).expect(413);
        for (const id of ["%20", "%24ne", "x".repeat(129)]) {
            await request(f.app).get("/api/ratings/" + id).expect(400);
            await put(a.agent, { score: 4 }, "/api/ratings/" + id + "/me").expect(400);
        }
        for (const suffix of ["", "/me"]) await a.agent.get("/api/ratings/movie-missing" + suffix).expect(404);
        await put(a.agent, { score: 4 }, "/api/ratings/movie-missing/me").expect(404);
        await del(a.agent, "/api/ratings/movie-missing/me").expect(404);
        await request(f.app).get("/api/ratings/").expect(404);
        assert.equal(await f.Rating.countDocuments({ itemId: "movie-004" }), 0);
    });

    await t.test("enforces authentication, expiry, trusted origins and account existence", async () => {
        for (const method of ["get", "put", "delete"]) {
            await request(f.app)[method](own).set("Origin", f.config.origin).send(method === "put" ? { score: 5 } : undefined).expect(401);
        }
        for (const origin of ["https://evil.test", "null", "http://cineflix.test.evil.test"]) {
            await a.agent.put(own).set("Origin", origin).send({ score: 5 }).expect(403);
            await a.agent.delete(own).set("Origin", origin).expect(403);
        }
        await a.agent.put(own).send({ score: 5 }).expect(403);
        await a.agent.put(own).set("Origin", f.config.origin).set("Sec-Fetch-Site", "cross-site").send({ score: 5 }).expect(403);
        const token = subject => jwt.sign({}, f.config.secret, { algorithm: "HS256", subject,
            issuer: f.config.issuer, audience: f.config.audience, expiresIn: -1 });
        for (const value of ["tampered", token(a.user.id)]) {
            for (const method of ["get", "put", "delete"]) await request(f.app)[method](own)
                .set("Cookie", `${f.config.cookieName}=${value}`).set("Origin", f.config.origin)
                .send(method === "put" ? { score: 5 } : undefined).expect(401);
        }
        const deleted = await f.account();
        await mongoose.model("User").deleteOne({ _id: deleted.user.id });
        await put(deleted.agent, { score: 4 }).expect(401);
        assert.equal(await f.Rating.countDocuments({ itemId: "movie-004" }), 0);
    });

    await t.test("actual unique compound index and concurrent first writes prevent duplicates", async () => {
        const indexes = await f.Rating.collection.indexes();
        assert(indexes.some(index => index.unique && index.key.user === 1 && index.key.itemId === 1));
        await Promise.all(Array.from({ length: 20 }, (_, index) => put(a.agent, { score: index % 5 + 1, reviewText: `Concurrent ${index}` }).expect(200)));
        assert.equal(await f.Rating.countDocuments({ user: a.user.id, itemId: "movie-004" }), 1);
        const saved = (await a.agent.get(own)).body.rating;
        assert.equal((await request(f.app).get(summary)).body.average, saved.score);
        await assert.rejects(f.Rating.create({ user: a.user.id, itemId: "movie-004", score: 3 }), { code: 11000 });
        await Promise.all([put(a.agent, { score: 4 }).expect(200), put(b.agent, { score: 2 }).expect(200)]);
        const results = (await request(f.app).get(summary)).body;
        assert.equal(results.average, 3); assert.equal(results.count, 2);
    });

    await t.test("recent reviews have deterministic order and limit while totals include every score", async () => {
        const now = new Date("2026-01-01T00:00:00Z");
        const rows = Array.from({ length: 25 }, (_, index) => ({ user: new mongoose.Types.ObjectId(),
            itemId: "movie-005", score: index % 5 + 1, reviewText: index === 0 ? "" : `Review ${index}`,
            createdAt: now, updatedAt: now }));
        await f.Rating.insertMany(rows);
        const first = (await request(f.app).get("/api/ratings/movie-005").expect(200)).body;
        const second = (await request(f.app).get("/api/ratings/movie-005").expect(200)).body;
        assert.deepEqual(first, second); assert.equal(first.average, 3); assert.equal(first.count, 25);
        assert.equal(first.reviews.length, 20);
        assert.deepEqual(first.reviews.map(review => review.reviewText), rows.slice(-20).reverse().map(row => row.reviewText));
    });
});
