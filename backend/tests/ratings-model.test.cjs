"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRatingModel } = require("../src/models/Rating.cjs");
let mongoose;
try { mongoose = require(process.env.CINEFLIX_MONGOOSE_PATH || "mongoose"); } catch (error) {
    if (process.env.CINEFLIX_MONGOOSE_PATH || error.code !== "MODULE_NOT_FOUND") throw error;
}

test("disconnected Mongoose schema validation and query casting (requires mongoose)", { skip: !mongoose }, async () => {
    const connection = mongoose.createConnection(); // disconnected: no URI or I/O
    const Rating = createRatingModel({ mongoose, connection });
    assert.equal(createRatingModel({ mongoose, connection }), Rating);
    assert.equal(Rating.collection.name, "ratings");
    assert.equal(Rating.schema.options.timestamps, true);
    assert.equal(Rating.schema.options.autoIndex, false);
    assert(Rating.schema.indexes().some(([fields, options]) => fields.user === 1 && fields.itemId === 1 && options.unique));
    const base = { user: "000000000000000000000001", itemId: "movie-004", score: 4 };
    const good = new Rating({ ...base, reviewText: " Nice " });
    await good.validate();
    assert.equal(good.reviewText, "Nice");
    assert.equal(new Rating(base).reviewText, "");
    for (const invalid of [{ score: 0 }, { score: 6 }, { score: 2.5 }, { user: "demo-user" },
        { itemId: "" }, { reviewText: "x".repeat(2001) }]) {
        await assert.rejects(new Rating({ ...base, ...invalid }).validate());
    }
    assert.throws(() => new Rating({ ...base, owner: "bad" }));

    // Execute Mongoose's casting/validators/timestamps pipeline against a test-only
    // collection stub; this tests real Mongoose, without contacting MongoDB.
    const { createRatingRepository } = require("../src/repositories/ratingRepository.cjs");
    const repo = createRatingRepository({ Rating });
    let captured;
    Rating.collection.findOneAndUpdate = async (filter, update, options) => {
        captured = { filter, update, options };
        return { score: update.$set.score, reviewText: update.$set.reviewText || "" };
    };
    await repo.upsertOwn({ user: base.user, itemId: base.itemId }, { score: 5, reviewText: "Hello" });
    assert.equal(String(captured.filter.user), base.user);
    assert.equal(captured.filter.itemId, base.itemId);
    assert(captured.update.$set.updatedAt instanceof Date);
    assert(captured.update.$setOnInsert.createdAt instanceof Date);
    assert.equal(captured.options.returnDocument, "after");
    await assert.rejects(repo.upsertOwn({ user: base.user, itemId: base.itemId }, { score: 8 }));
    await connection.close();
});
