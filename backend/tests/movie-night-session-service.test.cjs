"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const catalogue = require("../../data/catalogue.json");
const { MovieNightRuleError } = require("../src/services/movieNightRules.cjs");
const { createMovieNightSessionService } = require("../src/services/movieNightSessionService.cjs");

// Identities, generated records, and repositories exist only inside this test file.
// They do not verify JWTs, authenticate real users, or exercise MongoDB.
const hostA = Object.freeze({ id: "000000000000000000000001", role: "user" });
const hostB = Object.freeze({ id: "000000000000000000000002", role: "user" });
const sessionId = "000000000000000000000010";
const missingId = "000000000000000000000099";
const selectedIds = ["movie-011", "movie-012", "movie-013"];
const input = overrides => ({ selectedIds: [...selectedIds], voterCount: 4, ...overrides });
const record = overrides => ({
    _id: sessionId, hostUser: hostA.id, ...input(), votes: [selectedIds[0]], status: "voting",
    createdAt: "2026-11-18T00:00:00.000Z", updatedAt: "2026-11-18T00:00:01.000Z", ...overrides
});

function fixture(seed = []) {
    const records = new Map(seed.map(item => [item._id, structuredClone(item)]));
    const calls = [];
    let nextId = 1000;
    const note = (method, ...args) => calls.push({ method, args: structuredClone(args) });
    const owned = scope => {
        const item = records.get(scope.sessionId);
        return item && item.hostUser === scope.hostUser ? item : null;
    };
    const sessionRepository = {
        async create(value) {
            note("create", value);
            const item = {
                ...structuredClone(value), _id: String(nextId++).padStart(24, "0"),
                createdAt: "2026-11-18T00:00:00.000Z", updatedAt: "2026-11-18T00:00:00.000Z"
            };
            records.set(item._id, item);
            return structuredClone(item);
        },
        async findOwned(scope) {
            note("findOwned", scope);
            return structuredClone(owned(scope));
        },
        async listOwned(scope) {
            note("listOwned", scope);
            return structuredClone([...records.values()].filter(item => item.hostUser === scope.hostUser));
        },
        async updateOwned(scope, changes) {
            note("updateOwned", scope, changes);
            const item = owned(scope);
            if (!item) return null;
            Object.assign(item, structuredClone(changes), { updatedAt: "2026-11-18T00:00:02.000Z" });
            return structuredClone(item);
        },
        async deleteOwned(scope) {
            note("deleteOwned", scope);
            if (!owned(scope)) return false;
            return records.delete(scope.sessionId);
        }
    };
    const titleRepository = {
        async findByIds(ids) {
            note("findByIds", ids);
            return structuredClone([...catalogue.movies, ...catalogue.shows].filter(item => ids.includes(item.id)));
        }
    };
    return {
        records, calls, sessionRepository, titleRepository,
        service: createMovieNightSessionService({ sessionRepository, titleRepository })
    };
}

async function expectRuleError(action, code, statusCode) {
    await assert.rejects(action, error => {
        assert(error instanceof MovieNightRuleError);
        assert.equal(error.code, code);
        assert.equal(error.statusCode, statusCode);
        return true;
    });
}

test("service requires every repository dependency without production fallbacks", () => {
    assert.throws(() => createMovieNightSessionService(), TypeError);
    const f = fixture();
    for (const method of ["create", "findOwned", "listOwned", "updateOwned", "deleteOwned"]) {
        assert.throws(() => createMovieNightSessionService({
            sessionRepository: { ...f.sessionRepository, [method]: undefined }, titleRepository: f.titleRepository
        }), TypeError);
    }
    assert.throws(() => createMovieNightSessionService({ sessionRepository: f.sessionRepository }), TypeError);
});

test("create uses separate host context and ignores client ownership, state, and metadata", async () => {
    const f = fixture();
    const body = input({
        hostUser: hostB.id, userId: hostB.id, actor: hostB, _id: missingId,
        votes: [...selectedIds], status: "complete", createdAt: "untrusted"
    });
    const before = structuredClone(body);
    const created = await f.service.createSession(hostA, body);
    assert.deepEqual(f.calls, [
        { method: "findByIds", args: [[...selectedIds]] },
        { method: "create", args: [{ ...input(), hostUser: hostA.id, votes: [], status: "voting" }] }
    ]);
    assert.equal(created.hostUser, hostA.id);
    assert.notEqual(created._id, missingId);
    assert.deepEqual(created.votes, []);
    assert.equal(created.status, "voting");
    assert.deepEqual(body, before);
    assert.deepEqual(await f.service.getSession(hostA, created._id), created);
});

