const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const movieNightSource = fs.readFileSync(path.join(root, "js/movie-night.js"), "utf8");
const catalogueBrowseSource = fs.readFileSync(path.join(root, "js/catalogue-browse.js"), "utf8");
const BrowseUtils = require(path.join(root, "js/browse-utils.js"));
const storageKey = "cineflixMovieNightV1";

class Element {
    constructor(tagName = "div") {
        this.tagName = tagName;
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.dataset = {};
        this.style = {};
        this.hidden = false;
        this.disabled = false;
        this.value = "";
        this.parentNode = null;
        this.textContent = "";
        this._className = "";
        this.classes = new Set();
        this.classList = {
            add: name => { this.classes.add(name); this._className = [...this.classes].join(" "); },
            remove: name => { this.classes.delete(name); this._className = [...this.classes].join(" "); },
            contains: name => this.classes.has(name),
            toggle: (name, force) => {
                const shouldAdd = force === undefined ? !this.classes.has(name) : Boolean(force);
                if (shouldAdd) this.classes.add(name);
                else this.classes.delete(name);
                this._className = [...this.classes].join(" ");
                return shouldAdd;
            }
        };
    }
    set className(value) {
        this._className = value;
        this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
    }
    get className() { return this._className; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) {
        if (child.tagName === "#document-fragment") {
            child.children.slice().forEach(item => this.appendChild(item));
            child.children = [];
            return child;
        }
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    replaceChildren(...children) {
        this.children.forEach(child => { child.parentNode = null; });
        this.children = [];
        this.append(...children);
    }
    insertBefore(child, before) {
        const index = this.children.indexOf(before);
        child.parentNode = this;
        this.children.splice(index < 0 ? this.children.length : index, 0, child);
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    dispatch(type, event = {}) {
        const detail = Object.assign({ target: this, preventDefault() {} }, event);
        for (const listener of this.listeners[type] || []) listener(detail);
        return detail;
    }
    click() {
        if (this.disabled) return;
        const event = { target: this, preventDefault() {} };
        for (let item = this; item; item = item.parentNode) {
            for (const listener of item.listeners.click || []) listener(event);
        }
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    matches(selector) {
        if (selector === ".movie-info p") {
            return this.tagName.toLowerCase() === "p" && this.parentNode?.classList.contains("movie-info");
        }
        if (selector.startsWith(".")) return this.classes.has(selector.slice(1));
        return this.tagName.toLowerCase() === selector.toLowerCase();
    }
    closest(selector) {
        for (let item = this; item; item = item.parentNode) {
            if (item.matches(selector)) return item;
        }
        return null;
    }
    contains(target) {
        return this === target || this.children.some(child => child.contains(target));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        const matches = [];
        const visit = node => node.children.forEach(child => {
            if (child.matches(selector)) matches.push(child);
            visit(child);
        });
        visit(this);
        return matches;
    }
}

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, String(value)); }
    };
}

function makeMovieCard(id, title, poster = "/poster.jpg", meta = "2025 • Drama") {
    const card = new Element("a");
    card.className = "movie-card";
    card.dataset.id = id;
    const image = new Element("img");
    image.setAttribute("src", poster);
    const info = new Element("div");
    info.className = "movie-info";
    const heading = new Element("h3");
    heading.textContent = title;
    const metadata = new Element("p");
    metadata.textContent = meta;
    info.append(heading, metadata);
    card.append(image, info);
    return card;
}

function movieNightCatalogue(movies) {
    return { movies: movies.map(movie => ({ type: "movie", year: 2025, genre: "Drama", poster: "/poster.jpg", ...movie })) };
}

function browseCatalogue() {
    return {
        movies: [
            { id: "movie-a", type: "movie", title: "Alpha", year: 2020, genre: "Drama", poster: "/a.jpg" },
            { id: "movie-b", type: "movie", title: "Beta", year: 2024, genre: "Comedy", poster: "/b.jpg" }
        ],
        shows: [
            { id: "show-a", type: "show", title: "Amber", year: 2021, genre: "Drama", poster: "/a.jpg" },
            { id: "show-b", type: "show", title: "Blue", year: 2025, genre: "Comedy", poster: "/b.jpg" }
        ]
    };
}

