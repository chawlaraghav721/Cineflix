"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRating, validateItemId, authenticatedId } = require("../src/services/ratingValidation");

test("rating payloads enforce raw review limits and preserve optional-field semantics", () => {
    for (let score = 1; score <= 5; score++) assert.deepEqual(validateRating({ score }), { score });
    assert.deepEqual(validateRating({ score: 3, reviewText: "  " }), { score: 3, reviewText: "" });
    assert.equal(validateRating({ score: 3, reviewText: "x".repeat(2000) }).reviewText.length, 2000);
    for (const body of [null, undefined, [], "bad", { score: 5, user: "other" }, { score: 5, userId: "other" },
        { score: 5, itemId: "movie-004" }, { score: 5, $set: {} }, JSON.parse('{"score":5,"__proto__":{}}')]) {
        assert.throws(() => validateRating(body), { code: "INVALID_RATING" });
    }
    for (const score of [undefined, 0, -1, 6, 1.5, "5", true, null, NaN, Infinity, { $gte: 1 }]) {
        assert.throws(() => validateRating({ score }), { code: "INVALID_SCORE" });
    }
    for (const reviewText of [undefined, null, false, 5, {}, [], " ".repeat(2001)]) {
        assert.throws(() => validateRating({ score: 3, reviewText }), { code: "INVALID_REVIEW" });
    }
});

test("title IDs and authenticated identity must be scalar trusted values", () => {
    assert.equal(validateItemId("movie-004"), "movie-004");
    assert.equal(validateItemId("show-001"), "show-001");
    for (const id of [null, undefined, "", " ", " movie-004", "../users", "$ne", "x".repeat(129), { $ne: null }]) {
        assert.throws(() => validateItemId(id), { code: "INVALID_ITEM_ID" });
    }
    const id = "000000000000000000000001";
    assert.equal(authenticatedId({ id }), id);
    for (const user of [null, {}, { id: "guest" }, { id: { $ne: null } }]) {
        assert.throws(() => authenticatedId(user), { code: "AUTH_REQUIRED", status: 401 });
    }
});
