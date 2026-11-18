"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMovieNightSessionModel, validateStoredSession } = require("../src/models/MovieNightSession.cjs");
const { record } = require("./helpers/sessionFixture.cjs");
let mongoose;
try { mongoose = require(process.env.CINEFLIX_MONGOOSE_PATH || "mongoose"); } catch (error) {
    if (process.env.CINEFLIX_MONGOOSE_PATH || error.code !== "MODULE_NOT_FOUND") throw error;
}
test("stored invariants reject invalid status, revision and vote history without dependencies", () => {
    assert.equal(validateStoredSession(record()), true);
    for (const extra of [{ revision: -1 }, { revision: 0.5 }, { status: "complete" }, { votes: ["show-001"] }, { selectedIds: [] }]) {
        assert.throws(() => validateStoredSession(record(extra)));
    }
});
test("real Mongoose document validation (no MongoDB connection)", { skip: !mongoose && "Supply M1's mongoose dependency or CINEFLIX_MONGOOSE_PATH" }, async () => {
    const isolated = new mongoose.Mongoose();
    const Model = createMovieNightSessionModel({ mongoose: isolated, connection: isolated.connection });
    assert.equal(createMovieNightSessionModel({ mongoose: isolated, connection: isolated.connection }), Model);
    assert.equal(Model.collection.name, "movienightsessions");
    await new Model(record()).validate();
    for (const extra of [{ hostUser: undefined }, { hostUser: "not-object-id" }, { voterCount: 2.5 },
        { selectedIds: ["movie-011", "movie-011", "movie-012"] }, { status: "complete" }, { revision: -1 }, { votes: ["show-001"] }]) {
        await assert.rejects(() => new Model(record(extra)).validate());
    }
    assert.equal(isolated.connection.readyState, 0);
    assert.equal(Model.schema.options.timestamps, true);
    const { room } = require("./helpers/roomFixture.cjs");
    await new Model(room()).validate();
    await assert.rejects(() => new Model(room({ participants: [record().hostUser, record().hostUser] })).validate());
    await assert.rejects(() => new Model(room({ roomCode: "INVALID0" })).validate());
    assert.equal(Model.schema.options.autoIndex, false);
    assert(Model.schema.indexes().some(([keys, opts]) => keys.roomCode === 1 && opts.unique && opts.partialFilterExpression.mode === "room"));
    assert.throws(() => new Model({ ...record(), injected: true }), /strict mode/);

    // Exercise REAL Mongoose query casting with only the collection method stubbed.
    // No server/connection is opened, and these are not database atomicity tests.
    const { createMovieNightRepository } = require("../src/repositories/movieNightRepository.cjs");
    const { createMovieNightRoomRepository } = require("../src/repositories/movieNightRoomRepository.cjs");
    const { hostA, hostB, sessionId, selectedIds } = require("./helpers/sessionFixture.cjs");
    const { roomId } = require("./helpers/roomFixture.cjs");
    const calls = [];
    Model.collection.findOneAndUpdate = async (filter, update, options) => { calls.push({ filter, update, options }); return record(); };
    await createMovieNightRepository(Model).appendVoteOwned({ sessionId, hostUser: hostA.id, expectedRevision: 1 }, { itemId: selectedIds[0], nextStatus: "voting" });
    assert(calls[0].filter._id instanceof isolated.Types.ObjectId);
    assert.equal(String(calls[0].filter.hostUser), hostA.id);
    await createMovieNightRoomRepository(Model).appendBallot({ roomId, actorId: hostB.id, roundId: "round-one" }, selectedIds[0]);
    assert.equal(String(calls[1].filter.participants), hostB.id);
    assert(Array.isArray(calls[1].update));
    assert.equal(calls[1].options.returnDocument, "after");
    assert.equal(isolated.connection.readyState, 0);
});
