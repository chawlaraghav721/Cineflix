const test = require("node:test");
const assert = require("node:assert/strict");

const BrowseUtils = require("../js/browse-utils.js");

const sampleItems = [
    {
        id: "movie-001",
        title: "The Matrix",
        year: 1999,
        genre: "Action / Sci-Fi",
        description: "A computer hacker discovers an unusual reality.",
        cast: ["Keanu Reeves", "Carrie-Anne Moss"]
    },
    {
        id: "movie-002",
        title: "Arrival",
        year: 2016,
        genre: "Drama, Sci-Fi",
        description: "A linguist works to communicate with visitors.",
        director: "Denis Villeneuve"
    },
    {
        id: "movie-003",
        title: "Parasite",
        year: 2019,
        genre: "Drama/Horror",
        rating: 8.5
    },
    {
        id: "movie-004",
        title: "A Quiet Place",
        year: null,
        genre: "Horror",
        duration: "90 minutes"
    },
    {
        id: "movie-005",
        title: "Another World",
        genre: "action | Adventure",
        description: "A sample entry with no verified year."
    }
];

test("getGenres extracts unique labels from multi-genre strings", function () {
    assert.deepEqual(
        BrowseUtils.getGenres(sampleItems),
        ["Action", "Adventure", "Drama", "Horror", "Sci-Fi"]
    );
});

test("getGenres is case-insensitive when removing duplicates", function () {
    const items = [
        { genre: "Action" },
        { genre: "action / Drama" },
        { genre: "DRAMA" }
    ];

    assert.deepEqual(BrowseUtils.getGenres(items), ["Action", "Drama"]);
});

test("getGenres safely handles non-array input and missing genres", function () {
    assert.deepEqual(BrowseUtils.getGenres(null), []);
    assert.deepEqual(BrowseUtils.getGenres([{ title: "No genre" }, null]), []);
});

test("matchesSearch is case-insensitive and searches title and metadata", function () {
    assert.equal(BrowseUtils.matchesSearch(sampleItems[0], "MATRIX"), true);
    assert.equal(BrowseUtils.matchesSearch(sampleItems[0], "keanu"), true);
    assert.equal(BrowseUtils.matchesSearch(sampleItems[1], "2016"), true);
    assert.equal(BrowseUtils.matchesSearch(sampleItems[1], "villeneuve"), true);
    assert.equal(BrowseUtils.matchesSearch(sampleItems[2], "8.5"), true);
});

test("matchesSearch treats an empty query as no restriction", function () {
    assert.equal(BrowseUtils.matchesSearch(sampleItems[0], "   "), true);
});

test("genre matching uses complete labels from multi-genre strings", function () {
    assert.equal(BrowseUtils.matchesGenre(sampleItems[0], "sci-fi"), true);
    assert.equal(BrowseUtils.matchesGenre(sampleItems[2], "Horror"), true);
    assert.equal(BrowseUtils.matchesGenre(sampleItems[0], "fi"), false);
    assert.equal(BrowseUtils.matchesGenre(sampleItems[0], "Drama"), false);
    assert.equal(BrowseUtils.matchesGenre(sampleItems[0], ""), true);
});

test("filterItems combines search and genre without mutating the source", function () {
    const sourceOrder = sampleItems.map(function (item) { return item.id; });
    const filtered = BrowseUtils.filterItems(sampleItems, {
        query: "reality",
        genre: "Sci-Fi"
    });

    assert.deepEqual(filtered.map(function (item) { return item.id; }), ["movie-001"]);
    assert.deepEqual(sampleItems.map(function (item) { return item.id; }), sourceOrder);
    assert.notStrictEqual(filtered, sampleItems);
});

test("sortItems sorts titles case-insensitively and preserves ties", function () {
    const items = [
        { id: "b", title: "beta" },
        { id: "a", title: "Alpha" },
        { id: "a2", title: "alpha" }
    ];

    assert.deepEqual(
        BrowseUtils.sortItems(items, "title-asc").map(function (item) { return item.id; }),
        ["a", "a2", "b"]
    );
    assert.deepEqual(
        BrowseUtils.sortItems(items, "title-desc").map(function (item) { return item.id; }),
        ["b", "a", "a2"]
    );
});

test("year sorting is numeric and keeps missing years last", function () {
    const newestFirst = BrowseUtils.sortItems(sampleItems, "year-desc");
    const oldestFirst = BrowseUtils.sortItems(sampleItems, "year-asc");

    assert.deepEqual(
        newestFirst.map(function (item) { return item.id; }),
        ["movie-003", "movie-002", "movie-001", "movie-004", "movie-005"]
    );
    assert.deepEqual(
        oldestFirst.map(function (item) { return item.id; }),
        ["movie-001", "movie-002", "movie-003", "movie-004", "movie-005"]
    );
});

test("default and unknown sort modes preserve the input order in a new array", function () {
    const defaultResult = BrowseUtils.sortItems(sampleItems, "default");
    const unknownResult = BrowseUtils.sortItems(sampleItems, "newest-ever");

    assert.deepEqual(defaultResult, sampleItems);
    assert.deepEqual(unknownResult, sampleItems);
    assert.notStrictEqual(defaultResult, sampleItems);
    assert.notStrictEqual(unknownResult, sampleItems);
});

test("getVisibleItems applies search, genre and sort as one pipeline", function () {
    const result = BrowseUtils.getVisibleItems(sampleItems, {
        query: "a",
        genre: "Sci-Fi",
        sortBy: "year-desc"
    });

    assert.deepEqual(
        result.map(function (item) { return item.id; }),
        ["movie-002", "movie-001"]
    );
});

test("browsing utilities safely handle invalid collections and entries", function () {
    assert.deepEqual(BrowseUtils.filterItems(null, { query: "test" }), []);
    assert.deepEqual(BrowseUtils.sortItems(undefined, "title-asc"), []);
    assert.deepEqual(BrowseUtils.getVisibleItems({}, {}), []);
    assert.deepEqual(
        BrowseUtils.getVisibleItems([null, undefined, { id: "ok", title: "Valid" }], {}),
        [{ id: "ok", title: "Valid" }]
    );
});

test("the utility API is available as a browser-style global", function () {
    assert.strictEqual(globalThis.CineFlixBrowseUtils, BrowseUtils);
});
