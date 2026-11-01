const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A restored document keeps its scripts and DOM. Simulate the persisted pageshow
// after the shared list has changed while this page was away.
test('My List refreshes saved cards when restored from the back-forward cache', async () => {
    class Element {
        constructor() { this.children = []; this.dataset = {}; this.value = ''; }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute() {}
        addEventListener() {}
    }
    const ids = Object.fromEntries(['mylist-grid', 'mylist-add', 'mylist-search', 'mylist-clear', 'mylist-retry', 'mylist-status', 'mylist-error'].map(id => [id, new Element()]));
    const events = {};
    let saved = [];
    const item = { id: 'movie-011', title: 'Inception', year: 2010, genre: 'Thriller', poster: '' };
    const window = {
        CineFlixCatalogue: { loadCatalogue: async () => ({ movies: [item], shows: [] }), getItemById: (_, id) => id === item.id ? item : null },
        CineFlixMyList: { getMyListIds: () => saved, isStorageAvailable: () => true },
        addEventListener(type, callback) { (events[type] ||= []).push(callback); }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/mylist.js'), 'utf8'), {
        window, URL,
        document: { baseURI: 'http://localhost/mylist.html', getElementById: id => ids[id], createElement: () => new Element() }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ids['mylist-grid'].children.length, 1); // browse link only
    saved = [item.id];
    for (const callback of events.pageshow || []) callback({ persisted: true });
    assert.equal(ids['mylist-grid'].children[0].dataset.id, item.id);
    assert.match(ids['mylist-status'].textContent, /1 saved/);
    saved = [];
    for (const callback of events.pageshow || []) callback({ persisted: true });
    assert.equal(ids['mylist-grid'].children.length, 1);
    assert.match(ids['mylist-status'].textContent, /empty/);
});
