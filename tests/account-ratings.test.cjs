"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const item = { id: "movie-004", type: "movie" };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

class Element {
    constructor() { this.hidden = false; this.disabled = false; this.value = ""; this.textContent = "";
        this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key]; }
    replaceChildren(...children) { this.children = children; }
    appendChild(child) { this.children.push(child); }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async click() { if (!this.disabled) await Promise.all((this.listeners.click || []).map(fn => fn({ target: this }))); }
    set innerHTML(value) { throw new Error("Untrusted HTML must never be inserted"); }
}

function apiFixture() {
    const state = { user: "alice", rows: new Map(), requests: [], override: null };
    const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
    state.fetch = async (url, options) => {
        state.requests.push({ url, ...options });
        if (state.override) {
            const custom = state.override(url, options);
            if (custom !== undefined) return custom;
        }
        if (url === "/api/auth/me") return state.user ? response({ user: { id: state.user } }) : response({}, 401);
        const match = url.match(/^\/api\/ratings\/([^/]+)(\/me)?$/);
        if (!match) throw new Error("Unexpected request " + url);
        const [, id, own] = match;
        const key = state.user + "/" + id;
        if (own && !state.user) return response({}, 401);
        if (own && options.method === "PUT") state.rows.set(key, JSON.parse(options.body));
        if (own && options.method === "DELETE") { state.rows.delete(key); return response(null, 204); }
        if (own) return response(options.method === "PUT" ? state.rows.get(key) : { rating: state.rows.get(key) || null });
        const rows = [...state.rows.entries()].filter(([key]) => key.endsWith("/" + id)).map(([, value]) => value);
        return response({ average: rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : null,
            count: rows.length, reviews: rows.filter(row => row.reviewText) });
    };
    state.response = response;
    return state;
}

async function page(api = apiFixture(), account = true) {
    const ids = ["rating-message", "clear-rating", "ratings-summary", "ratings-reviews", "ratings-account",
        "rating-review", "save-review", "retry-ratings", "ratings-mode-note"];
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    const section = new Element();
    section.dataset.ratingsMode = account ? "account" : "guest";
    const stars = Array.from({ length: 5 }, (_, index) => { const star = new Element(); star.dataset.rating = String(index + 1); return star; });
    const events = {};
    const saved = new Map();
    let storageCalls = 0;
    const window = {
        fetch: api.fetch,
        addEventListener(type, listener) { (events[type] ||= []).push(listener); },
        async emit(type) { await Promise.all((events[type] || []).map(fn => fn({ type }))); }
    };
    const localStorage = { getItem(key) { storageCalls++; if (account) throw new Error("Account mode touched guest storage"); return saved.get(key) || null; },
        setItem(key, value) { storageCalls++; if (account) throw new Error("Account mode touched guest storage"); saved.set(key, value); } };
    const document = { getElementById: id => elements[id], querySelector: () => section, querySelectorAll: () => stars, createElement: () => new Element() };
    const context = vm.createContext({ window, document, localStorage, console });
    for (const file of ["ratings-api.js", "ratings-account.js", "ratings.js"]) {
        vm.runInContext(fs.readFileSync(path.join(root, "js", file), "utf8"), context);
    }
    await window.CineFlixRatings.connectItem(item);
    return { elements, stars, section, window, api, saved, storageCalls: () => storageCalls };
}

test("guest mode preserves local stars and sends no account requests", async () => {
    const p = await page(apiFixture(), false);
    await p.stars[3].click();
    assert.equal(JSON.parse(p.saved.get("cineflixPersonalRatings"))[item.id], 4);
    assert.equal(p.api.requests.length, 0);
});

