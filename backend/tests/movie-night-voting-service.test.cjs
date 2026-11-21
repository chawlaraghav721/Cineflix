"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, hostA, hostB, sessionId, selectedIds, record } = require("./helpers/sessionFixture.cjs");
const vote = (f, revision, itemId = selectedIds[0]) => f.service.submitVote(hostA, sessionId, { itemId }, revision);
const errorCode = code => e => e.code === code;

// Force both service calls to read the same snapshot before either attempts CAS.
function synchronizeReads(f) {
    const original = f.sessionRepository.findOwned;
    let count = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    f.sessionRepository.findOwned = async s => {
        const snapshot = await original(s);
        if (++count <= 2) { if (count === 2) release(); await barrier; }
        return snapshot;
    };
}

test("vote appends one ID, increments revision and permits the same movie on the next turn", async () => {
    const f = fixture();
    assert.equal((await vote(f, 1)).revision, 2);
    assert.deepEqual((await vote(f, 2)).votes, Array(3).fill(selectedIds[0]));
    assert.deepEqual(f.calls.find(c => c.method === "appendVoteOwned").args,
        [{ sessionId, hostUser: hostA.id, expectedRevision: 1 }, { itemId: selectedIds[0], nextStatus: "voting" }]);
});
test("last vote completes voting and results are calculated from stored IDs", async () => {
    const f = fixture([record({ voterCount: 2 })]);
    assert.equal((await vote(f, 1, selectedIds[1])).status, "complete");
    const results = await f.service.getResults(hostA, sessionId);
    assert.equal(results.complete, true); assert.equal(results.isTie, true);
    assert.deepEqual(results.winners, selectedIds.slice(0, 2));
    await assert.rejects(() => vote(f, 2), errorCode("VOTING_COMPLETE"));
});
test("invalid revisions and request bodies never write", async () => {
    const f = fixture();
    for (const rev of [undefined, null, "1", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
        await assert.rejects(() => vote(f, rev), errorCode("INVALID_REVISION"));
    }
    for (const body of [null, [], "movie-011", {}, { itemId: "show-001" }, { itemId: "movie-014" }]) {
        await assert.rejects(() => f.service.submitVote(hostA, sessionId, body, 1), errorCode("INVALID_VOTE"));
    }
    assert.equal(f.calls.some(c => c.method === "appendVoteOwned"), false);
});
test("duplicates and future/stale revisions do not consume another turn", async () => {
    const f = fixture(); await vote(f, 1);
    for (const rev of [0, 1, 5]) await assert.rejects(() => vote(f, rev), errorCode("SESSION_CONFLICT"));
    assert.equal(f.records.get(sessionId).votes.length, 2);
});
test("simultaneous submissions at the same revision accept exactly one", async () => {
    const f = fixture(); synchronizeReads(f);
    const results = await Promise.allSettled([vote(f, 1), vote(f, 1, selectedIds[2])]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.find(r => r.status === "rejected").reason.code, "SESSION_CONFLICT");
    assert.equal(f.records.get(sessionId).votes.length, 2);
});
test("a last-slot race cannot exceed capacity", async () => {
    const f = fixture([record({ voterCount: 2 })]); synchronizeReads(f);
    const results = await Promise.allSettled([vote(f, 1), vote(f, 1)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(f.records.get(sessionId).votes.length, 2);
    assert.equal(f.records.get(sessionId).status, "complete");
});
test("vote/reset races accept only the first matching conditional operation", async () => {
    for (const resetFirst of [true, false]) {
        const f = fixture(); synchronizeReads(f);
        const reset = () => f.service.resetSession(hostA, sessionId, 1);
        const results = await Promise.allSettled(resetFirst ? [reset(), vote(f, 1)] : [vote(f, 1), reset()]);
        assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
        assert.equal(f.records.get(sessionId).votes.length, resetFirst ? 0 : 2);
    }
});
test("concurrent resets advance once and old votes remain stale after votes are cleared", async () => {
    const f = fixture(); synchronizeReads(f);
    const outcomes = await Promise.allSettled([f.service.resetSession(hostA, sessionId, 1), f.service.resetSession(hostA, sessionId, 1)]);
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
    await assert.rejects(() => vote(f, 1), errorCode("SESSION_CONFLICT"));
    assert.deepEqual((await vote(f, 2)).votes, [selectedIds[0]]);
});
test("a deletion between snapshot and write produces 404 without recreation", async () => {
    const f = fixture(); f.sessionRepository.appendVoteOwned = async () => { f.records.delete(sessionId); return null; };
    await assert.rejects(() => vote(f, 1), errorCode("SESSION_NOT_FOUND"));
    assert.equal(f.records.size, 0);
});
test("missing/foreign identity and corrupted stored state cannot vote or disclose results", async () => {
    const f = fixture();
    await assert.rejects(() => f.service.submitVote(null, sessionId, { itemId: selectedIds[0] }, 1), errorCode("AUTH_REQUIRED"));
    await assert.rejects(() => f.service.submitVote(hostB, sessionId, { itemId: selectedIds[0] }, 1), errorCode("SESSION_NOT_FOUND"));
    await assert.rejects(() => f.service.getResults(hostB, sessionId), errorCode("SESSION_NOT_FOUND"));
    f.records.get(sessionId).status = "complete";
    await assert.rejects(() => vote(f, 1), /invalid stored state/);
});
test("repository errors and incorrect revision advancement fail without retry", async () => {
    const f = fixture(); let calls = 0;
    f.sessionRepository.appendVoteOwned = async () => { calls++; throw new Error("unavailable"); };
    await assert.rejects(() => vote(f, 1), /unavailable/); assert.equal(calls, 1);
    f.sessionRepository.appendVoteOwned = async () => record();
    await assert.rejects(() => vote(f, 1), /advance the revision/);
});
test("revision advancement alone cannot masquerade as a successful vote or reset", async () => {
    const f = fixture();
    f.sessionRepository.appendVoteOwned = async () => record({ revision: 2, votes: [selectedIds[0], selectedIds[2]] });
    await assert.rejects(() => vote(f, 1), /exactly the requested vote/);
    f.sessionRepository.resetVotesOwned = async () => record({ revision: 2 });
    await assert.rejects(() => f.service.resetSession(hostA, sessionId, 1), /clear only the session votes/);
});