test("creation rejects malformed configuration before any repository access", async () => {
    for (const body of [null, {}, input({ selectedIds: selectedIds.slice(0, 2) }),
        input({ selectedIds: [selectedIds[0], selectedIds[0], selectedIds[2]] }), input({ voterCount: 11 })]) {
        const f = fixture();
        await assert.rejects(() => f.service.createSession(hostA, body), MovieNightRuleError);
        assert.deepEqual(f.calls, []);
        assert.equal(f.records.size, 0);
    }
});

test("creation rejects unknown movies and shows using trusted catalogue lookup", async () => {
    for (const id of ["movie-missing", "show-001"]) {
        const f = fixture();
        await expectRuleError(() => f.service.createSession(hostA, input({ selectedIds: [id, ...selectedIds.slice(1)] })), "INVALID_SELECTED_IDS", 400);
        assert.deepEqual(f.calls.map(call => call.method), ["findByIds"]);
        assert.equal(f.records.size, 0);
    }
});

test("all use cases reject missing identity context before accessing repositories", async () => {
    const f = fixture([record()]);
    for (const actor of [undefined, null, {}, { id: "" }, { id: " " }, { id: 1 }, { id: hostA.id + " " }]) {
        for (const action of [
            () => f.service.createSession(actor, input({ hostUser: hostA.id })),
            () => f.service.getSession(actor, sessionId),
            () => f.service.listSessions(actor),
            () => f.service.resetSession(actor, sessionId),
            () => f.service.deleteSession(actor, sessionId)
        ]) await expectRuleError(action, "AUTH_REQUIRED", 401);
    }
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.records.get(sessionId), record());
});

test("get returns an owned session with its votes and catalogue configuration", async () => {
    const f = fixture([record()]);
    assert.deepEqual(await f.service.getSession(hostA, sessionId), record());
    assert.deepEqual(f.calls, [{ method: "findOwned", args: [{ sessionId, hostUser: hostA.id }] }]);
});

test("list returns only the host's sessions and an empty array for a host without sessions", async () => {
    const own = record();
    const anotherOwn = record({ _id: "000000000000000000000011", votes: [] });
    const foreign = record({ _id: "000000000000000000000012", hostUser: hostB.id });
    const f = fixture([own, anotherOwn, foreign]);
    assert.deepEqual(await f.service.listSessions(hostA), { sessions: [own, anotherOwn] });
    assert.deepEqual(await f.service.listSessions(hostB), { sessions: [foreign] });
    assert.deepEqual(await fixture().service.listSessions(hostA), { sessions: [] });
    assert.deepEqual(f.calls, [
        { method: "listOwned", args: [{ hostUser: hostA.id }] },
        { method: "listOwned", args: [{ hostUser: hostB.id }] }
    ]);
});

test("reset clears votes and reopens voting while preserving identity, host, selection and count", async () => {
    const original = record({ voterCount: 2, votes: [selectedIds[0], selectedIds[1]], status: "complete" });
    const foreign = record({ _id: missingId, hostUser: hostB.id });
    const f = fixture([original, foreign]);
    const reset = await f.service.resetSession(hostA, sessionId);
    assert.deepEqual(reset, { ...original, votes: [], status: "voting", updatedAt: "2026-11-18T00:00:02.000Z" });
    assert.deepEqual(f.calls, [{
        method: "updateOwned", args: [{ sessionId, hostUser: hostA.id }, { votes: [], status: "voting" }]
    }]);
    assert.deepEqual(f.records.get(missingId), foreign);
    assert.deepEqual(await f.service.getSession(hostA, sessionId), reset);
});

test("reset of an empty session remains valid and does not replace its configuration", async () => {
    const f = fixture([record({ votes: [] })]);
    await f.service.resetSession(hostA, sessionId);
    const reset = await f.service.resetSession(hostA, sessionId);
    assert.deepEqual(reset.selectedIds, selectedIds);
    assert.equal(reset.voterCount, 4);
    assert.deepEqual(reset.votes, []);
    assert.equal(f.records.size, 1);
});

test("delete removes exactly the owned session and returns no response payload", async () => {
    const foreign = record({ _id: missingId, hostUser: hostB.id });
    const f = fixture([record(), foreign]);
    assert.equal(await f.service.deleteSession(hostA, sessionId), undefined);
    assert.deepEqual(f.calls, [{ method: "deleteOwned", args: [{ sessionId, hostUser: hostA.id }] }]);
    assert.equal(f.records.has(sessionId), false);
    assert.deepEqual(f.records.get(missingId), foreign);
    await expectRuleError(() => f.service.getSession(hostA, sessionId), "SESSION_NOT_FOUND", 404);
    await expectRuleError(() => f.service.deleteSession(hostA, sessionId), "SESSION_NOT_FOUND", 404);
});

