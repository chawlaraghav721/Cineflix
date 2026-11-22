"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { ratingsDatabase } = require("../test-support/ratingsDatabase.cjs");
const { community, saveOwn, removeOwn } = require("../src/repositories/ratingRepository");

test("community aggregation uses stored scores with deterministic anonymous recent reviews", async t => {
    const { Rating } = await ratingsDatabase(t);
    assert.deepEqual(await community("movie-004"), { average: null, count: 0, reviews: [] });
    const date = new Date("2026-01-01T00:00:00Z");
    const records = Array.from({ length: 25 }, (_, i) => ({ _id: new mongoose.Types.ObjectId(),
        user: new mongoose.Types.ObjectId(), itemId: "movie-004", score: i % 5 + 1,
        reviewText: i === 0 ? "" : `Review ${i}`, createdAt: date, updatedAt: date }));
    await Rating.insertMany(records);
    const result = await community("movie-004");
    assert.equal(result.count, 25); assert.equal(result.average, 3);
    assert.equal(result.reviews.length, 20);
    assert.deepEqual(result.reviews.map(review => review.reviewText), records.slice(-20).reverse().map(record => record.reviewText));
    for (const review of result.reviews) assert.deepEqual(Object.keys(review).sort(), ["createdAt", "reviewText", "score", "updatedAt"]);
    assert.deepEqual(await community("movie-004"), result);
    await saveOwn(String(records[1].user), "movie-004", { score: 5, reviewText: "Most recent" });
    const updated = await community("movie-004");
    assert.equal(updated.reviews[0].reviewText, "Most recent");
    assert.equal(updated.average, 78 / 25);
    await removeOwn(String(records[1].user), "movie-004");
    const deleted = await community("movie-004");
    assert.equal(deleted.count, 24); assert.equal(deleted.average, 73 / 24);
    assert.deepEqual(await community("show-001"), { average: null, count: 0, reviews: [] });
});