async function loadBrowsePage(type, options = {}) {
    const prefix = type === "movies" ? "movie" : "show";
    const label = type === "movies" ? "Movies" : "TV shows";
    const ids = [
        `${prefix}s-grid`, `${prefix}-search`, `${prefix}-genre-filter`, `${prefix}-sort`,
        `${prefix}-reset-filters`, `${prefix}s-loading`, `${prefix}s-error`, `${prefix}s-retry`, `${prefix}-results`,
        `${prefix}s-empty-state`
    ];
    const elements = Object.fromEntries(ids.map(id => [id, new Element(id.includes("grid") ? "div" : "div")]));
    const listeners = {};
    const body = new Element("body");
    const document = {
        baseURI: "http://localhost/movie-night.html",
        body,
        addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
        dispatchEvent(event) { (listeners[event.type] || []).forEach(listener => listener(event)); },
        getElementById(id) { return elements[id] || null; },
        createElement(tag) { return new Element(tag); },
        createDocumentFragment() { return new Element("#document-fragment"); }
    };
    const data = options.catalogue || browseCatalogue();
    const loadCatalogue = options.loadCatalogue || (async () => data);
    const window = { CineFlixBrowseUtils: BrowseUtils, CineFlixCatalogue: { loadCatalogue } };
    const source = fs.readFileSync(path.join(root, `js/${type}.js`), "utf8");
    const context = vm.createContext({
        document, window, console: { error() {} },
        Event: class { constructor(type) { this.type = type; } }
    });
    vm.runInContext(catalogueBrowseSource, context);
    window.CineFlixCatalogueBrowse = context.CineFlixCatalogueBrowse;
    vm.runInContext(source, context);
    (listeners.DOMContentLoaded || []).forEach(listener => listener());
    await new Promise(resolve => setImmediate(resolve));
    return {
        document,
        elements,
        window,
        label,
        settle: () => new Promise(resolve => setImmediate(resolve))
    };
}

async function loadMovieNight(options = {}) {
    const saved = options.storage || createStorage();
    const elements = {};
    const listeners = {};
    const grid = new Element("div");
    grid.className = "movie-grid";
    const section = new Element("section");
    section.className = "movie-section";
    const main = new Element("main");
    main.append(section);
    const body = new Element("body");
    body.dataset.page = options.page || "movies";
    const document = {
        body,
        addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
        dispatchEvent(event) { (listeners[event.type] || []).forEach(listener => listener(event)); },
        querySelector(selector) { return selector === ".movie-grid" ? grid : selector === ".movie-section" ? section : null; },
        getElementById(id) { return elements[id] || null; },
        createElement(tag) { return new Element(tag); }
    };
    for (const id of [
        "night-setup", "night-voting", "night-results", "night-selected-movies", "night-options",
        "night-voters", "night-progress", "night-winner", "night-tally", "night-feedback",
        "night-start", "night-reset"
    ]) elements[id] = new Element(id.includes("button") ? "button" : "div");
    const catalogue = options.catalogue || movieNightCatalogue([]);
    const window = {
        localStorage: saved,
        location: { search: options.page === "movie-night" ? "" : "?movieNight=1", href: "" },
        confirm: () => true,
        CineFlixCatalogue: {
            loadCatalogue: options.loadCatalogue || (async () => catalogue),
            getItemById(data, id) {
                return [...(data.movies || []), ...(data.shows || [])].find(item => item.id === id) || null;
            }
        }
    };
    const context = vm.createContext({
        document, window, localStorage: saved, URL, URLSearchParams,
        Event: class { constructor(type) { this.type = type; } },
        alert() {}, console
    });
    vm.runInContext(movieNightSource, context);
    (listeners.DOMContentLoaded || []).forEach(listener => listener());
    await new Promise(resolve => setImmediate(resolve));
    return { document, elements, grid, section, storage: saved, window };
}

