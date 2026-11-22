"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Rating = require("../src/models/Rating");
const base = { user: new mongoose.Types.ObjectId(), itemId: "movie-004", score: 4 };

test("Rating uses the shared connection, timestamps, immutable relationships and unique index", async () => {
    assert.equal(Rating.db, mongoose.connection);
    assert.equal(Rating.collection.name, "ratings");
    assert.equal(Rating.schema.options.timestamps, true);
    assert.equal(Rating.schema.options.autoIndex, false);
    for (const key of ["user", "itemId"]) assert.equal(Rating.schema.path(key).options.immutable, true);
    assert(Rating.schema.indexes().some(([keys, options]) => keys.user === 1 && keys.itemId === 1 && options.unique));
    assert(Rating.schema.indexes().some(([keys]) => keys.itemId === 1 && keys.updatedAt === -1 && keys._id === -1));
    assert.equal(new Rating(base).reviewText, "");
    for (let score = 1; score <= 5; score++) await new Rating({ ...base, score }).validate();
    const review = new Rating({ ...base, reviewText: " A review " });
    await review.validate(); assert.equal(review.reviewText, "A review");
    await new Rating({ ...base, reviewText: "x".repeat(2000) }).validate();
});

test("Rating rejects invalid types, missing relationships, score ranges and oversized reviews", async () => {
    for (const score of [0, 6, 1.5, NaN, Infinity, "4", true, null, undefined, { $gt: 0 }]) {
        await assert.rejects(new Rating({ ...base, score }).validate(), { name: "ValidationError" });
    }
    for (const change of [{ user: null }, { user: "bad" }, { itemId: null }, { itemId: "" },
        { itemId: "$ne" }, { itemId: " movie-004" }, { itemId: "x".repeat(129) },
        { reviewText: null }, { reviewText: 5 }, { reviewText: {} }, { reviewText: "x".repeat(2001) }]) {
        await assert.rejects(new Rating({ ...base, ...change }).validate(), { name: "ValidationError" });
    }
    assert.throws(() => new Rating({ ...base, userId: base.user }), { name: "StrictModeError" });
});