test("account stars/review persist through reload, edit and delete without touching guest storage", async () => {
    const api = apiFixture();
    const p = await page(api);
    assert.equal(p.storageCalls(), 0);
    p.elements["rating-review"].value = "<img src=x onerror=alert(1)> Great!";
    await p.stars[4].click();
    assert.match(p.elements["rating-message"].textContent, /5 out of 5.*saved/);
    assert.match(p.elements["ratings-summary"].textContent, /5.0 out of 5.*1 rating/);
    assert.equal(p.elements["ratings-reviews"].children[0].textContent, "5/5 — <img src=x onerror=alert(1)> Great!");
    const reloaded = await page(api);
    assert.equal(reloaded.stars[4].getAttribute("aria-pressed"), "true");
    assert.equal(reloaded.elements["rating-review"].value, "<img src=x onerror=alert(1)> Great!");
    reloaded.elements["rating-review"].value = "Edited";
    await reloaded.elements["save-review"].click();
    assert.equal(api.rows.size, 1);
    assert.equal(api.rows.get("alice/movie-004").reviewText, "Edited");
    await reloaded.elements["clear-rating"].click();
    assert.equal(api.rows.size, 0);
    assert.equal(reloaded.elements["rating-review"].value, "");
    assert.match(reloaded.elements["ratings-summary"].textContent, /No community/);
    assert.equal(reloaded.storageCalls(), 0);
    for (const request of api.requests) assert.equal(request.credentials, "same-origin");
});

test("signed-out visitors see community reviews with disabled personal controls", async () => {
    const api = apiFixture();
    api.user = null;
    api.rows.set("bob/movie-004", { score: 2, reviewText: "Okay" });
    const p = await page(api);
    assert.match(p.elements["rating-message"].textContent, /Sign in/);
    assert(p.stars.every(star => star.disabled));
    assert.equal(p.elements["ratings-reviews"].children[0].textContent, "2/5 — Okay");
    await p.stars[4].click();
    assert(api.requests.every(req => req.method === "GET"));
});

test("logout clears personal state synchronously and account switches load only the current user's rating", async () => {
    const api = apiFixture();
    api.rows.set("alice/movie-004", { score: 5, reviewText: "Alice private draft" });
    api.rows.set("bob/movie-004", { score: 2, reviewText: "" });
    const p = await page(api);
    api.user = null;
    const logout = p.window.emit("cineflix:session-updated");
    assert.equal(p.elements["rating-review"].value, "");
    assert(p.stars.every(star => star.getAttribute("aria-pressed") === "false"));
    await logout;
    api.user = "bob";
    await p.window.emit("cineflix:session-updated");
    assert.equal(p.stars[1].getAttribute("aria-pressed"), "true");
    assert.equal(p.elements["rating-review"].value, "");
    await p.elements["clear-rating"].click();
    assert(api.rows.has("alice/movie-004"));
    assert(!api.rows.has("bob/movie-004"));
});

test("session change detected immediately before mutation prevents a write as another user", async () => {
    const p = await page();
    p.api.user = "bob";
    await p.stars[4].click();
    assert.equal(p.api.rows.size, 0);
    assert.equal(p.api.requests.filter(req => req.method === "PUT").length, 0);
});

test("write failure preserves prior selection and review draft and never falls back to guest storage", async () => {
    const p = await page();
    await p.stars[1].click();
    p.elements["rating-review"].value = "Keep draft";
    p.api.override = (url, options) => options.method === "PUT" ? p.api.response({ error: { message: "DB secret" } }, 500) : undefined;
    await p.stars[4].click();
    assert.equal(p.stars[1].getAttribute("aria-pressed"), "true");
    assert.equal(p.elements["rating-review"].value, "Keep draft");
    assert.match(p.elements["rating-message"].textContent, /Unable to confirm/);
    assert(!p.elements["rating-message"].textContent.includes("DB secret"));
    assert.equal(p.storageCalls(), 0);
    assert.equal(p.api.requests.filter(req => req.method === "PUT").length, 2);
});

