const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "details.html"), "utf8");
const catalogue = JSON.parse(fs.readFileSync(path.join(root, "data/catalogue.json"), "utf8"));
const key = "cineflixPersonalRatings";

// A small DOM fixture runs the real scripts without installing test packages.
class Element {
    constructor() {
        this.hidden = false;
        this.disabled = false;
        this.textContent = "";
        this.dataset = {};
        this.attributes = {};
        this.children = [];
        this.listeners = {};
        this.classes = new Set();
        this.classList = {
            add: name => this.classes.add(name),
            remove: name => this.classes.delete(name)
        };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    removeAttribute(name) { delete this.attributes[name]; }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    replaceWith(element) { this.replacement = element; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    click() {
        if (this.disabled) return;
        for (const listener of this.listeners.click || []) listener({ target: this });
    }
    focus() { this.focused = true; }
    contains(element) { return this.children.includes(element); }
    querySelectorAll() { return this.children; }
}

function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        readsBlocked: false,
        writesBlocked: false,
        getItem(name) {
            if (this.readsBlocked) throw new Error("Storage read blocked");
            return values.get(name) ?? null;
        },
        setItem(name, value) {
            if (this.writesBlocked) throw new Error("Storage write blocked");
            values.set(name, value);
        }
    };
}

async function loadPage(options = {}) {
    const saved = options.storage || storage();
    const elements = {};
    for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        elements[match[1]] = new Element();
        elements[match[1]].hidden = /\bhidden\b/.test(match[0]);
        elements[match[1]].disabled = /\bdisabled\b/.test(match[0]);
    }
    const stars = [...html.matchAll(/<button[^>]+data-rating="(\d+)"[^>]*>/g)].map(match => {
        const star = new Element();
        star.dataset.rating = match[1];
        return star;
    });
    const section = new Element();
    const main = new Element();
    const events = {};
    const document = {
        baseURI: "http://localhost/details.html",
        body: new Element(),
        getElementById: id => elements[id] || null,
        querySelector: selector => selector === "main.details" ? main
            : selector === ".personal-rating" ? section : null,
        querySelectorAll: selector => selector === ".rating-stars button" ? stars : [],
        createElement: () => new Element(),
        addEventListener() {}
    };
    const window = {
        localStorage: saved,
        location: { search: options.id === null ? "" : "?id=" + encodeURIComponent(options.id || "movie-004") },
        addEventListener(type, listener) { (events[type] ||= []).push(listener); },
        dispatchEvent(event) { for (const listener of events[event.type] || []) listener(event); }
    };
    const context = vm.createContext({
        document, window, localStorage: saved, URL, URLSearchParams, console,
        Event: class { constructor(type) { this.type = type; } },
        fetch: async () => {
            if (options.fetchError) throw new Error("Catalogue fetch failed");
            return { ok: true, json: async () => options.catalogue || catalogue };
        }
    });
    const run = name => vm.runInContext(fs.readFileSync(path.join(root, "js", name), "utf8"), context);
    for (const name of ["catalogue.js", "my-list-storage.js", "details.js"]) run(name);
    if (options.ratings !== false) run("ratings.js");
    run("details-integration.js");
    const loadingHidden = section.hidden;
    await new Promise(resolve => setImmediate(resolve));
    return { elements, stars, section, main, window, storage: saved, loadingHidden };
}

test("rating controls load before integration and sit inside dynamic Details content", () => {
    assert(html.indexOf('src="js/ratings.js"') < html.indexOf('src="js/details-integration.js"'));
    const content = html.slice(html.indexOf('<section id="details-content"'), html.indexOf('<div id="details-error"'));
    assert(content.includes('class="personal-rating"'));
    assert.equal([...content.matchAll(/data-rating="[1-5]"/g)].length, 5);
    assert(content.includes('role="group"'));
    assert(content.includes('id="rating-message" role="status"'));
});

