const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "my-list-storage.js"), "utf8");
const STORAGE_KEY = "cineflixMyList";

function createStorage(initialValue = null) {
    return {
        value: initialValue,
        readsBlocked: false,
        writesBlocked: false,
        writes: 0,
        getItem() {
            if (this.readsBlocked) throw new Error("Storage read blocked");
            return this.value;
        },
        setItem(key, value) {
            assert.equal(key, STORAGE_KEY);
            this.writes += 1;
            if (this.writesBlocked) throw new Error("Storage write blocked");
            this.value = value;
        }
    };
}

function loadMyList(storage = createStorage()) {
    const events = [];
    const window = {
        localStorage: storage,
        dispatchEvent(event) {
            events.push(event);
            return true;
        }
    };
    vm.runInNewContext(source, {
        window,
        Event: class {
            constructor(type) { this.type = type; }
        }
    });
    return { api: window.CineFlixMyList, events, storage };
}

test("a new My List starts empty", () => {
    const { api } = loadMyList();
    assert.deepEqual(Array.from(api.getMyListIds()), []);
    assert.equal(api.isStorageAvailable(), true);
});

test("valid movie and show IDs can be added", () => {
    const { api } = loadMyList();
    assert.equal(api.addToMyList("movie-011"), true);
    assert.equal(api.addToMyList("show-001"), true);
    assert.deepEqual(Array.from(api.getMyListIds()), ["movie-011", "show-001"]);
});

test("duplicate IDs cannot be added", () => {
    const { api } = loadMyList();
    assert.equal(api.addToMyList("movie-011"), true);
    assert.equal(api.addToMyList("movie-011"), false);
    assert.deepEqual(Array.from(api.getMyListIds()), ["movie-011"]);
});

test("a saved title can be removed", () => {
    const { api } = loadMyList();
    api.addToMyList("movie-011");
    api.addToMyList("show-001");
    assert.equal(api.removeFromMyList("movie-011"), true);
    assert.deepEqual(Array.from(api.getMyListIds()), ["show-001"]);
});

test("clearing My List removes all saved IDs", () => {
    const { api } = loadMyList();
    api.addToMyList("movie-011");
    api.addToMyList("show-001");
    assert.equal(api.clearMyList(), true);
    assert.deepEqual(Array.from(api.getMyListIds()), []);
    assert.equal(api.clearMyList(), false);
});

test("invalid IDs are rejected without changing storage", () => {
    const { api, storage } = loadMyList();
    for (const id of [null, undefined, 0, {}, "", " ", " movie-011"]) {
        assert.equal(api.addToMyList(id), false);
        assert.equal(api.removeFromMyList(id), false);
        assert.equal(api.isInMyList(id), false);
    }
    assert.equal(storage.value, null);
});

test("corrupted and non-array storage is handled as an empty list", () => {
    for (const raw of ["not-json", "null", "{}", '"movie-011"']) {
        const { api } = loadMyList(createStorage(raw));
        assert.deepEqual(Array.from(api.getMyListIds()), []);
    }
});

test("storage read and write failures do not overwrite existing saved data", () => {
    const blockedRead = createStorage('["movie-011"]');
    blockedRead.readsBlocked = true;
    const readCase = loadMyList(blockedRead);
    assert.equal(readCase.api.isStorageAvailable(), false);
    assert.equal(readCase.api.addToMyList("show-001"), false);
    assert.equal(readCase.api.removeFromMyList("movie-011"), false);
    assert.equal(readCase.api.clearMyList(), false);
    assert.equal(blockedRead.value, '["movie-011"]');
    assert.equal(blockedRead.writes, 0);

    const blockedWrite = createStorage('["movie-011"]');
    blockedWrite.writesBlocked = true;
    const writeCase = loadMyList(blockedWrite);
    assert.equal(writeCase.api.addToMyList("show-001"), false);
    assert.equal(blockedWrite.value, '["movie-011"]');
    assert.equal(writeCase.api.removeFromMyList("movie-011"), false);
    assert.equal(writeCase.api.clearMyList(), false);
    assert.equal(blockedWrite.value, '["movie-011"]');
    assert.equal(writeCase.events.length, 0);
});

test("the update event fires after successful changes only", () => {
    const { api, events } = loadMyList();
    assert.equal(api.addToMyList("movie-011"), true);
    assert.equal(api.addToMyList("movie-011"), false);
    assert.equal(api.addToMyList("show-001"), true);
    assert.equal(api.removeFromMyList("movie-011"), true);
    assert.equal(api.clearMyList(), true);
    assert.deepEqual(events.map(event => event.type), [
        "cineflix:list-updated",
        "cineflix:list-updated",
        "cineflix:list-updated",
        "cineflix:list-updated"
    ]);
});
