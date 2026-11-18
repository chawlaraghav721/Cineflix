"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRatingRepository, createRatingTitleRepository } = require("../src/repositories/ratingRepository.cjs");

const scope = { user: "000000000000000000000001", itemId: "movie-004", userId: "untrusted" };
const query = value => ({ lean() { return this; }, exec: async () => value });

test("repository reads, updates and deletes filter by both user and stable item ID", async () => {
    const calls = [];
    const Rating = Object.fromEntries(["findOne", "findOneAndUpdate", "deleteOne"].map(method => [method, (...args) => {
        calls.push([method, ...args]); return query({ score: 4, reviewText: "" });
    }]));
    const repo = createRatingRepository({ Rating });
    await repo.findOwn(scope);
    await repo.upsertOwn(scope, { score: 4, user: "bad", average: 5 });
    await repo.deleteOwn(scope);
    calls.forEach(call => assert.deepEqual(call[1], { user: scope.user, itemId: scope.itemId }));
    assert.deepEqual(calls[1][2], { $set: { score: 4 } });
    assert.equal(calls[1][3].upsert, true);
    assert.equal(calls[1][3].runValidators, true);
    assert.equal(calls[1][3].returnDocument, "after");
});

test("concurrent unique-key collision retries once with the same owner and no upsert", async () => {
    const calls = [];
    const duplicate = Object.assign(new Error("duplicate"), { code: 11000, keyPattern: { user: 1, itemId: 1 } });
    const repo = createRatingRepository({ Rating: { findOneAndUpdate(...args) {
        calls.push(args);
        return { lean() { return this; }, exec: async () => {
            if (calls.length === 1) throw duplicate;
            return { score: 5, reviewText: "" };
        } };
    } } });
    assert.equal((await repo.upsertOwn(scope, { score: 5 })).score, 5);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0][0], calls[1][0]);
    assert.equal(calls[1][2].upsert, false);
});

test("unrelated duplicate-key and failed retry are not swallowed", async () => {
    for (const keyPattern of [{ unrelated: 1 }, { user: 1, itemId: 1 }]) {
        let calls = 0;
        const failure = Object.assign(new Error("duplicate"), { code: 11000, keyPattern });
        const repo = createRatingRepository({ Rating: { findOneAndUpdate() {
            return { lean() { return this; }, exec: async () => { if (++calls === 1) throw failure; return null; } };
        } } });
        await assert.rejects(repo.upsertOwn(scope, { score: 4 }), failure);
        assert.equal(calls, keyPattern.user ? 2 : 1);
    }
});

test("summary pipeline counts every score, bounds reviews, and strips private identifiers", async () => {
    let pipeline;
    const repo = createRatingRepository({ Rating: { aggregate(value) {
        pipeline = value;
        return query([{ totals: [{ average: 3.5, count: 2 }], reviews: [{ score: 5, reviewText: "Great" }] }]);
    } } });
    assert.deepEqual(await repo.summary("movie-004"), { average: 3.5, count: 2, reviews: [{ score: 5, reviewText: "Great" }] });
    assert.deepEqual(pipeline[0], { $match: { itemId: "movie-004" } });
    const facet = pipeline[1].$facet;
    assert.deepEqual(facet.totals, [{ $group: { _id: null, average: { $avg: "$score" }, count: { $sum: 1 } } }]);
    assert(facet.reviews.some(stage => stage.$limit === 20));
    assert.deepEqual(facet.reviews.at(-1).$project, { _id: 0, score: 1, reviewText: 1, createdAt: 1, updatedAt: 1 });
});

test("empty aggregation returns null average and zero count; title lookup uses id", async () => {
    const repo = createRatingRepository({ Rating: { aggregate: () => query([{ totals: [], reviews: [] }]) } });
    assert.deepEqual(await repo.summary("show-001"), { average: null, count: 0, reviews: [] });
    let filter;
    const titles = createRatingTitleRepository({ Title: { exists: value => { filter = value; return query({ _id: "internal" }); } } });
    assert.equal(await titles.exists("show-001"), true);
    assert.deepEqual(filter, { id: "show-001" });
});
