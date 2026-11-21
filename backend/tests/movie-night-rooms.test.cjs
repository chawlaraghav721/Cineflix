"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateRoomCode, normalizeRoomCode, validateRoom } = require("../src/services/movieNightRoomRules.cjs");
const { fixture, room, roomId, hostA, hostB, third, selectedIds } = require("./helpers/roomFixture.cjs");
const { input } = require("./helpers/sessionFixture.cjs");
const code = wanted => e => e.code === wanted;
const active = extra => room({ participants: [hostA.id, hostB.id], status: "voting", revision: 3, ...extra });
const cast = (f, actor, itemId = selectedIds[0], roundId = "round-one") => f.service.submitVote(actor, roomId, { itemId }, roundId);
function barrier(f, method = "findAccessible") {
    let count = 0, release; const promise = new Promise(r => { release = r; }); const original = f.roomRepository[method];
    f.roomRepository[method] = async (...args) => { const snapshot = await original(...args);
        if (++count <= 2) { if (count === 2) release(); await promise; } return snapshot; };
}
test("codes are eight secure-alphabet characters and normalize case/outer whitespace", () => {
    for (let i = 0; i < 30; i++) assert.match(generateRoomCode(), /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(normalizeRoomCode(" abcdefgh "), "ABCDEFGH");
    for (const value of [null, {}, "ABC", "ABCD0000", "ABCDIJKL", "ABCDOXYZ", "ABCD EFH"]) assert.throws(() => normalizeRoomCode(value));
});
test("creation validates trusted catalogue IDs and never auto-enrolls the host", async () => {
    const f = fixture([]); const result = await f.service.createRoom(hostA, input({ voterCount: 2, hostUser: hostB.id, participants: [hostB.id] }));
    assert.equal(result.participantCount, 0); assert.equal(result.roomCode, "ABCDEFGH"); assert.equal(result.isHost, true);
    assert.equal(result.status, "waiting"); assert.equal(result.results.complete, false);
    await assert.rejects(() => f.service.createRoom(hostA, input({ selectedIds: ["show-001", ...selectedIds.slice(1)] })), code("INVALID_SELECTED_IDS"));
});
test("only code-specific duplicate-index collisions are retried, with a fixed bound", async () => {
    const f = fixture([]); let calls = 0; const original = f.roomRepository.createRoom;
    f.roomRepository.createRoom = async r => { if (++calls < 3) throw { code: 11000, keyPattern: { roomCode: 1 } }; return original(r); };
    await f.service.createRoom(hostA, input()); assert.equal(calls, 3);
    let collisions = 0;
    f.roomRepository.createRoom = async () => { collisions++; throw { code: 11000, keyPattern: { roomCode: 1 } }; };
    await assert.rejects(() => f.service.createRoom(hostA, input()), code("ROOM_CODE_CONFLICT"));
    assert.equal(collisions, 5);
    const unrelated = { code: 11000, keyPattern: { otherIndex: 1 } };
    f.roomRepository.createRoom = async () => { throw unrelated; };
    await assert.rejects(() => f.service.createRoom(hostA, input()), error => error === unrelated);
    f.roomRepository.createRoom = async () => { throw new Error("unavailable"); };
    await assert.rejects(() => f.service.createRoom(hostA, input()), /unavailable/);
});
test("joining requires identity context, is idempotent and respects capacity", async () => {
    const f = fixture();
    await assert.rejects(() => f.service.joinRoom(null, { roomCode: "ABCDEFGH" }), code("AUTH_REQUIRED"));
    await f.service.joinRoom(hostA, { roomCode: "abcdefgh" });
    assert.equal((await f.service.joinRoom(hostA, { roomCode: "ABCDEFGH" })).participantCount, 1);
    await f.service.joinRoom(hostB, { roomCode: "ABCDEFGH" });
    await assert.rejects(() => f.service.joinRoom(third, { roomCode: "ABCDEFGH" }), code("ROOM_FULL"));
    assert.equal(f.records.get(roomId).participants.length, 2);
});
test("simultaneous joins for one remaining slot accept exactly one", async () => {
    const f = fixture([room({ participants: [hostA.id] })]); barrier(f, "findByCode");
    const results = await Promise.allSettled([f.service.joinRoom(hostB, { roomCode: "ABCDEFGH" }), f.service.joinRoom(third, { roomCode: "ABCDEFGH" })]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(f.records.get(roomId).participants.length, 2);
});
test("simultaneous joins by the same account return idempotent membership", async () => {
    const f = fixture(); barrier(f, "findByCode");
    const results = await Promise.all([f.service.joinRoom(hostB, { roomCode: "ABCDEFGH" }), f.service.joinRoom(hostB, { roomCode: "ABCDEFGH" })]);
    assert.equal(results[0].participantCount, 1); assert.equal(results[1].participantCount, 1);
});
test("only the host can start a full room at its current revision", async () => {
    const f = fixture(); await assert.rejects(() => f.service.startRoom(hostA, roomId, 0), code("ROOM_NOT_READY"));
    await f.service.joinRoom(hostA, { roomCode: "ABCDEFGH" }); await f.service.joinRoom(hostB, { roomCode: "ABCDEFGH" });
    await assert.rejects(() => f.service.startRoom(hostB, roomId, 2), code("HOST_REQUIRED"));
    await assert.rejects(() => f.service.startRoom(hostA, roomId, 0), code("SESSION_CONFLICT"));
    const started = await f.service.startRoom(hostA, roomId, 2); assert.equal(started.status, "voting");
    await assert.rejects(() => f.service.joinRoom(third, { roomCode: "ABCDEFGH" }), code("ROOM_CLOSED"));
    assert.equal((await f.service.joinRoom(hostB, { roomCode: "ABCDEFGH" })).hasJoined, true);
});
test("different participants vote concurrently without competing for a global revision", async () => {
    const f = fixture([active()]); barrier(f);
    await Promise.all([cast(f, hostA), cast(f, hostB, selectedIds[1])]);
    const state = await f.service.getRoom(hostA, roomId);
    assert.equal(state.status, "complete"); assert.equal(state.revision, 5); assert.equal(state.results.isTie, true);
    assert.deepEqual(state.results.winners, selectedIds.slice(0, 2));
});
test("duplicate concurrent participant ballots consume one slot only", async () => {
    const f = fixture([active()]); barrier(f);
    const outcomes = await Promise.allSettled([cast(f, hostA), cast(f, hostA, selectedIds[1])]);
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(outcomes.find(r => r.status === "rejected").reason.code, "ALREADY_VOTED");
    assert.equal(f.records.get(roomId).votes.length, 1);
});
test("three independent participants complete a three-way tie without losing any ballot", async () => {
    const f = fixture([active({ voterCount: 3, participants: [hostA.id, hostB.id, third.id] })]);
    await Promise.all([cast(f, hostA, selectedIds[0]), cast(f, hostB, selectedIds[1]), cast(f, third, selectedIds[2])]);
    const result = await f.service.getRoom(hostA, roomId);
    assert.equal(result.status, "complete"); assert.equal(result.results.isTie, true);
    assert.deepEqual(result.results.winners, selectedIds);
    assert.equal(result.results.tallies.reduce((total, item) => total + item.count, 0), 3);
});
test("host must join to vote and outsiders cannot poll or vote", async () => {
    const f = fixture([active({ participants: [hostB.id, third.id] })]);
    await assert.rejects(() => cast(f, hostA), code("PARTICIPANT_REQUIRED"));
    const other = { id: "000000000000000000000004" };
    await assert.rejects(() => f.service.getRoom(other, roomId), code("ROOM_NOT_FOUND"));
    await assert.rejects(() => cast(f, other), code("ROOM_NOT_FOUND"));
});
test("invalid choices, waiting rooms and stale rounds cannot accept ballots", async () => {
    const f = fixture([active()]);
    await assert.rejects(() => cast(f, hostA, "show-001"), code("INVALID_VOTE"));
    await assert.rejects(() => cast(f, hostA, selectedIds[0], "old-round"), code("ROUND_CONFLICT"));
    await assert.rejects(() => cast(f, hostA, selectedIds[0], null), code("INVALID_ROUND"));
    f.records.get(roomId).status = "waiting";
    await assert.rejects(() => cast(f, hostA), code("ROOM_CLOSED"));
});
test("reset retains roster, clears votes, changes round and requires start again", async () => {
    const f = fixture([active()]); await cast(f, hostA);
    await assert.rejects(() => f.service.resetRoom(hostB, roomId, 4), code("HOST_REQUIRED"));
    const reset = await f.service.resetRoom(hostA, roomId, 4);
    assert.equal(reset.status, "waiting"); assert.equal(reset.participantCount, 2); assert.equal(reset.results.complete, false);
    assert.notEqual(reset.roundId, "round-one");
    await assert.rejects(() => cast(f, hostB), code("ROUND_CONFLICT"));
    await f.service.startRoom(hostA, roomId, reset.revision);
    await cast(f, hostA, selectedIds[0], reset.roundId);
});
test("reset/vote races preserve a new round or reject a stale reset", async () => {
    for (const resetFirst of [true, false]) {
        const f = fixture([active()]); barrier(f);
        const reset = () => f.service.resetRoom(hostA, roomId, 3);
        const outcomes = await Promise.allSettled(resetFirst ? [reset(), cast(f, hostB)] : [cast(f, hostB), reset()]);
        assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
        assert.equal(f.records.get(roomId).votes.length, resetFirst ? 0 : 1);
    }
});
test("polling responses expose totals but never raw ballots or participant identities", async () => {
    const f = fixture([active()]); await cast(f, hostA);
    const state = await f.service.getRoom(hostB, roomId);
    assert.equal(state.roomCode, undefined); assert.equal(state.votes, undefined); assert.equal(state.participants, undefined);
    assert.equal(state.hasVoted, false); assert.equal(state.results.tallies[0].count, 1);
    assert.equal(state.results.complete, false); assert.deepEqual(state.results.winners, []);
});
test("stored room validation rejects duplicate roster, invalid ballots and impossible states", () => {
    for (const extra of [{ participants: [hostA.id, hostA.id] }, { status: "complete" }, { roundId: "" },
        { votes: [{ participantId: hostA.id, itemId: selectedIds[0], roundId: "old" }] }]) assert.throws(() => validateRoom(room(extra)));
});
test("adapter errors and missing mutation postconditions are not reported as success", async () => {
    const f = fixture([active()]);
    f.roomRepository.appendBallot = async () => active();
    await assert.rejects(() => cast(f, hostA), /did not record the ballot/);
    f.roomRepository.appendBallot = async () => { throw new Error("repository unavailable"); };
    await assert.rejects(() => cast(f, hostA), /repository unavailable/);
    const j = fixture(); j.roomRepository.joinRoom = async () => room();
    await assert.rejects(() => j.service.joinRoom(hostA, { roomCode: "ABCDEFGH" }), /did not apply membership/);
});