test("each catalogue movie and show can save every rating from 1 to 5", async () => {
    for (const item of [...catalogue.movies, ...catalogue.shows]) {
        const page = await loadPage({ id: item.id });
        assert.equal(page.loadingHidden, true);
        assert.equal(page.section.hidden, false);
        assert.equal(page.elements["details-title"].textContent, item.title);
        for (let rating = 1; rating <= 5; rating++) {
            page.stars[rating - 1].click();
            assert.equal(JSON.parse(page.storage.getItem(key))[item.id], rating);
            assert.equal(page.stars.filter(star => star.textContent === "★").length, rating);
            assert.equal(page.stars[rating - 1].getAttribute("aria-pressed"), "true");
            assert.equal(page.elements["clear-rating"].disabled, false);
        }
    }
});

test("ratings persist after refresh and stay separate across movies and shows", async () => {
    const saved = storage();
    const movie = await loadPage({ id: "movie-004", storage: saved });
    movie.stars[4].click();
    const show = await loadPage({ id: "show-001", storage: saved });
    assert.equal(show.elements["clear-rating"].disabled, true);
    show.stars[1].click();
    const refreshed = await loadPage({ id: "movie-004", storage: saved });
    assert.match(refreshed.elements["rating-message"].textContent, /5 out of 5/);
    refreshed.stars[2].click();
    assert.deepEqual(JSON.parse(saved.getItem(key)), { "movie-004": 3, "show-001": 2 });
    refreshed.elements["clear-rating"].click();
    assert.deepEqual(JSON.parse(saved.getItem(key)), { "show-001": 2 });
    const cleared = await loadPage({ id: "movie-004", storage: saved });
    assert.equal(cleared.elements["clear-rating"].disabled, true);
    assert.match(cleared.elements["rating-message"].textContent, /No rating/);
});

test("legacy static rating migrates to canonical ID without losing other ratings", async () => {
    const saved = storage({ [key]: JSON.stringify({ "the-last-run": 4, "show-001": 2 }) });
    const page = await loadPage({ storage: saved });
    assert.deepEqual(JSON.parse(saved.getItem(key)), { "movie-004": 4, "show-001": 2 });
    assert.match(page.elements["rating-message"].textContent, /4 out of 5/);
});

test("canonical rating wins over legacy rating and clearing cannot revive it", async () => {
    const saved = storage({ [key]: JSON.stringify({ "the-last-run": 4, "movie-004": 2 }) });
    const page = await loadPage({ storage: saved });
    assert.match(page.elements["rating-message"].textContent, /2 out of 5/);
    page.elements["clear-rating"].click();
    assert.deepEqual(JSON.parse(saved.getItem(key)), {});
});

test("missing, invalid and legacy URL IDs cannot save ratings", async () => {
    for (const id of [null, "missing", "the-last-run", " ", "__proto__"]) {
        const page = await loadPage({ id });
        assert.equal(page.section.hidden, true);
        assert.equal(page.elements["details-content"].hidden, true);
        assert.equal(page.elements["details-error"].hidden, false);
        page.stars[4].click();
        assert.equal(page.storage.getItem(key), null);
    }
});

test("failed catalogue loading leaves ratings hidden and Details error visible", async () => {
    const page = await loadPage({ fetchError: true });
    assert.equal(page.section.hidden, true);
    assert.equal(page.elements["details-error"].hidden, false);
    assert.equal(page.main.getAttribute("aria-busy"), "false");
});

test("malformed storage and invalid rating values do not crash or select stars", async () => {
    for (const raw of ["broken", "null", "[]", '{"movie-004":9}', '{"movie-004":2.5}', '{"movie-004":"5"}']) {
        const page = await loadPage({ storage: storage({ [key]: raw }) });
        assert.equal(page.stars.filter(star => star.textContent === "★").length, 0);
        page.stars[0].click();
        assert.equal(JSON.parse(page.storage.getItem(key))["movie-004"], 1);
    }
});

