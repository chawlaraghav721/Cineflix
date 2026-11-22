"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { ratingsDatabase } = require("../test-support/ratingsDatabase.cjs");
const repository = require("../src/repositories/ratingRepository");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");

test("owner-scoped persistence and actual MongoDB uniqueness", { timeout: 60000 }, async t => {
    const { mongo, Rating } = await ratingsDatabase(t);
    const a = String(new mongoose.Types.ObjectId()), b = String(new mongoose.Types.ObjectId());
    await t.test("create edit omitted-review clear and idempotent deletion preserve other users and titles", async () => {
        assert.equal(await repository.findOwn(a, "movie-004"), null);
        assert.deepEqual(await repository.saveOwn(a, "movie-004", { score: 4, reviewText: "A" }), { score: 4, reviewText: "A" });
        const first = await Rating.findOne({ user: a, itemId: "movie-004" }).lean();
        assert(first.createdAt instanceof Date); assert(first.updatedAt instanceof Date);
        await Rating.collection.updateOne({ _id: first._id }, { $set: { updatedAt: new Date(0) } });
        assert.deepEqual(await repository.saveOwn(a, "movie-004", { score: 5 }), { score: 5, reviewText: "A" });
        const edited = await Rating.findById(first._id).lean();
        assert.equal(edited.createdAt.getTime(), first.createdAt.getTime()); assert(edited.updatedAt.getTime() > 0);
        await repository.saveOwn(b, "movie-004", { score: 2, reviewText: "B" });
        await repository.saveOwn(a, "show-001", { score: 3 });
        assert.deepEqual(await repository.saveOwn(a, "movie-004", { score: 1, reviewText: "" }), { score: 1, reviewText: "" });
        await repository.removeOwn(a, "movie-004"); await repository.removeOwn(a, "movie-004");
        assert.equal(await repository.findOwn(a, "movie-004"), null);
        assert.equal((await repository.findOwn(b, "movie-004")).score, 2);
        assert.equal((await repository.findOwn(a, "show-001")).score, 3);
    });
    await t.test("concurrent upserts and the physical compound index prevent duplicate rows", async () => {
        const indexes = await Rating.collection.indexes();
        assert(indexes.some(index => index.unique && index.key.user === 1 && index.key.itemId === 1));
        await Promise.all(Array.from({ length: 24 }, (_, i) => repository.saveOwn(a, "movie-005", { score: i % 5 + 1 })));
        assert.equal(await Rating.countDocuments({ user: a, itemId: "movie-005" }), 1);
        await assert.rejects(Rating.create({ user: a, itemId: "movie-005", score: 3 }), { code: 11000 });
    });
    await t.test("records survive reconnecting the existing shared connection", async () => {
        await disconnectDatabase(); await connectDatabase(mongo.getUri());
        assert.deepEqual(await repository.findOwn(b, "movie-004"), { score: 2, reviewText: "B" });
    });
});
