const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../js/my-list-storage.js"), "utf8");
function fixture(options = {}) {
    const values = new Map(Object.entries(options.storage || {})), events = {}, calls = [];
    let state = options.state || { status: "signed-out", user: null };
    const window = {
        localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
        CineFlixAuth: { getState: () => state, refresh: async () => {} },
        CineFlixCatalogue: { loadCatalogue: async () => ({}), getItemById: (_, id) => ["movie-004", "show-001"].includes(id) },
        addEventListener: (type, fn) => (events[type] ||= []).push(fn),
        removeEventListener: (type, fn) => { events[type] = events[type].filter(cb => cb !== fn); },
        dispatchEvent: event => (events[event.type] || []).slice().forEach(fn => fn(event)),
        fetch: async (url, config) => { calls.push({ url, ...config }); return options.fetch(url, config); }
    };
    vm.runInNewContext(source, { window, Event: class { constructor(type) { this.type = type; } } });
    return { api: window.CineFlixMyList, window, values, calls,
        session(value) { state = value; window.dispatchEvent({ type: "cineflix:auth-state" }); } };
}
const plain = data => JSON.parse(JSON.stringify(data));
const flush = () => new Promise(resolve => setImmediate(resolve));
const signed = id => ({ status: "signed-in", user: { id } });
const response = (items = []) => ({ ok: true, status: 200, json: async () => ({ items }) });
test("account changes discard pending reads and never merge or expose guest/account lists", async () => {
    let finish;
    const page = fixture({ state: signed("A"), storage: { cineflixMyList: '["show-001"]' },
        fetch: () => new Promise(resolve => { finish = resolve; }) });
    const old = page.api.getMyListItems();
    const rejected = assert.rejects(old, /account changed/);
    await flush();
    page.session(signed("B"));
    finish(response([{ itemId: "movie-004", status: "watched" }]));
    await rejected;
    page.window.fetch = async () => response();
    assert.deepEqual(plain(await page.api.getMyListItems()), []);
    page.session({ status: "signed-out", user: null });
    assert.deepEqual(plain(await page.api.getMyListIds()), ["show-001"]);
    assert.equal(page.values.get("cineflixMyList"), '["show-001"]');
});
test("loading authentication waits, duplicate writes are blocked and pending mutations cannot cross accounts", async () => {
    let finish;
    const page = fixture({ state: { status: "loading", user: null }, fetch: () => new Promise(resolve => { finish = resolve; }) });
    const loading = page.api.getMyListItems();
    await flush(); assert.equal(page.calls.length, 0);
    page.session(signed("A")); await flush(); finish(response()); await loading;
    const first = page.api.addToMyList("movie-004");
    const rejected = assert.rejects(first, /account changed/);
    await flush();
    await assert.rejects(page.api.addToMyList("movie-004"), /wait/);
    assert.equal(page.calls.filter(call => call.method === "POST").length, 1);
    page.session(signed("B")); finish(response()); await rejected;
    assert.equal(page.values.size, 0);
});
test("explicit guest list migrates legacy IDs locally, supports statuses and refresh persistence", async () => {
    const page = fixture({ storage: { cineflixMyList: '["movie-004","movie-004",null]' } });
    assert.deepEqual(plain(await page.api.getMyListIds()), ["movie-004"]);
    assert.equal(await page.api.addToMyList("movie-004"), false);
    assert.equal(await page.api.addToMyList("show-001"), true);
    await page.api.updateStatus("movie-004", "watched");
    assert.equal((await page.api.getMyListItems())[0].status, "watched");
    const refreshed = fixture({ storage: Object.fromEntries(page.values) });
    assert.equal(await refreshed.api.isInMyList("show-001"), true);
    await refreshed.api.removeFromMyList("show-001");
    await refreshed.api.clearMyList();
    assert.deepEqual(plain(await refreshed.api.getMyListIds()), []);
    assert.equal(page.values.get("cineflixMyList"), '["movie-004","movie-004",null]');
    assert.equal(page.calls.length, 0);
});
test("guest corruption, blocked reads and writes, invalid IDs and statuses are safe", async () => {
    for (const raw of ["not-json", "null", "{}", "[]"]) assert.deepEqual(plain(await fixture({ storage: { cineflixGuestWatchlist: raw } }).api.getMyListItems()), []);
    const page = fixture();
    for (const id of [null, {}, "", " movie-004", "missing"]) await assert.rejects(page.api.addToMyList(id));
    await assert.rejects(page.api.addToMyList("movie-004", "BAD"));
    page.window.localStorage.getItem = () => { throw Error("blocked"); };
    await assert.rejects(page.api.getMyListItems(), /storage/);
    await assert.rejects(page.api.addToMyList("movie-004"), /storage/);
    assert.equal(page.values.size, 0);
    page.window.localStorage.getItem = () => null;
    page.window.localStorage.setItem = () => { throw Error("blocked"); };
    await assert.rejects(page.api.addToMyList("movie-004"), /could not be saved/);
});
test("signed-in operations use same-origin API without accessing guest storage", async () => {
    const entries = [];
    const page = fixture({ state: { status: "signed-in", user: { id: "A" } }, fetch: async (_, config) => {
        const body = config.body && JSON.parse(config.body);
        if (config.method === "POST") entries.push({ ...body, addedAt: "now", updatedAt: "now" });
        if (config.method === "PATCH") entries[0].status = body.status;
        if (config.method === "DELETE") entries.length = 0;
        return { ok: true, status: config.method === "DELETE" ? 204 : 200, json: async () => config.method === "GET" ? { items: entries } : entries[0] };
    }});
    page.window.localStorage.getItem = () => { throw Error("must not read guest data"); };
    await page.api.addToMyList("movie-004");
    assert.deepEqual(plain(await page.api.getMyListIds()), ["movie-004"]);
    await page.api.updateStatus("movie-004", "watching");
    assert.equal((await page.api.getMyListItems())[0].status, "watching");
    await page.api.removeFromMyList("movie-004");
    await page.api.clearMyList();
    assert(page.calls.every(call => call.credentials === "same-origin" && call.cache === "no-store"));
    assert(page.calls.every(call => !call.body || !call.body.includes("userId")));
});