test("failed reads never overwrite existing ratings and keep Details working", async () => {
    const raw = '{"show-001":4}';
    const saved = storage({ [key]: raw });
    saved.readsBlocked = true;
    const page = await loadPage({ storage: saved });
    assert.match(page.elements["rating-message"].textContent, /Unable to load/);
    assert.equal(page.elements["details-content"].hidden, false);
    page.stars[4].click();
    assert.equal(saved.values.get(key), raw);
    assert.match(page.elements["rating-message"].textContent, /Unable to save/);
});

test("failed save, clear and migration preserve stored ratings and report errors", async () => {
    const raw = '{"movie-004":3,"show-001":4}';
    const saved = storage({ [key]: raw });
    const page = await loadPage({ storage: saved });
    saved.writesBlocked = true;
    page.stars[4].click();
    assert.equal(saved.getItem(key), raw);
    assert.match(page.elements["rating-message"].textContent, /Unable to save/);
    page.elements["clear-rating"].click();
    assert.equal(saved.getItem(key), raw);
    assert.match(page.elements["rating-message"].textContent, /Unable to clear/);
    const legacy = storage({ [key]: '{"the-last-run":4}' });
    legacy.writesBlocked = true;
    const migration = await loadPage({ storage: legacy });
    assert.equal(legacy.getItem(key), '{"the-last-run":4}');
    assert.match(migration.elements["rating-message"].textContent, /Unable to load/);
});

test("cross-tab changes and restored pages refresh the current rating", async () => {
    const page = await loadPage();
    page.storage.setItem(key, '{"movie-004":4}');
    page.window.dispatchEvent({ type: "storage", key });
    assert.match(page.elements["rating-message"].textContent, /4 out of 5/);
    page.storage.setItem(key, "{}");
    page.window.dispatchEvent({ type: "pageshow" });
    assert.match(page.elements["rating-message"].textContent, /No rating/);
});

test("My List add/remove and Details metadata remain independent of personal ratings", async () => {
    const page = await loadPage();
    assert.equal(page.elements["details-title"].textContent, "The Last Run");
    assert.match(page.elements["details-meta"].textContent, /8.1\/10/);
    page.stars[4].click();
    page.elements["watchlist-button"].click();
    assert.deepEqual(JSON.parse(page.storage.getItem("cineflixMyList")), ["movie-004"]);
    assert.equal(page.elements["watchlist-button"].textContent, "Remove from My List");
    page.elements["watchlist-button"].click();
    assert.deepEqual(JSON.parse(page.storage.getItem("cineflixMyList")), []);
    assert.equal(JSON.parse(page.storage.getItem(key))["movie-004"], 5);
    assert.match(page.elements["details-meta"].textContent, /8.1\/10/);
});

test("trailer open and close still work alongside ratings", async () => {
    const data = JSON.parse(JSON.stringify(catalogue));
    data.movies.find(item => item.id === "movie-004").trailerUrl = "https://www.youtube.com/embed/test-video";
    const page = await loadPage({ catalogue: data });
    page.stars[3].click();
    page.elements["trailer-button"].click();
    assert.equal(page.elements["trailer-modal"].hidden, false);
    assert.equal(page.elements["trailer-frame"].getAttribute("src"), "https://www.youtube.com/embed/test-video");
    page.elements["close-trailer"].click();
    assert.equal(page.elements["trailer-modal"].hidden, true);
    assert.equal(page.elements["trailer-frame"].getAttribute("src"), undefined);
    assert.equal(JSON.parse(page.storage.getItem(key))["movie-004"], 4);
});

test("Details still renders when the optional ratings script is unavailable", async () => {
    const page = await loadPage({ ratings: false });
    assert.equal(page.elements["details-content"].hidden, false);
    assert.equal(page.elements["details-title"].textContent, "The Last Run");
});
