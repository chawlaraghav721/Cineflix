"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { ratingsHttp } = require("../test-support/ratingsHttp.cjs");

test("authenticated dashboard collection returns only the cookie account's actual ratings", async t => {
    const f = await ratingsHttp(t), a = await f.account(), b = await f.account();
    await request(f.app).get("/api/ratings").expect(401);
    assert.deepEqual((await a.agent.get("/api/ratings").expect(200)).body, { items: [] });
    for (const [account, itemId, score] of [[a, "show-001", 5], [a, "movie-004", 4], [b, "movie-005", 1]]) {
        await account.agent.put(`/api/ratings/${itemId}/me`).set("Origin", f.config.origin).send({ score }).expect(200);
    }
    const response = await a.agent.get("/api/ratings").set("X-Ratings-Account", a.user.id).expect(200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.body.items.map(item => [item.itemId, item.score]), [["movie-004", 4], ["show-001", 5]]);
    for (const item of response.body.items) assert.deepEqual(Object.keys(item).sort(), ["createdAt", "itemId", "reviewText", "score", "updatedAt"]);
    assert.equal((await b.agent.get("/api/ratings")).body.items.length, 1);
    await b.agent.get("/api/ratings").set("X-Ratings-Account", a.user.id).expect(409);
    await a.agent.get("/api/ratings?userId=" + b.user.id).expect(400);
    await a.agent.delete("/api/ratings/movie-004/me").set("Origin", f.config.origin).expect(204);
    assert.equal((await a.agent.get("/api/ratings")).body.items.length, 1);
});