test("failed personal read disables mutation; failed public read still permits account rating", async () => {
    const api = apiFixture();
    api.override = url => url.endsWith("/me") && url !== "/api/auth/me" ? api.response({}, 500) : undefined;
    const p = await page(api);
    assert(p.stars.every(star => star.disabled));
    assert.match(p.elements["rating-message"].textContent, /Unable to load/);
    api.override = url => url === "/api/ratings/movie-004" ? api.response({}, 500) : undefined;
    await p.elements["retry-ratings"].click();
    assert(p.stars.every(star => !star.disabled));
    assert.match(p.elements["ratings-summary"].textContent, /could not be loaded/);
});

test("late personal response cannot restore previous account data after logout", async () => {
    const p = await page();
    const wait = deferred();
    p.api.override = url => url === "/api/ratings/movie-004/me" ? wait.promise : undefined;
    const refresh = p.elements["retry-ratings"].click();
    await tick();
    p.api.user = null;
    await p.window.emit("cineflix:session-updated");
    wait.resolve(p.api.response({ rating: { score: 5, reviewText: "Old account" } }));
    await refresh;
    assert.equal(p.elements["rating-review"].value, "");
    assert(p.stars.every(star => star.disabled));
    assert.match(p.elements["rating-message"].textContent, /Sign in/);
});

test("late summary response cannot overwrite the newly connected title", async () => {
    const p = await page();
    const wait = deferred();
    p.api.override = url => url === "/api/ratings/movie-004" ? wait.promise : undefined;
    const old = p.elements["retry-ratings"].click();
    await p.window.CineFlixRatings.connectItem({ id: "show-001", type: "show" });
    wait.resolve(p.api.response({ average: 5, count: 1, reviews: [{ score: 5, reviewText: "Old title" }] }));
    await old;
    assert.match(p.elements["ratings-summary"].textContent, /No community/);
    assert.equal(p.elements["ratings-reviews"].children.length, 0);
});

test("double clicking while saving issues one write and overlong reviews issue none", async () => {
    const p = await page();
    const wait = deferred();
    p.api.override = (url, options) => options.method === "PUT" ? wait.promise : undefined;
    const save = p.stars[4].click();
    await tick();
    await p.stars[3].click();
    assert.equal(p.api.requests.filter(req => req.method === "PUT").length, 1);
    wait.resolve(p.api.response({ score: 5, reviewText: "" }));
    await save;
    p.elements["rating-review"].value = "x".repeat(2001);
    await p.elements["save-review"].click();
    assert.match(p.elements["rating-message"].textContent, /2000/);
    assert.equal(p.api.requests.filter(req => req.method === "PUT").length, 1);
});

test("expired mutation clears personal data and disconnect invalidates pending work", async () => {
    const p = await page();
    await p.stars[1].click();
    p.api.override = (url, options) => options.method === "DELETE" ? p.api.response({}, 401) : undefined;
    await p.elements["clear-rating"].click();
    assert(p.stars.every(star => star.disabled));
    assert.equal(p.elements["rating-review"].value, "");
    assert.match(p.elements["rating-message"].textContent, /session expired/);
    await p.window.CineFlixRatings.connectItem(null);
    assert.equal(p.section.hidden, true);
    assert.equal(p.section.getAttribute("aria-busy"), "false");
});

test("API client encodes IDs, handles no-content/errors and never stores tokens", async () => {
    const p = await page();
    const requests = [];
    const client = p.window.CineFlixRatingsApi.createRatingsClient(async (url, options) => {
        requests.push({ url, ...options });
        return p.api.response(null, 204);
    });
    assert.equal(await client.deleteOwn("movie id/1"), null);
    assert.equal(requests[0].url, "/api/ratings/movie%20id%2F1/me");
    assert.equal(requests[0].body, undefined);
    assert.equal(requests[0].cache, "no-store");
    const invalid = p.window.CineFlixRatingsApi.createRatingsClient(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad JSON"); } }));
    await assert.rejects(invalid.getSummary("movie-004"), /Invalid ratings response/);
});
