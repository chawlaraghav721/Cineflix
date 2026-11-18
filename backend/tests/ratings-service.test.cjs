"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRatingService, validateRating, validateItemId } = require("../src/services/ratingService.cjs");

const alice = { id: "000000000000000000000001" };
const bob = { id: "000000000000000000000002" };

// Test-only identities and records; production uses the catalogue and verified auth context.
function fixture() {
    const rows = new Map();
    const key = scope => scope.user + "/" + scope.itemId;
    const repository = {
        async findOwn(scope) { return rows.get(key(scope)) || null; },
        async upsertOwn(scope, values) {
            const saved = { ...scope, reviewText: "", ...rows.get(key(scope)), ...values };
            rows.set(key(scope), saved);
            return saved;
        },
        async deleteOwn(scope) { rows.delete(key(scope)); },
        async summary(itemId) {
            const all = [...rows.values()].filter(row => row.itemId === itemId);
            return { average: all.length ? all.reduce((sum, row) => sum + row.score, 0) / all.length : null,
                count: all.length, reviews: all.filter(row => row.reviewText).map(({ score, reviewText }) => ({ score, reviewText })) };
        }
    };
    const service = createRatingService({ ratingRepository: repository,
        titleRepository: { exists: async id => ["movie-004", "show-001"].includes(id) } });
    return { service, rows, repository };
}

test("upsert edits a single own rating and optional review is preserved on score-only PUT", async () => {
    const { service, rows } = fixture();
    assert.deepEqual(await service.getOwn(alice, "movie-004"), { rating: null });
    assert.deepEqual(await service.putOwn(alice, "movie-004", { score: 4, reviewText: " Nice! " }), { score: 4, reviewText: "Nice!" });
    assert.deepEqual(await service.putOwn(alice, "movie-004", { score: 5 }), { score: 5, reviewText: "Nice!" });
    assert.equal(rows.size, 1);
    assert.deepEqual(await service.putOwn(alice, "movie-004", { score: 3, reviewText: "" }), { score: 3, reviewText: "" });
});

test("two users, movies/shows, own reads/deletes and average remain isolated", async () => {
    const { service } = fixture();
    assert.deepEqual(await service.getSummary("movie-004"), { average: null, count: 0, reviews: [] });
    await service.putOwn(alice, "movie-004", { score: 5, reviewText: "A" });
    await service.putOwn(bob, "movie-004", { score: 2 });
    await service.putOwn(alice, "show-001", { score: 1 });
    assert.deepEqual(await service.getSummary("movie-004"), { average: 3.5, count: 2, reviews: [{ score: 5, reviewText: "A" }] });
    assert.deepEqual(await service.getOwn(bob, "movie-004"), { rating: { score: 2, reviewText: "" } });
    await service.deleteOwn(alice, "movie-004");
    await service.deleteOwn(alice, "movie-004");
    assert.equal((await service.getSummary("movie-004")).average, 2);
    assert.equal((await service.getOwn(alice, "show-001")).rating.score, 1);
});

test("invalid scores, review values, and injected ownership/operator fields are rejected", () => {
    for (const score of [0, 6, -1, 1.2, "5", null, true, {}, NaN, Infinity, undefined]) {
        assert.throws(() => validateRating({ score }), { code: "INVALID_SCORE" });
    }
    for (const reviewText of [null, [], {}, 4, "x".repeat(2001)]) {
        assert.throws(() => validateRating({ score: 4, reviewText }), { code: "INVALID_REVIEW" });
    }
    for (const body of [null, [], "bad", { score: 4, user: bob.id }, { score: 4, userId: bob.id }, { score: 4, $set: {} }]) {
        assert.throws(() => validateRating(body), { code: "INVALID_RATING" });
    }
    assert.equal(validateRating({ score: 1, reviewText: "x".repeat(2000) }).reviewText.length, 2000);
});

test("missing/unverified actor shape cannot read or mutate private ratings", async () => {
    const { service, rows } = fixture();
    for (const actor of [undefined, {}, { id: "demo-user" }, { id: { $ne: null } }]) {
        await assert.rejects(service.putOwn(actor, "movie-004", { score: 4 }), { statusCode: 401 });
        await assert.rejects(service.getOwn(actor, "movie-004"), { statusCode: 401 });
        await assert.rejects(service.deleteOwn(actor, "movie-004"), { statusCode: 401 });
    }
    assert.equal(rows.size, 0);
});

test("title existence checked for public and every private operation", async () => {
    const { service, rows } = fixture();
    for (const operation of [() => service.getSummary("movie-missing"), () => service.getOwn(alice, "movie-missing"),
        () => service.putOwn(alice, "movie-missing", { score: 4 }), () => service.deleteOwn(alice, "movie-missing")]) {
        await assert.rejects(operation(), { code: "TITLE_NOT_FOUND", statusCode: 404 });
    }
    for (const id of ["", " ", " movie-004", "../users", { $ne: null }, "x".repeat(129)]) {
        assert.throws(() => validateItemId(id), { code: "INVALID_ITEM_ID" });
    }
    assert.equal(rows.size, 0);
});

test("database/title lookup failures propagate without a fake success or guest fallback", async () => {
    const { repository } = fixture();
    const failure = new Error("database unavailable");
    const service = createRatingService({ ratingRepository: repository, titleRepository: { exists: async () => { throw failure; } } });
    await assert.rejects(service.putOwn(alice, "movie-004", { score: 5 }), failure);
});
