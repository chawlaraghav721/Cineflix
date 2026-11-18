"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMovieNightRepository, createMovieNightTitleRepository } = require("../src/repositories/movieNightRepository.cjs");
const { hostA, sessionId, selectedIds, record } = require("./helpers/sessionFixture.cjs");
function spyModel(result = record()) {
    const calls = [];
    const query = value => ({ lean() { return this; }, sort(value) { calls.push(["sort", value]); return this; },
        select(value) { calls.push(["select", value]); return this; }, async exec() { return value; } });
    return { calls,
        async create(r) { calls.push(["create", r]); return result; },
        findOne(f) { calls.push(["findOne", f]); return query(result); },
        find(f) { calls.push(["find", f]); return query([result]); },
        findOneAndUpdate(...args) { calls.push(["update", ...args]); return query(result); },
        deleteOne(f) { calls.push(["delete", f]); return query({ deletedCount: result ? 1 : 0 }); } };
}
const scope = { sessionId, hostUser: hostA.id, expectedRevision: 1 };
test("every sequential read/write is filtered by host and mode; no upsert or replacement", async () => {
    const model = spyModel(); const repo = createMovieNightRepository(model);
    await repo.findOwned(scope); await repo.listOwned(scope); await repo.deleteOwned(scope);
    await repo.resetVotesOwned(scope);
    for (const call of model.calls.filter(c => ["findOne", "find", "delete", "update"].includes(c[0]))) {
        assert.equal(call[1].hostUser, hostA.id); assert.equal(call[1].mode, "sequential");
    }
    const update = model.calls.find(c => c[0] === "update");
    assert.equal(update[1].revision, 1); assert.equal(update[2].$inc.revision, 1);
    assert.deepEqual(update[2].$set, { votes: [], status: "voting" });
    assert.equal(update[3].upsert, false); assert.equal(update[3].returnDocument, "after");
});
test("vote query contains CAS, membership, status and capacity guards with one mutation", async () => {
    const model = spyModel(); const repo = createMovieNightRepository(model);
    await repo.appendVoteOwned(scope, { itemId: selectedIds[0], nextStatus: "voting" });
    const [, filter, update] = model.calls[0];
    assert.equal(filter.revision, 1); assert.equal(filter.status, "voting"); assert.equal(filter.selectedIds, selectedIds[0]);
    assert.deepEqual(filter.$expr, { $lt: [{ $size: "$votes" }, "$voterCount"] });
    assert.deepEqual(update.$push, { votes: selectedIds[0] }); assert.equal(update.$inc.revision, 1);
});
test("creation allowlists fields; query objects and invalid IDs cannot reach model", async () => {
    const model = spyModel(); const repo = createMovieNightRepository(model);
    await repo.create({ ...record(), unwanted: "secret", revision: 50 });
    assert.equal(model.calls[0][1].revision, 0); assert.equal(model.calls[0][1].unwanted, undefined);
    await assert.rejects(() => repo.findOwned({ ...scope, sessionId: { $ne: null } }), TypeError);
    assert.equal(model.calls.length, 1);
});
test("missing matches stay null/false and title lookup uses stable catalogue IDs", async () => {
    const model = spyModel(null); const repo = createMovieNightRepository(model);
    assert.equal(await repo.findOwned(scope), null); assert.equal(await repo.deleteOwned(scope), false);
    const titleModel = spyModel(); await createMovieNightTitleRepository(titleModel).findByIds(selectedIds);
    assert.deepEqual(titleModel.calls[0][1], { id: { $in: selectedIds } });
});
test("model failures are propagated without local persistence", async () => {
    const model = spyModel(); model.create = async () => { throw new Error("database unavailable"); };
    await assert.rejects(() => createMovieNightRepository(model).create(record()), /database unavailable/);
});
