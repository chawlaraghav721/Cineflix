"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMovieNightControllers } = require("../src/controllers/movieNightController.cjs");
const { registerMovieNightRoutes } = require("../src/routes/movieNightRoutes.cjs");
const { fixture, hostA, hostB, sessionId, selectedIds, input } = require("./helpers/sessionFixture.cjs");
const rooms = require("./helpers/roomFixture.cjs");
function setup() {
    const sessions = fixture(); const roomFixture = rooms.fixture();
    const controllers = createMovieNightControllers({ sessionService: sessions.service, roomService: roomFixture.service });
    async function call(name, extra = {}, headers = {}) {
        const req = { user: hostA, params: { sessionId, roomId: rooms.roomId }, body: input(), get: key => headers[key], ...extra };
        const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(code) { this.code = code; return this; },
            json(body) { this.body = body; return this; }, end() { this.ended = true; return this; } };
        await controllers[name](req, res, error => { res.forwardedError = error; });
        return res;
    }
    return { sessions, roomFixture, controllers, call };
}
test("session handlers preserve create/list/get/results/delete statuses and envelopes", async () => {
    const f = setup();
    assert.equal((await f.call("createSession")).code, 201);
    const list = await f.call("listSessions"); assert.equal(list.code, 200); assert(Array.isArray(list.body.sessions));
    assert.equal((await f.call("getSession")).body._id, sessionId);
    assert.deepEqual(Object.keys((await f.call("getSessionResults")).body).sort(), ["complete", "isTie", "tallies", "winners"]);
    const deleted = await f.call("deleteSession"); assert.equal(deleted.code, 204); assert.equal(deleted.ended, true); assert.equal(deleted.body, undefined);
});
test("vote/reset parse revision strictly and use separate verified-context argument", async () => {
    const f = setup();
    const voted = await f.call("voteSession", { body: { itemId: selectedIds[0], userId: hostB.id } }, { "X-Movie-Night-Revision": "1" });
    assert.equal(voted.code, 200); assert.equal(voted.body.hostUser, hostA.id); assert.equal(voted.body.revision, 2);
    const reset = await f.call("resetSession", {}, { "X-Movie-Night-Revision": "2" });
    assert.equal(reset.body.votes.length, 0); assert.equal(reset.body.revision, 3);
    const stale = await f.call("voteSession", { body: { itemId: selectedIds[0] } }, { "X-Movie-Night-Revision": "1" });
    assert.equal(stale.code, 409); assert.equal(stale.body.error.code, "SESSION_CONFLICT");
});
test("missing/invalid preconditions, JSON and identifiers return agreed error envelopes", async () => {
    const f = setup();
    for (const value of [undefined, "", "01", "-1", "1.5", " 1", "1e0", ["1"], "9007199254740991"]) {
        const result = await f.call("resetSession", {}, { "X-Movie-Night-Revision": value });
        assert.equal(result.code, 400); assert.equal(result.body.error.code, "INVALID_REVISION");
    }
    assert.equal((await f.call("createSession", { body: [] })).code, 400);
    assert.equal((await f.call("getSession", { params: { sessionId: "bad" } })).code, 400);
    assert.equal((await f.call("getSession", { user: hostB })).code, 404);
    assert.equal((await f.call("resetSession", { user: undefined })).code, 401);
});
test("unexpected errors are forwarded without leaking internals; all responses are private/no-store", async () => {
    const f = setup(); f.sessions.sessionRepository.findOwned = async () => { throw new Error("secret connection details"); };
    const result = await f.call("getSession");
    assert.equal(result.body, undefined); assert.match(result.forwardedError.message, /secret connection details/);
    assert.equal(result.headers["Cache-Control"], "private, no-store");
});
test("room handlers cover create, join, poll, host start/reset, and participant round vote", async () => {
    const f = setup();
    assert.equal((await f.call("createRoom", { body: input({ voterCount: 2 }) })).code, 201);
    await f.call("joinRoom", { body: { roomCode: "ABCDEFGH" } });
    const joined = await f.call("joinRoom", { user: hostB, body: { roomCode: "ABCDEFGH" } });
    assert.equal(joined.body.participantCount, 2);
    const started = await f.call("startRoom", {}, { "X-Movie-Night-Revision": "2" }); assert.equal(started.code, 200);
    const voted = await f.call("voteRoom", { user: hostB, body: { itemId: selectedIds[0] } }, { "X-Movie-Night-Round": started.body.roundId });
    assert.equal(voted.code, 200); assert.equal(voted.body.hasVoted, true); assert.equal(voted.body.roomCode, undefined);
    assert.equal((await f.call("getRoom")).body.results.tallies[0].count, 1);
    assert.equal((await f.call("resetRoom", {}, { "X-Movie-Night-Revision": "4" })).body.status, "waiting");
    assert.equal((await f.call("voteRoom", { body: { itemId: selectedIds[0] } })).code, 400);
});
test("route registration has no defaults for auth/protection and rooms require explicit enablement", () => {
    const f = setup(); const registered = [];
    const router = Object.fromEntries(["get", "post", "put", "delete"].map(method => [method, (...args) => registered.push([method, ...args])]));
    const requireAuth = () => {}; const protectMutation = () => {}; // Test sentinels only.
    assert.throws(() => registerMovieNightRoutes({ router, controllers: f.controllers }), TypeError);
    registerMovieNightRoutes({ router, controllers: f.controllers, requireAuth, protectMutation });
    assert.equal(registered.length, 7); assert.equal(registered.some(r => r[1].startsWith("/rooms")), false);
    for (const [method, , auth, protection] of registered) {
        assert.equal(auth, requireAuth); if (method !== "get") assert.equal(protection, protectMutation);
    }
    registered.length = 0;
    registerMovieNightRoutes({ router, controllers: f.controllers, requireAuth, protectMutation, enableRooms: true });
    assert.equal(registered.length, 13);
});