test("Movie Night stores catalogue IDs and keeps same-title movies distinct", async () => {
    const page = await loadMovieNight({ catalogue: movieNightCatalogue([
        { id: "movie-a", title: "Twin Title" },
        { id: "movie-b", title: "Twin Title" },
        { id: "movie-c", title: "Third Movie" }
    ]) });
    const first = makeMovieCard("movie-a", "Twin Title");
    const second = makeMovieCard("movie-b", "Twin Title");
    const third = makeMovieCard("movie-c", "Third Movie");
    page.grid.replaceChildren(first, second, third);

    page.grid.dispatch("click", { target: first });
    page.grid.dispatch("click", { target: second });
    page.grid.dispatch("click", { target: third });

    const saved = JSON.parse(page.storage.getItem(storageKey));
    assert.deepEqual(saved.selected, ["movie-a", "movie-b", "movie-c"]);
});

test("legacy title selections and votes migrate to stable catalogue IDs", async () => {
    const storage = createStorage({
        [storageKey]: JSON.stringify({
            selected: [
                { title: "Twin Title", poster: "/old-a.jpg", meta: "old" },
                { title: "Second Movie", poster: "/old-b.jpg", meta: "old" },
                { title: "Third Movie", poster: "/old-c.jpg", meta: "old" }
            ],
            voters: 3,
            votes: ["Twin Title", "Second Movie"],
            started: true
        })
    });
    const catalogue = movieNightCatalogue([
        { id: "movie-twin-1", title: "Twin Title" },
        { id: "movie-second", title: "Second Movie" },
        { id: "movie-third", title: "Third Movie" }
    ]);
    const page = await loadMovieNight({ page: "movie-night", catalogue, storage });
    page.elements["night-options"].querySelectorAll("button")[2].click();

    const saved = JSON.parse(storage.getItem(storageKey));
    assert.deepEqual(saved.selected, ["movie-twin-1", "movie-second", "movie-third"]);
    assert.deepEqual(saved.votes, ["movie-twin-1", "movie-second", "movie-third"]);
    assert.equal(page.elements["night-tally"].children[0].children[0].children[1].textContent, "1 vote(s)");
    assert.equal(page.elements["night-tally"].children[1].children[0].children[1].textContent, "1 vote(s)");
});

test("Movie Night selection is keyboard operable, announced, and limited to three", async () => {
    const page = await loadMovieNight({ catalogue: movieNightCatalogue([
        { id: "movie-a", title: "Movie A" }, { id: "movie-b", title: "Movie B" },
        { id: "movie-c", title: "Movie C" }, { id: "movie-d", title: "Movie D" }
    ]) });
    const cards = [
        makeMovieCard("movie-a", "Movie A"),
        makeMovieCard("movie-b", "Movie B"),
        makeMovieCard("movie-c", "Movie C"),
        makeMovieCard("movie-d", "Movie D")
    ];
    page.grid.replaceChildren(...cards);
    page.document.dispatchEvent({ type: "cineflix:movies-rendered" });
    let prevented = false;
    page.grid.dispatch("keydown", {
        target: cards[0], key: " ", preventDefault() { prevented = true; }
    });
    page.grid.dispatch("click", { target: cards[1] });
    page.grid.dispatch("click", { target: cards[2] });

    assert.equal(prevented, true);
    assert.equal(cards[0].getAttribute("role"), "checkbox");
    assert.equal(cards[0].getAttribute("aria-checked"), "true");
    assert.equal(cards[0].getAttribute("aria-label"), "Remove Movie A, 2025 • Drama from Movie Night");
    page.grid.dispatch("click", { target: cards[3] });
    assert.equal(JSON.parse(page.storage.getItem(storageKey)).selected.length, 3);
    assert.equal(cards[3].getAttribute("aria-checked"), "false");
});

test("Movie Night restores selection state after dynamic card rendering", async () => {
    const page = await loadMovieNight({ catalogue: movieNightCatalogue([{ id: "movie-a", title: "Movie A" }]) });
    const original = makeMovieCard("movie-a", "Movie A");
    page.grid.replaceChildren(original);
    page.document.dispatchEvent({ type: "cineflix:movies-rendered" });
    page.grid.dispatch("click", { target: original });

    const replacement = makeMovieCard("movie-a", "Movie A");
    page.grid.replaceChildren(replacement);
    page.document.dispatchEvent({ type: "cineflix:movies-rendered" });
    assert.equal(replacement.classList.contains("night-selected"), true);
    assert.equal(replacement.getAttribute("aria-checked"), "true");
});

