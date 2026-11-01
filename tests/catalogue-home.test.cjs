const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/catalogue.js'), 'utf8');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'data/catalogue.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const response = data => ({ ok: true, json: async () => data });

function loader(fetch) {
    const window = {};
    vm.runInNewContext(source, { window, fetch });
    return window.CineFlixCatalogue;
}

test('catalogue preserves original identity fields and all uncorrected poster references', () => {
    const original = JSON.parse(execFileSync('git', ['show', 'a801fa4:data/catalogue.json'], { cwd: root, encoding: 'utf8' }));
    assert.deepEqual(Object.keys(catalogue), ['movies', 'shows']);
    assert.equal(catalogue.movies.length, 20);
    assert.equal(catalogue.shows.length, 10);
    for (const collection of ['movies', 'shows']) {
        assert.deepEqual(catalogue[collection].map(item => item.id), original[collection].map(item => item.id));
        catalogue[collection].forEach((item, index) => {
            for (const field of ['id', 'title', 'type', 'year', 'genre']) {
                assert.equal(item[field], original[collection][index][field], item.id + ': ' + field);
            }
            assert.equal(item.poster, item.id === 'show-006'
                ? 'images/run-away-placeholder.svg' : original[collection][index].poster, item.id + ': poster');
        });
    }
});

test('catalogue has unique IDs and schema-compatible metadata and embed references', async () => {
    await loader(async () => response(catalogue)).loadCatalogue();
    const items = [...catalogue.movies, ...catalogue.shows];
    assert.equal(new Set(items.map(item => item.id)).size, 30);
    assert.equal(new Set(items.map(item => item.title.toLowerCase())).size, 30);
    for (const item of items) {
        assert.equal(typeof item.description, 'string');
        assert(Array.isArray(item.cast));
        assert(item.cast.every(name => typeof name === 'string' && name.trim()));
        assert.equal(typeof item.director, 'string');
        assert.equal(typeof item.trailerUrl, 'string');
        assert(['http:', 'https:'].includes(new URL(item.poster, 'http://localhost/').protocol));
        if (!/^https?:\/\//.test(item.poster)) assert(fs.existsSync(path.join(root, item.poster)));
        if (item.trailerUrl) assert.match(item.trailerUrl, /^https:\/\/www\.youtube\.com\/embed\/[A-Za-z0-9_-]{11}$/);
    }
});

test('Run Away placeholder is self-contained vector shapes and text', () => {
    const poster = catalogue.shows.find(item => item.id === 'show-006').poster;
    const svg = fs.readFileSync(path.join(root, poster), 'utf8');
    const allowed = new Set(['svg', 'title', 'desc', 'rect', 'circle', 'path', 'text']);
    for (const [, tag] of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)) assert(allowed.has(tag), tag);
    assert(!/\bhref\s*=|\bon\w+\s*=|url\s*\(|data:/i.test(svg));
    assert(svg.includes('Run Away'));
    assert(svg.includes('Poster unavailable'));
});

test('loader shares one Promise and one request, including after resolution', async () => {
    let requests = 0;
    let finish;
    const api = loader(url => {
        assert.equal(url, 'data/catalogue.json');
        requests++;
        return new Promise(resolve => { finish = resolve; });
    });
    const first = api.loadCatalogue();
    assert.equal(first, api.loadCatalogue());
    await Promise.resolve();
    assert.equal(requests, 1);
    finish(response(catalogue));
    assert.equal(await first, catalogue);
    assert.equal(first, api.loadCatalogue());
    assert.equal(requests, 1);
});

test('public lookup returns a fresh combined array, exact object or null', () => {
    const api = loader();
    const items = api.getAllItems(catalogue);
    assert.equal(items.length, 30);
    assert.notEqual(items, catalogue.movies);
    items.pop();
    assert.equal(api.getAllItems(catalogue).length, 30);
    for (const item of [...catalogue.movies, ...catalogue.shows]) assert.equal(api.getItemById(catalogue, item.id), item);
    for (const id of [undefined, null, '', ' ', 4, {}, 'missing', ' movie-001']) assert.equal(api.getItemById(catalogue, id), null);
});

for (const [name, failure, message] of [
    ['network rejection', () => Promise.reject(new Error('offline')), /offline/],
    ['synchronous fetch exception', () => { throw new Error('offline'); }, /offline/],
    ['HTTP failure', () => ({ ok: false, status: 503 }), /HTTP 503/],
    ['invalid JSON', () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }), /invalid JSON/],
    ['invalid data', () => response({ movies: [], shows: null }), /arrays/]
]) {
    test('loader clears a rejected Promise and retries after ' + name, async () => {
        let requests = 0;
        const api = loader(() => ++requests === 1 ? failure() : response(catalogue));
        const failed = api.loadCatalogue();
        assert.equal(failed, api.loadCatalogue());
        await assert.rejects(failed, message);
        const retried = api.loadCatalogue();
        assert.notEqual(retried, failed);
        assert.equal(await retried, catalogue);
        assert.equal(requests, 2);
    });
}

for (const [name, mutate] of [
    ['duplicate ID across collections', data => { data.shows[0].id = data.movies[0].id; }],
    ['wrong classification', data => { data.movies[0].type = 'show'; }],
    ['blank ID', data => { data.movies[0].id = ' '; }],
    ['blank title', data => { data.movies[0].title = ''; }],
    ['missing description', data => { delete data.movies[0].description; }],
    ['string year', data => { data.movies[0].year = '2025'; }],
    ['fractional year', data => { data.movies[0].year = 2025.5; }],
    ['string cast', data => { data.movies[0].cast = 'Actor'; }],
    ['non-string cast member', data => { data.movies[0].cast = [123]; }],
    ['object director', data => { data.movies[0].director = {}; }],
    ['non-string trailer', data => { data.movies[0].trailerUrl = 123; }]
]) {
    test('loader rejects ' + name, async () => {
        const data = clone(catalogue);
        mutate(data);
        await assert.rejects(loader(() => response(data)).loadCatalogue());
    });
}

test('loader accepts empty collections and absent optional metadata', async () => {
    const data = clone(catalogue);
    for (const item of [...data.movies, ...data.shows]) {
        for (const field of ['year', 'rating', 'cast', 'director', 'duration', 'trailerUrl']) delete item[field];
    }
    assert.equal(await loader(() => response(data)).loadCatalogue(), data);
    const empty = { movies: [], shows: [] };
    assert.equal(await loader(() => response(empty)).loadCatalogue(), empty);
});

test('Home markup loads the shared loader first and contains no permanent movie cards', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert(html.indexOf('src="js/catalogue.js"') < html.indexOf('src="js/home.js"'));
    assert(!/class="movie-card"/.test(html));
    for (const id of ['trending-grid', 'popular-grid', 'home-retry', 'featured-previous', 'featured-next', 'featured-surprise']) {
        assert(html.includes('id="' + id + '"'));
    }
});