test("foreign and missing sessions produce the same not-found result for get, reset, and delete", async () => {
    for (const method of ["getSession", "resetSession", "deleteSession"]) {
        for (const id of [sessionId, missingId]) {
            const f = fixture([record()]);
            await expectRuleError(() => f.service[method](hostB, id), "SESSION_NOT_FOUND", 404);
            assert.deepEqual(f.calls[0].args[0], { sessionId: id, hostUser: hostB.id });
            assert.deepEqual([...f.records.values()], [record()]);
            assert.equal(f.calls.length, 1);
        }
    }
});

test("admin role does not bypass host ownership", async () => {
    const f = fixture([record()]);
    const admin = { ...hostB, role: "admin" };
    assert.deepEqual(await f.service.listSessions(admin), { sessions: [] });
    for (const method of ["getSession", "resetSession", "deleteSession"]) {
        await expectRuleError(() => f.service[method](admin, sessionId), "SESSION_NOT_FOUND", 404);
    }
    assert.deepEqual(f.records.get(sessionId), record());
});

test("invalid session IDs never reach a repository, including query-shaped objects", async () => {
    const f = fixture([record()]);
    for (const id of [undefined, null, "", " ", sessionId + " ", 10, [], { $ne: null }]) {
        for (const method of ["getSession", "resetSession", "deleteSession"]) {
            await expectRuleError(() => f.service[method](hostA, id), "INVALID_SESSION_ID", 400);
        }
    }
    assert.deepEqual(f.calls, []);
});

test("foreign repository results are rejected rather than returned to callers", async () => {
    const f = fixture();
    const foreign = record({ hostUser: hostB.id });
    f.sessionRepository.create = async () => foreign;
    f.sessionRepository.findOwned = async () => foreign;
    f.sessionRepository.listOwned = async () => [record(), foreign];
    f.sessionRepository.updateOwned = async () => foreign;
    for (const action of [
        () => f.service.createSession(hostA, input()),
        () => f.service.getSession(hostA, sessionId),
        () => f.service.listSessions(hostA),
        () => f.service.resetSession(hostA, sessionId)
    ]) await assert.rejects(action, /outside the requested scope/);
});

test("repositories returning a different session ID cannot satisfy get or reset", async () => {
    const f = fixture();
    f.sessionRepository.findOwned = async () => record({ _id: missingId });
    f.sessionRepository.updateOwned = async () => record({ _id: missingId });
    await assert.rejects(() => f.service.getSession(hostA, sessionId), /outside the requested scope/);
    await assert.rejects(() => f.service.resetSession(hostA, sessionId), /outside the requested scope/);
});

test("malformed repository results are not mistaken for successful operations", async () => {
    const f = fixture();
    f.sessionRepository.create = async () => null;
    f.sessionRepository.findOwned = async () => undefined;
    f.sessionRepository.listOwned = async () => null;
    f.sessionRepository.updateOwned = async () => undefined;
    f.sessionRepository.deleteOwned = async () => ({ deletedCount: 1 });
    for (const action of [
        () => f.service.createSession(hostA, input()),
        () => f.service.getSession(hostA, sessionId),
        () => f.service.listSessions(hostA),
        () => f.service.resetSession(hostA, sessionId),
        () => f.service.deleteSession(hostA, sessionId)
    ]) await assert.rejects(action, error => error instanceof Error && !(error instanceof MovieNightRuleError));
});

test("repository failures propagate without success responses or fallback mutations", async () => {
    for (const [repositoryMethod, serviceMethod] of [
        ["create", "createSession"], ["findOwned", "getSession"], ["listOwned", "listSessions"],
        ["updateOwned", "resetSession"], ["deleteOwned", "deleteSession"]
    ]) {
        const f = fixture([record()]);
        const failure = new Error("Test repository unavailable");
        f.sessionRepository[repositoryMethod] = async () => { throw failure; };
        await assert.rejects(() => f.service[serviceMethod](hostA, serviceMethod === "createSession" ? input() : sessionId), error => error === failure);
        assert.deepEqual(f.records.get(sessionId), record());
    }
});

test("catalogue failures prevent creation without a static-data fallback", async () => {
    const f = fixture();
    const failure = new Error("Test catalogue unavailable");
    f.titleRepository.findByIds = async () => { throw failure; };
    await assert.rejects(() => f.service.createSession(hostA, input()), error => error === failure);
    assert.equal(f.records.size, 0);
    assert.deepEqual(f.calls, []);
});
