const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const catalogue = JSON.parse(fs.readFileSync(path.join(root, "data/catalogue.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "movie-night.html"), "utf8");
const key = "cineflixMovieNightV1";
const selected = ["movie-011", "movie-012", "movie-013"];

// Exercise the real browser scripts with a small DOM and storage fixture.
class Element {
    constructor() {
        this.children = [];
        this.listeners = {};
        this.dataset = {};
        this.style = {};
        this.textContent = "";
        this.disabled = false;
        this.hidden = false;
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    click() {
        if (!this.disabled) for (const listener of this.listeners.click || []) listener();
    }
}

async function loadPage(options = {}) {
    let raw = options.raw ?? (options.state ? JSON.stringify(options.state) : null);
    const storage = {
        readsBlocked: options.readsBlocked,
        writesBlocked: options.writesBlocked,
        getItem() {
            if (this.readsBlocked) throw new Error("Storage blocked");
            return raw;
        },
        setItem(name, value) {
            assert.equal(name, key);
            if (this.writesBlocked) throw new Error("Quota exceeded");
            raw = value;
        }
    };
    const elements = {};
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements[match[1]] = new Element();
    const document = {
        baseURI: "http://localhost/movie-night.html",
        body: { dataset: { page: "movie-night" } },
        getElementById: id => elements[id],
        createElement: () => new Element(),
        addEventListener(type, listener) { if (type === "DOMContentLoaded") this.ready = listener; }
    };
    let confirm = true;
    const window = { location: { search: "" }, confirm: () => confirm };
    const context = vm.createContext({
        document, window, localStorage: storage, URL, URLSearchParams,
        fetch: async () => {
            if (options.fetchError) throw new Error("Network unavailable");
            return { ok: true, json: async () => options.catalogue || catalogue };
        }
    });
    for (const name of ["catalogue.js", "movie-night.js"]) {
        vm.runInContext(fs.readFileSync(path.join(root, "js", name), "utf8"), context);
    }
    await document.ready();
    return {
        elements, storage,
        raw: () => raw,
        saved: () => JSON.parse(raw),
        confirm: value => { confirm = value; },
        vote(index) { return elements["night-options"].children[index].children[2].children[1]; }
    };
}

const session = (overrides = {}) => ({ selected, voters: 2, votes: [], started: false, ...overrides });

test("Movie Night loads its shared catalogue before the voting script", () => {
    assert(html.indexOf('src="js/catalogue.js"') < html.indexOf('src="js/movie-night.js"'));
});

test("ID sessions use current catalogue metadata and persist exactly one vote per turn", async () => {
    const page = await loadPage({ state: session() });
    const e = page.elements;
    assert.equal(e["night-selected-movies"].children[0].children[2].children[0].textContent, "Inception");
    e["night-voters"].value = "2";
    e["night-start"].click();
    const oldButton = page.vote(0);
    oldButton.click();
    oldButton.click();
    assert.deepEqual(page.saved().votes, ["movie-011"]);
    assert.equal(e["night-progress"].textContent, "Vote 2 of 2");
    const refreshed = await loadPage({ raw: page.raw() });
    refreshed.vote(0).click();
    assert.match(refreshed.elements["night-winner"].textContent, /Winner: Inception/);
    assert.deepEqual(refreshed.saved().votes, ["movie-011", "movie-011"]);
    assert.equal(refreshed.elements["night-results"].hidden, false);
});

test("legacy movie objects and title votes resume safely and save as IDs on the next vote", async () => {
    const legacy = selected.map(id => ({ title: catalogue.movies.find(item => item.id === id).title, poster: "old-poster" }));
    const page = await loadPage({ state: session({ selected: legacy, votes: ["Inception"], started: true }) });
    assert.equal(page.elements["night-progress"].textContent, "Vote 2 of 2");
    page.vote(1).click();
    assert.deepEqual(page.saved(), session({ votes: ["movie-011", "movie-012"], started: true }));
    assert.match(page.elements["night-winner"].textContent, /tie between: Inception, Interstellar/);
});

test("ID votes remain correct when catalogue titles change or are duplicated", async () => {
    const changedCatalogue = structuredClone(catalogue);
    changedCatalogue.movies.find(item => item.id === "movie-011").title = "Updated title";
    changedCatalogue.movies.find(item => item.id === "movie-012").title = "Updated title";
    const page = await loadPage({
        catalogue: changedCatalogue,
        state: session({ voters: 3, votes: ["movie-011", "movie-012", "movie-011"], started: true })
    });
    assert.match(page.elements["night-winner"].textContent, /Winner: Updated title/);
    const rows = page.elements["night-tally"].children;
    assert.deepEqual(rows.map(row => row.children[0].children[1].textContent), ["2 vote(s)", "1 vote(s)", "0 vote(s)"]);
});

test("unavailable or ambiguous legacy titles never receive guessed votes", async () => {
    const changedCatalogue = structuredClone(catalogue);
    changedCatalogue.movies[0].title = "Inception";
    const legacy = [{ title: "Inception" }, { title: "Interstellar" }, { title: "The Dark Knight" }];
    const page = await loadPage({ catalogue: changedCatalogue, state: session({ selected: legacy, votes: ["Inception"], started: true }) });
    assert.equal(page.elements["night-voting"].hidden, true);
    assert.equal(page.elements["night-start"].disabled, true);
    assert.match(page.elements["night-feedback"].textContent, /no longer valid/);
});

test("missing movies, shows, duplicates and invalid votes return to setup instead of showing misleading results", async () => {
    for (const state of [
        session({ selected: ["movie-011", "movie-missing", "movie-012"], started: true }),
        session({ selected: ["movie-011", "show-001", "movie-012"], started: true }),
        session({ selected: ["movie-011", "movie-011", "movie-012"], started: true }),
        session({ votes: ["unknown"], started: true }),
        session({ votes: ["movie-011", "movie-011", "movie-011"], started: true })
    ]) {
        const page = await loadPage({ state });
        assert.equal(page.elements["night-setup"].hidden, false);
        assert.equal(page.elements["night-results"].hidden, true);
        assert.match(page.elements["night-feedback"].textContent, /no longer valid/);
    }
});

test("participant bounds reject invalid values and accept both 2 and 10", async () => {
    for (const value of ["1", "11", "2.5", "invalid", ""]) {
        const page = await loadPage({ state: session() });
        page.elements["night-voters"].value = value;
        page.elements["night-start"].click();
        assert.equal(page.saved().started, false);
        assert.match(page.elements["night-feedback"].textContent, /2 to 10/);
    }
    for (const value of ["2", "10"]) {
        const page = await loadPage({ state: session() });
        page.elements["night-voters"].value = value;
        page.elements["night-start"].click();
        assert.equal(page.saved().voters, Number(value));
        assert.equal(page.saved().started, true);
    }
});

test("failed start, vote and reset writes leave the previous session intact", async () => {
    for (const started of [false, true]) {
        const page = await loadPage({ state: session({ started }), writesBlocked: true });
        const previous = page.raw();
        page.elements["night-voters"].value = "3";
        if (started) page.vote(0).click();
        else page.elements["night-start"].click();
        assert.equal(page.raw(), previous);
        page.elements["night-reset"].click();
        assert.equal(page.raw(), previous);
        assert.equal(page.elements["night-voting"].hidden, !started);
        assert.match(page.elements["night-feedback"].textContent, /not saved/);
    }
});

test("reset cancellation preserves progress; confirmed reset persists an empty session", async () => {
    const page = await loadPage({ state: session({ votes: ["movie-011"], started: true }) });
    page.confirm(false);
    page.elements["night-reset"].click();
    assert.equal(page.saved().votes.length, 1);
    page.confirm(true);
    page.elements["night-reset"].click();
    assert.deepEqual(page.saved(), { selected: [], voters: 4, votes: [], started: false });
    const refreshed = await loadPage({ raw: page.raw() });
    assert.equal(refreshed.elements["night-start"].disabled, true);
});

test("bad JSON and blocked reads are safe; blocked reads cannot overwrite a saved session", async () => {
    for (const raw of ["{bad json", "{}", "null"]) {
        const page = await loadPage({ raw });
        assert.equal(page.elements["night-start"].disabled, true);
    }
    const page = await loadPage({ state: session(), readsBlocked: true });
    const previous = page.raw();
    page.elements["night-reset"].click();
    assert.equal(page.raw(), previous);
    assert.match(page.elements["night-feedback"].textContent, /storage is unavailable/);
});

test("catalogue failures disable voting without changing the saved session", async () => {
    const page = await loadPage({ state: session({ started: true }), fetchError: true });
    assert.deepEqual(page.saved(), session({ started: true }));
    assert.equal(page.elements["night-start"].disabled, true);
    assert.match(page.elements["night-feedback"].textContent, /could not load the catalogue/);
});
