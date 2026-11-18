"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, hostA, hostB, sessionId, selectedIds, input, record } = require("./helpers/sessionFixture.cjs");
const { createMovieNightSessionService } = require("../src/services/movieNightSessionService.cjs");

test("dependencies are explicit with no production fallback", () => {
    assert.throws(() => createMovieNightSessionService(), TypeError);
    const f = fixture();
    for (const key of Object.keys(f.sessionRepository)) {
        assert.throws(() => createMovieNightSessionService({ sessionRepository: { ...f.sessionRepository, [key]: undefined }, titleRepository: f.titleRepository }), TypeError);
    }
});
test("creation uses trusted identity, catalogue lookup, empty votes and revision zero", async () => {
    const f = fixture([]);
    const created = await f.service.createSession(hostA, input({ hostUser: hostB.id, revision: 100, votes: selectedIds, status: "complete" }));
    assert.equal(created.hostUser, hostA.id); assert.equal(created.revision, 0);
    assert.deepEqual(created.votes, []); assert.equal(created.status, "voting");
    assert.deepEqual(await f.service.getSession(hostA, created._id), created);
});
test("invalid creation is rejected before a write; malformed shape before any lookup", async () => {
    for (const body of [null, {}, input({ voterCount: 11 }), input({ selectedIds: ["show-001", ...selectedIds.slice(1)] }), input({ selectedIds: ["missing", ...selectedIds.slice(1)] })]) {
        const f = fixture([]);
        await assert.rejects(() => f.service.createSession(hostA, body));
        assert.equal(f.records.size, 0); assert.equal(f.calls.some(c => c.method === "create"), false);
        if (!body || !body.selectedIds || body.voterCount === 11) assert.equal(f.calls.length, 0);
    }
});
test("all operations reject missing identity; session IDs cannot contain query objects", async () => {
    const f = fixture();
    for (const actor of [null, {}, { id: "" }, { id: 10 }, { id: " user " }]) {
        for (const method of ["getSession", "listSessions", "resetSession", "deleteSession", "getResults"]) {
            await assert.rejects(() => f.service[method](actor, sessionId, 1), e => e.code === "AUTH_REQUIRED");
        }
    }
    for (const id of [null, {}, "", " ", { $ne: null }]) await assert.rejects(() => f.service.getSession(hostA, id), e => e.code === "INVALID_SESSION_ID");
    assert.equal(f.calls.length, 0);
});
test("listing is host scoped, includes progress and returns an empty array when appropriate", async () => {
    const f = fixture([record(), record({ _id: "other", hostUser: hostB.id })]);
    assert.deepEqual(await f.service.listSessions(hostA), { sessions: [record()] });
    assert.deepEqual(await fixture([]).service.listSessions(hostA), { sessions: [] });
    assert.deepEqual(f.calls[0].args, [{ hostUser: hostA.id }]);
});
test("reset retains configuration and ownership, clears votes and advances revision", async () => {
    const original = record({ voterCount: 2, status: "complete", votes: selectedIds.slice(0, 2) });
    const f = fixture([original]);
    assert.deepEqual(await f.service.resetSession(hostA, sessionId, 1), { ...original, votes: [], status: "voting", revision: 2 });
    assert.equal((await f.service.resetSession(hostA, sessionId, 2)).revision, 3);
    assert.deepEqual(f.calls.find(c => c.method === "resetVotesOwned").args, [{ sessionId, hostUser: hostA.id, expectedRevision: 1 }]);
});
test("delete targets only the owned record and returns no body", async () => {
    const foreign = record({ _id: "other", hostUser: hostB.id }); const f = fixture([record(), foreign]);
    assert.equal(await f.service.deleteSession(hostA, sessionId), undefined);
    assert.deepEqual([...f.records.values()], [foreign]);
    await assert.rejects(() => f.service.getSession(hostA, sessionId), e => e.code === "SESSION_NOT_FOUND");
});
test("missing and foreign sessions are indistinguishable; admin cannot bypass ownership", async () => {
    for (const actor of [hostB, { ...hostB, role: "admin" }]) {
        const f = fixture();
        for (const id of [sessionId, "missing"]) for (const method of ["getSession", "resetSession", "deleteSession", "getResults"]) {
            await assert.rejects(() => f.service[method](actor, id, 1), e => e.code === "SESSION_NOT_FOUND" && e.statusCode === 404);
        }
        assert.deepEqual(f.records.get(sessionId), record());
    }
});
test("foreign, mismatched and malformed repository responses fail closed", async () => {
    for (const bad of [record({ hostUser: hostB.id }), record({ _id: "wrong" }), undefined]) {
        const f = fixture(); f.sessionRepository.findOwned = async () => bad;
        await assert.rejects(() => f.service.getSession(hostA, sessionId), /outside the requested scope/);
    }
    const f = fixture(); f.sessionRepository.listOwned = async () => null;
    await assert.rejects(() => f.service.listSessions(hostA), /session array/);
    f.sessionRepository.deleteOwned = async () => ({});
    await assert.rejects(() => f.service.deleteSession(hostA, sessionId), /deletion boolean/);
});
test("catalogue/repository failures propagate without fallback data or writes", async () => {
    const f = fixture(); f.titleRepository.findByIds = async () => { throw new Error("catalogue unavailable"); };
    await assert.rejects(() => f.service.createSession(hostA, input()), /catalogue unavailable/);
    f.sessionRepository.resetVotesOwned = async () => { throw new Error("write unavailable"); };
    await assert.rejects(() => f.service.resetSession(hostA, sessionId, 1), /write unavailable/);
    assert.deepEqual(f.records.get(sessionId), record());
});