test("votes and results distinguish movies with duplicate titles by ID", async () => {
    const initialState = {
        selected: [
            { id: "movie-twin-a", title: "Twin", poster: "/a.jpg", meta: "2024 • Drama" },
            { id: "movie-twin-b", title: "Twin", poster: "/b.jpg", meta: "2025 • Drama" },
            { id: "movie-other", title: "Other", poster: "/c.jpg", meta: "2023 • Comedy" }
        ],
        voters: 2,
        votes: [],
        started: true
    };
    const storage = createStorage({ [storageKey]: JSON.stringify(initialState) });
    const catalogue = movieNightCatalogue([
        { id: "movie-twin-a", title: "Twin" },
        { id: "movie-twin-b", title: "Twin" },
        { id: "movie-other", title: "Other" }
    ]);
    const page = await loadMovieNight({ page: "movie-night", catalogue, storage });
    const voteButtons = page.elements["night-options"].querySelectorAll("button");
    assert.equal(voteButtons.length, 3);
    voteButtons[1].click();
    page.elements["night-options"].querySelectorAll("button")[1].click();

    const saved = JSON.parse(storage.getItem(storageKey));
    assert.deepEqual(saved.votes, ["movie-twin-b", "movie-twin-b"]);
    const rows = page.elements["night-tally"].children;
    assert.equal(rows[0].children[0].children[1].textContent, "0 vote(s)");
    assert.equal(rows[1].children[0].children[1].textContent, "2 vote(s)");
});

test("legacy title sessions remain untouched when the catalogue cannot load", async () => {
    const storage = createStorage({
        [storageKey]: JSON.stringify({
            selected: ["Alpha", "Beta", "Gamma"],
            voters: 2,
            votes: ["Alpha"],
            started: true
        })
    });
    const page = await loadMovieNight({
        page: "movie-night",
        storage,
        loadCatalogue: async () => { throw new Error("offline"); }
    });
    assert.equal(page.elements["night-start"].disabled, true);
    assert.match(page.elements["night-feedback"].textContent, /could not load the catalogue/);
    assert.deepEqual(JSON.parse(storage.getItem(storageKey)), {
        selected: ["Alpha", "Beta", "Gamma"], voters: 2, votes: ["Alpha"], started: true
    });
});

test("an ambiguous legacy title selection or vote is never guessed", async () => {
    const storage = createStorage({
        [storageKey]: JSON.stringify({
            selected: [
                { id: "movie-twin-a", title: "Twin", poster: "/a.jpg", meta: "" },
                { id: "movie-twin-b", title: "Twin", poster: "/b.jpg", meta: "" },
                { id: "movie-other", title: "Other", poster: "/c.jpg", meta: "" }
            ],
            voters: 2,
            votes: ["Twin", "movie-other"],
            started: true
        })
    });
    const catalogue = movieNightCatalogue([
        { id: "movie-twin-a", title: "Twin" },
        { id: "movie-twin-b", title: "Twin" },
        { id: "movie-other", title: "Other" }
    ]);
    const page = await loadMovieNight({ page: "movie-night", storage, catalogue });
    assert.equal(page.elements["night-setup"].hidden, false);
    assert.equal(page.elements["night-results"].hidden, true);
    assert.match(page.elements["night-feedback"].textContent, /no longer valid/);
    assert.deepEqual(JSON.parse(storage.getItem(storageKey)).votes, ["Twin", "movie-other"]);
});

test("malformed Movie Night storage falls back to an empty, selectable session", async () => {
    const storage = createStorage({ [storageKey]: "not valid JSON" });
    const page = await loadMovieNight({ page: "movie-night", storage });
    assert.equal(page.elements["night-setup"].hidden, false);
    assert.equal(page.elements["night-selected-movies"].children.length, 3);
    assert.equal(page.elements["night-start"].disabled, true);
    assert.equal(storage.getItem(storageKey), "not valid JSON");
});

