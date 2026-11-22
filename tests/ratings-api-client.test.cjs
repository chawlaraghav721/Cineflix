"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function clientFixture(fetcher) {
    let state = { status: "signed-in", user: { id: "alice" } };
    const events = [], listeners = {};
    const auth = { getState: () => state, refresh: async () => { state = { status: "signed-out", user: null }; } };
    const window = { localStorage: { setItem() { throw new Error("Storage blocked"); } },
        dispatchEvent: event => events.push(event.type), addEventListener: (type, fn) => { listeners[type] = fn; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/ratings-api.js"), "utf8"),
        { window, Event, AbortController, setTimeout, clearTimeout });
    return { client: window.CineFlixRatingsApi.createClient(fetcher, auth), events, listeners, setState: value => { state = value; } };
}
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

test("ratings client sends cookie requests and the expected account without relying on storage", async () => {
    const calls = [];
    const f = clientFixture(async (url, options) => { calls.push({ url, options }); return response({ score: 5, reviewText: "A" }); });
    assert.equal((await f.client.save("movie-004", "alice", 5, "A")).score, 5);
    assert.equal(calls[0].url, "/api/ratings/movie-004/me");
    assert.equal(calls[0].options.credentials, "same-origin");
    assert.equal(calls[0].options.headers["X-Ratings-Account"], "alice");
    assert.deepEqual(JSON.parse(calls[0].options.body), { score: 5, reviewText: "A" });
    assert.deepEqual(f.events, ["cineflix:ratings-updated"]);
});

test("late private responses are rejected after account switching including while parsing JSON", async () => {
    let release;
    const f = clientFixture(() => new Promise(resolve => { release = resolve; }));
    const pending = f.client.own("movie-004", "alice");
    f.setState({ status: "signed-in", user: { id: "bob" } }); release(response({ rating: { score: 5, reviewText: "private" } }));
    await assert.rejects(pending, { code: "ACCOUNT_CHANGED" });
    let parse;
    const g = clientFixture(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { parse = resolve; }) }));
    const reading = g.client.list("alice"); await new Promise(resolve => setImmediate(resolve));
    g.setState({ status: "loading", user: null }); parse({ items: [] });
    await assert.rejects(reading, { code: "ACCOUNT_CHANGED" });
});

test("private methods require an account; expiry refreshes auth and failures never become success", async () => {
    const f = clientFixture(async () => response({ error: {} }, 401));
    await assert.rejects(f.client.own("movie-004", null), { status: 401 });
    await assert.rejects(f.client.remove("movie-004", "alice"), { status: 401 });
    assert.deepEqual(f.events, []);
    const g = clientFixture(async () => response({ error: { message: "private server information" } }, 500));
    await assert.rejects(g.client.save("movie-004", "alice", 4, ""), error => error.status === 500 && !error.message.includes("private"));
    const h = clientFixture(async () => { throw new Error("offline"); });
    await assert.rejects(h.client.summary("movie-004"), { code: "NETWORK_ERROR" });
});

test("invalid JSON and malformed successes are rejected; delete and empty collections follow contracts", async () => {
    const f = clientFixture(async () => ({ ok: true, status: 200, json: async () => { throw new Error(); } }));
    await assert.rejects(f.client.list("alice"), { code: "INVALID_RESPONSE" });
    const g = clientFixture(async () => response({ items: [{ itemId: "movie-004", score: "5", reviewText: "" }] }));
    await assert.rejects(g.client.list("alice"), { code: "INVALID_RESPONSE" });
    const h = clientFixture(async () => response(null, 204));
    await h.client.remove("movie-004", "alice"); assert.equal(h.events.length, 1);
    const i = clientFixture(async () => response({ average: null, count: 0, reviews: [] }));
    assert.equal((await i.client.summary("movie-004")).count, 0);
});
