"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createClient, createRoomPoller, MovieNightApiError } = require("../../js/movie-night-api.js");
const { sessionId, input, selectedIds } = require("./helpers/sessionFixture.cjs");
const { roomId } = require("./helpers/roomFixture.cjs");
const ok = data => ({ ok: true, status: 200, json: async () => data });
test("browser script loading only exposes the factory and performs no background requests", async () => {
    let requests = 0;
    const context = vm.createContext({ fetch: async () => { requests++; return ok({ sessions: [] }); } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../js/movie-night-api.js"), "utf8"), context);
    assert.equal(requests, 0); assert.equal(typeof context.CineFlixMovieNightApi.createClient, "function");
    const client = context.CineFlixMovieNightApi.createClient(); assert.equal(requests, 0);
    assert.equal((await client.listSessions()).sessions.length, 0); assert.equal(requests, 1);
});
test("client is dormant, same-origin, allowlists creation fields and never reads tokens", async () => {
    const calls = []; const client = createClient({ fetchImpl: async (...args) => { calls.push(args); return ok({}); } });
    assert.equal(calls.length, 0);
    await client.createSession(input({ hostUser: "untrusted" }));
    const [url, options] = calls[0]; assert.equal(url, "/api/movie-night/sessions");
    assert.equal(options.credentials, "same-origin"); assert.equal(options.cache, "no-store");
    assert.deepEqual(JSON.parse(options.body), input()); assert.equal(options.headers.Authorization, undefined);
    for (const name of ["movie-night.html", "movies.html"]) assert.equal(fs.readFileSync(path.join(__dirname, "../..", name), "utf8").includes("movie-night-api.js"), true);
});
test("all helpers use the proposed paths, verbs, revision and round headers", async () => {
    const calls = []; const c = createClient({ fetchImpl: async (...args) => { calls.push(args); return ok({}); } });
    await c.listSessions(); await c.getSession(sessionId); await c.voteSession(sessionId, selectedIds[0], 2);
    await c.getSessionResults(sessionId); await c.resetSession(sessionId, 3); await c.deleteSession(sessionId);
    await c.createRoom(input()); await c.joinRoom("ABCDEFGH"); await c.getRoom(roomId);
    await c.startRoom(roomId, 2); await c.resetRoom(roomId, 3); await c.voteRoom(roomId, selectedIds[0], "round-one");
    assert.deepEqual(calls.map(([url, opts]) => [opts.method, url.replace("/api/movie-night", "")]), [
        ["GET", "/sessions"], ["GET", `/sessions/${sessionId}`], ["POST", `/sessions/${sessionId}/votes`],
        ["GET", `/sessions/${sessionId}/results`], ["POST", `/sessions/${sessionId}/reset`], ["DELETE", `/sessions/${sessionId}`],
        ["POST", "/rooms"], ["POST", "/rooms/join"], ["GET", `/rooms/${roomId}`], ["POST", `/rooms/${roomId}/start`],
        ["POST", `/rooms/${roomId}/reset`], ["PUT", `/rooms/${roomId}/votes/me`]
    ]);
    assert.equal(calls[2][1].headers["X-Movie-Night-Revision"], "2");
    assert.equal(calls[11][1].headers["X-Movie-Night-Round"], "round-one");
});
test("204 has no JSON parse; malformed responses and API errors are explicit", async () => {
    const c = createClient({ fetchImpl: async () => ({ status: 204, ok: true, json: () => { throw new Error("must not parse"); } }) });
    assert.equal(await c.deleteSession(sessionId), undefined);
    const bad = createClient({ fetchImpl: async () => ({ status: 200, ok: true, json: async () => { throw new Error(); } }) });
    await assert.rejects(() => bad.getSession(sessionId), e => e.code === "INVALID_RESPONSE");
    const conflict = createClient({ fetchImpl: async () => ({ status: 409, ok: false, json: async () => ({ error: { code: "SESSION_CONFLICT", message: "Reload" } }) }) });
    await assert.rejects(() => conflict.resetSession(sessionId, 2), e => e.code === "SESSION_CONFLICT" && e.status === 409);
});
test("network mutation failures are never automatically replayed or saved locally", async () => {
    let calls = 0; const c = createClient({ fetchImpl: async () => { calls++; throw new Error("offline"); } });
    await assert.rejects(() => c.voteSession(sessionId, selectedIds[0], 2), e => e.code === "NETWORK_ERROR");
    assert.equal(calls, 1); assert.throws(() => c.voteSession(sessionId, selectedIds[0], -1), TypeError);
    assert.throws(() => c.getRoom("https://untrusted"), TypeError);
});
test("uppercase hexadecimal IDs use canonical URLs and accept canonical polling responses", async () => {
    const canonicalId = "abcdefabcdefabcdefabcdef";
    const paths = [];
    const client = createClient({ fetchImpl: async url => {
        paths.push(url); return ok({ id: canonicalId, revision: 0, status: "complete" });
    } });
    await client.getSession(canonicalId.toUpperCase());
    let notifications = 0;
    const poller = createRoomPoller({ client, roomId: canonicalId.toUpperCase(),
        onState: value => { assert.equal(value.id, canonicalId); notifications++; },
        onError: error => { throw error; } });
    await poller.start();
    assert.deepEqual(paths, ["/api/movie-night/sessions/" + canonicalId, "/api/movie-night/rooms/" + canonicalId]);
    assert.equal(notifications, 1); assert.equal(poller.isRunning(), false);
});
function polling(load) {
    const timers = new Map(); let id = 0; const states = [], errors = []; let signal;
    const poller = createRoomPoller({ client: { async getRoom(_, opts) { signal = opts.signal; return load(opts); } }, roomId,
        onState: s => states.push(s), onError: e => errors.push(e), intervalMs: 10, maxIntervalMs: 40,
        setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimer: key => timers.delete(key) });
    return { poller, states, errors, timers, signal: () => signal,
        async advance() { const [key, value] = timers.entries().next().value; timers.delete(key); await value.fn(); } };
}
const state = (revision, status = "voting") => ({ id: roomId, revision, status });
test("polling schedules after completion of a read, ignores older revisions and stops at results", async () => {
    const responses = [state(3), state(2), state(4, "complete")]; const f = polling(async () => responses.shift());
    await f.poller.start(); assert.equal(f.timers.size, 1); await f.poller.start(); assert.equal(f.timers.size, 1);
    await f.advance(); assert.equal(f.states.length, 1); await f.advance();
    assert.deepEqual(f.states.map(s => s.revision), [3, 4]); assert.equal(f.poller.isRunning(), false); assert.equal(f.timers.size, 0);
});
test("transient polling errors back off and success restores the normal interval", async () => {
    let attempts = 0; const f = polling(async () => { if (++attempts <= 2) throw new MovieNightApiError("NETWORK_ERROR", "offline"); return state(4); });
    await f.poller.start(); assert.equal([...f.timers.values()][0].delay, 20);
    await f.advance(); assert.equal([...f.timers.values()][0].delay, 40);
    await f.advance(); assert.equal([...f.timers.values()][0].delay, 10); f.poller.stop();
    assert.equal(f.errors.length, 2); assert.equal(f.timers.size, 0);
});
test("polling access failures stop, and stop aborts in-flight reads without late callbacks", async () => {
    for (const status of [401, 403, 404]) {
        const f = polling(async () => { throw new MovieNightApiError("ACCESS", "denied", status); });
        await f.poller.start(); assert.equal(f.poller.isRunning(), false); assert.equal(f.timers.size, 0);
    }
    let resolve; const f = polling(() => new Promise(r => { resolve = r; }));
    const pending = f.poller.start(); assert.equal(f.timers.size, 0); f.poller.stop();
    assert.equal(f.signal().aborted, true); resolve(state(3)); await pending;
    assert.equal(f.states.length, 0); assert.equal(f.timers.size, 0);
});
test("restart isolates old pending reads and rejects invalid room responses", async () => {
    let first; let calls = 0; const f = polling(() => ++calls === 1 ? new Promise(r => { first = r; }) : Promise.resolve(state(5)));
    const pending = f.poller.start(); f.poller.stop(); await f.poller.start(); first(state(100)); await pending;
    assert.deepEqual(f.states.map(s => s.revision), [5]); f.poller.stop();
    const invalid = polling(async () => ({ id: "wrong", revision: 1 })); await invalid.poller.start();
    assert.equal(invalid.errors[0].code, "INVALID_RESPONSE"); assert.equal(invalid.poller.isRunning(), false);
});