test("Movies clear filters resets search, genre, and sorting and rerenders counts", async () => {
    const page = await loadBrowsePage("movies");
    const { elements } = page;
    elements["movie-search"].value = "Beta";
    elements["movie-search"].dispatch("input");
    elements["movie-genre-filter"].value = "Comedy";
    elements["movie-genre-filter"].dispatch("change");
    elements["movie-sort"].value = "year-asc";
    elements["movie-sort"].dispatch("change");
    assert.deepEqual(elements["movies-grid"].children.map(card => card.dataset.id), ["movie-b"]);

    elements["movie-reset-filters"].click();
    assert.equal(elements["movie-search"].value, "");
    assert.equal(elements["movie-genre-filter"].value, "");
    assert.equal(elements["movie-sort"].value, "default");
    assert.deepEqual(elements["movies-grid"].children.map(card => card.dataset.id), ["movie-a", "movie-b"]);
    assert.equal(elements["movie-results"].textContent, "Showing 2 of 2 movies");
});

test("TV Shows clear filters resets search, genre, and sorting and rerenders counts", async () => {
    const page = await loadBrowsePage("shows");
    const { elements } = page;
    elements["show-search"].value = "Blue";
    elements["show-search"].dispatch("input");
    elements["show-genre-filter"].value = "Comedy";
    elements["show-genre-filter"].dispatch("change");
    elements["show-sort"].value = "year-asc";
    elements["show-sort"].dispatch("change");
    assert.deepEqual(elements["shows-grid"].children.map(card => card.dataset.id), ["show-b"]);

    elements["show-reset-filters"].click();
    assert.equal(elements["show-search"].value, "");
    assert.equal(elements["show-genre-filter"].value, "");
    assert.equal(elements["show-sort"].value, "default");
    assert.deepEqual(elements["shows-grid"].children.map(card => card.dataset.id), ["show-a", "show-b"]);
    assert.equal(elements["show-results"].textContent, "Showing 2 of 2 TV shows");
});

test("Movies and Shows retry actions call the catalogue loader again", async () => {
    for (const type of ["movies", "shows"]) {
        let attempts = 0;
        let finishRetry;
        const page = await loadBrowsePage(type, {
            loadCatalogue() {
                attempts += 1;
                if (attempts === 1) return Promise.reject(new Error("temporary failure"));
                return new Promise(resolve => { finishRetry = resolve; });
            }
        });
        const prefix = type === "movies" ? "movie" : "show";
        const plural = type;
        const retry = page.elements[`${plural}-retry`];
        assert.equal(attempts, 1);
        assert.equal(retry.hidden, false);
        assert.equal(retry.disabled, false);
        assert.equal(page.elements[`${plural}-loading`].hidden, true);
        assert.equal(page.elements[`${plural}-error`].hidden, false);
        assert.equal(page.elements[`${prefix}-reset-filters`].disabled, true);
        assert.equal(page.elements[`${plural}-grid`].getAttribute("aria-busy"), "false");

        retry.click();
        assert.equal(attempts, 2);
        assert.equal(retry.hidden, true);
        assert.equal(page.elements[`${plural}-loading`].hidden, false);
        assert.equal(page.elements[`${plural}-error`].hidden, true);
        assert.equal(page.elements[`${plural}-grid`].getAttribute("aria-busy"), "true");
        finishRetry(browseCatalogue());
        await page.settle();
        assert.equal(retry.hidden, true);
        assert.equal(page.elements[`${prefix}-reset-filters`].disabled, false);
        assert.equal(page.elements[`${plural}-loading`].hidden, true);
        assert.equal(page.elements[`${plural}-error`].hidden, true);
        assert.equal(page.elements[`${prefix}-results`].textContent,
            type === "movies" ? "Showing 2 of 2 movies" : "Showing 2 of 2 TV shows");
    }
});

test("empty Movies and Shows catalogues keep the empty state and counts correct", async () => {
    for (const type of ["movies", "shows"]) {
        const page = await loadBrowsePage(type, { catalogue: { movies: [], shows: [] } });
        const prefix = type === "movies" ? "movie" : "show";
        assert.equal(page.elements[`${type}-loading`].hidden, true);
        assert.equal(page.elements[`${type}-error`].hidden, true);
        assert.equal(page.elements[`${type}-empty-state`].hidden, false);
        assert.equal(page.elements[`${type}-grid`].getAttribute("aria-busy"), "false");
        assert.equal(page.elements[`${prefix}-results`].textContent,
            type === "movies" ? "Showing 0 of 0 movies" : "Showing 0 of 0 TV shows");
    }
});
