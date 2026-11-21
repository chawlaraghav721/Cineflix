"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { integrationFixture, configuration } = require("../test-support/movieNightIntegration.cjs");

test("valid hexadecimal URL IDs are case-insensitive without weakening ownership", async t => {
    const f = await integrationFixture(t);
    const a = await f.account(), b = await f.account(), outsider = await f.account();
    const sessionId = "abcdefabcdefabcdefabcdef";
    const roomId = "abcdefabcdefabcdefabcdee";
    await f.Session.create({ _id: sessionId, mode: "sequential", hostUser: a.user.id,
        ...configuration, votes: [], status: "voting", revision: 0 });
    await f.Session.create({ _id: roomId, mode: "room", hostUser: a.user.id,
        ...configuration, voterCount: 2, roomCode: "ABCDEFGH", roundId: "case-test-round",
        participants: [a.user.id, b.user.id], votes: [], status: "waiting", revision: 0 });

    await t.test("session reads, results, votes, reset and deletion accept upper-case IDs", async () => {
        const path = "/api/movie-night/sessions/" + sessionId.toUpperCase();
        assert.equal((await a.agent.get(path).expect(200)).body._id, sessionId);
        await a.agent.get(path + "/results").expect(200);
        await f.post(a.agent, path + "/votes", { itemId: configuration.selectedIds[0] }, 0).expect(200);
        await f.post(a.agent, path + "/reset", undefined, 1).expect(200);
        await a.agent.delete(path).set("Origin", f.config.origin).expect(204);
        assert.equal(await f.Session.findById(sessionId), null);
    });
    await t.test("room reads and lifecycle mutations accept mixed-case IDs", async () => {
        const path = "/api/movie-night/rooms/" + roomId.toUpperCase();
        assert.equal((await a.agent.get(path).expect(200)).body.id, roomId);
        await f.post(a.agent, path + "/start", undefined, 0).expect(200);
        await b.agent.put(path + "/votes/me").set("Origin", f.config.origin)
            .set("X-Movie-Night-Round", "case-test-round").send({ itemId: configuration.selectedIds[0] }).expect(200);
        const reset = (await f.post(a.agent, path + "/reset", undefined, 2).expect(200)).body;
        assert.equal(reset.id, roomId); assert.equal(reset.status, "waiting");
    });
    await t.test("normalization preserves foreign access denial and invalid-input responses", async () => {
        await outsider.agent.get("/api/movie-night/rooms/" + roomId.toUpperCase()).expect(404);
        await f.post(b.agent, "/api/movie-night/rooms/" + roomId.toUpperCase() + "/reset", undefined, 3).expect(403);
        await a.agent.get("/api/movie-night/rooms/not-a-mongodb-id").expect(400);
    });
});
