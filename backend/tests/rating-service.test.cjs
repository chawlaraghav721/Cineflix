"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRatingService } = require("../src/services/ratingService");
const actor = { id: "000000000000000000000001" };
function fixture() {
    const calls = [];
    const service = createRatingService({ titles: { exists: async filter => { calls.push(filter); return filter.id === "movie-004"; } },
        ratings: {
            community: async () => ({ average: null, count: 0, reviews: [] }),
            findOwn: async (...args) => { calls.push(args); return null; },
            saveOwn: async (...args) => { calls.push(args); return { ...args[2], reviewText: args[2].reviewText || "", user: "private", _id: "private" }; },
            removeOwn: async (...args) => { calls.push(args); }
        } });
    return { service, calls };
}

test("service checks catalogue IDs, uses the actor exclusively and returns agreed DTOs", async () => {
    const { service, calls } = fixture();
    assert.deepEqual(await service.summary("movie-004"), { average: null, count: 0, reviews: [] });
    assert.deepEqual(await service.own(actor, "movie-004"), { rating: null });
    assert.deepEqual(await service.save(actor, "movie-004", { score: 4, reviewText: " A " }), { score: 4, reviewText: "A" });
    await service.remove(actor, "movie-004");
    assert(calls.some(value => Array.isArray(value) && value[0] === actor.id && value[1] === "movie-004"));
    assert(calls.filter(value => !Array.isArray(value)).every(value => value.id === "movie-004"));
});

test("every operation rejects missing titles without accessing rating persistence", async () => {
    const { service, calls } = fixture();
    for (const work of [() => service.summary("missing"), () => service.own(actor, "missing"),
        () => service.save(actor, "missing", { score: 4 }), () => service.remove(actor, "missing")]) {
        await assert.rejects(work(), { status: 404, code: "TITLE_NOT_FOUND" });
    }
    assert(!calls.some(Array.isArray));
});

test("service independently enforces authentication and payload validation", async () => {
    const { service, calls } = fixture();
    await assert.rejects(service.own(null, "movie-004"), { status: 401 });
    await assert.rejects(service.save(null, "movie-004", { score: 4 }), { status: 401 });
    await assert.rejects(service.remove(null, "movie-004"), { status: 401 });
    await assert.rejects(service.save(actor, "movie-004", { score: 4, userId: actor.id }), { code: "INVALID_RATING" });
    await assert.rejects(service.summary({ $ne: null }), { code: "INVALID_ITEM_ID" });
    assert.equal(calls.length, 0);
});

test("database failures propagate for generic HTTP error handling", async () => {
    const failure = new Error("test-only private database failure");
    const service = createRatingService({ titles: { exists: async () => { throw failure; } } });
    await assert.rejects(service.save(actor, "movie-004", { score: 4 }), failure);
});
