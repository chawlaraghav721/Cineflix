"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMovieNightRoomRepository } = require("../src/repositories/movieNightRoomRepository.cjs");
const { room, roomId, hostA, hostB, selectedIds } = require("./helpers/roomFixture.cjs");
function fixture() {
    const calls = []; const query = r => ({ lean() { return this; }, async exec() { return r; } });
    const model = { async create(r) { calls.push(["create", r]); return room(r); },
        findOne(f) { calls.push(["read", f]); return query(room()); },
        findOneAndUpdate(...args) { calls.push(["update", ...args]); return query(room()); } };
    return { calls, repo: createMovieNightRoomRepository(model) };
}
test("room polling read is mode/member/host scoped and code lookup normalizes", async () => {
    const f = fixture(); await f.repo.findAccessible({ roomId, actorId: hostB.id });
    assert.deepEqual(f.calls[0][1], { _id: roomId, mode: "room", $or: [{ hostUser: hostB.id }, { participants: hostB.id }] });
    await f.repo.findByCode("abcdefgh"); assert.equal(f.calls[1][1].roomCode, "ABCDEFGH");
});
test("joining checks waiting state, round, uniqueness and capacity in the database filter", async () => {
    const f = fixture(); await f.repo.joinRoom({ roomId, actorId: hostA.id, roundId: "round-one" });
    const [, filter, update, opts] = f.calls[0];
    assert.equal(filter.status, "waiting"); assert.equal(filter.roundId, "round-one");
    assert.deepEqual(filter.participants, { $ne: hostA.id });
    assert.deepEqual(filter.$expr, { $lt: [{ $size: "$participants" }, "$voterCount"] });
    assert.equal(update.$inc.revision, 1); assert.equal(opts.upsert, false);
});
test("host start/reset use revision and round CAS with a frozen/full roster", async () => {
    const f = fixture(); const s = { roomId, actorId: hostA.id, expectedRevision: 2, roundId: "round-one" };
    await f.repo.startRoom(s); await f.repo.resetRoom(s, "round-two");
    for (const [, filter] of f.calls) { assert.equal(filter.hostUser, hostA.id); assert.equal(filter.revision, 2); assert.equal(filter.roundId, "round-one"); }
    assert.deepEqual(f.calls[0][1].$expr, { $eq: [{ $size: "$participants" }, "$voterCount"] });
    assert.deepEqual(f.calls[1][2].$set, { votes: [], status: "waiting", roundId: "round-two" });
});
test("participant append checks account/round uniqueness and derives completion after append", async () => {
    const f = fixture(); await f.repo.appendBallot({ roomId, actorId: hostB.id, roundId: "round-one" }, selectedIds[0]);
    const [, filter, pipeline, opts] = f.calls[0];
    assert.equal(filter.participants, hostB.id); assert.equal(filter.roundId, "round-one");
    assert.deepEqual(filter.votes.$not.$elemMatch, { participantId: hostB.id, roundId: "round-one" });
    assert(Array.isArray(pipeline)); assert.equal(pipeline.length, 2);
    assert.deepEqual(pipeline[0].$set.revision, { $add: ["$revision", 1] });
    assert.deepEqual(pipeline[1].$set.status.$cond, [{ $eq: [{ $size: "$votes" }, "$voterCount"] }, "complete", "voting"]);
    assert.equal(opts.updatePipeline, true); assert.equal(opts.timestamps, false);
});
test("invalid IDs cannot reach the model and creation ignores injected fields", async () => {
    const f = fixture(); await assert.rejects(() => f.repo.findAccessible({ roomId: {}, actorId: hostA.id }), TypeError);
    assert.equal(f.calls.length, 0); await f.repo.createRoom(room({ arbitrary: true }));
    assert.equal(f.calls[0][1].arbitrary, undefined);
});
