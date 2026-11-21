"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { integrationFixture, configuration } = require("../test-support/movieNightIntegration.cjs");
const { startBackendProcess } = require("../test-support/movieNightServerProcess.cjs");
const { createMovieNightRoomService } = require("../src/services/movieNightRoomService.cjs");
const { createMovieNightRoomRepository } = require("../src/repositories/movieNightRoomRepository.cjs");
const { createMovieNightTitleRepository } = require("../src/repositories/movieNightRepository.cjs");
const Title = require("../src/models/Title");

test("persistent rooms, indexes and participant voting with real MongoDB/authentication", { timeout: 90000 }, async t => {
    const f = await integrationFixture(t);
    const a = await f.account(), b = await f.account(), c = await f.account();
    let room;
    const endpoint = id => "/api/movie-night/rooms/" + id;
    const join = account => f.post(account.agent, "/api/movie-night/rooms/join", { roomCode: room.roomCode });
    await t.test("unique partial room-code index coexists with sequential sessions", async () => {
        const indexes = await f.Session.collection.indexes();
        const index = indexes.find(i => i.key.roomCode === 1);
        assert.equal(index.unique, true); assert.equal(index.partialFilterExpression.mode, "room");
        const response = await f.post(a.agent, "/api/movie-night/rooms", { ...configuration, voterCount: 2 }).expect(201);
        room = response.body;
        const stored = await f.Session.findById(room.id).lean();
        await assert.rejects(() => f.Session.create({ ...stored, _id: undefined }), e => e.code === 11000 && e.keyPattern.roomCode === 1);
        await f.post(a.agent, "/api/movie-night/sessions", configuration).expect(201);
        await f.post(a.agent, "/api/movie-night/sessions", configuration).expect(201);
        assert.equal((await a.agent.get("/api/movie-night/sessions")).body.sessions.some(s => s._id === room.id), false);
        await a.agent.get("/api/movie-night/sessions/" + room.id).expect(404);
    });
    await t.test("a real unique-index collision is retried safely by room creation", async () => {
        const codes = [room.roomCode, "ZZZZZZZY"];
        const service = createMovieNightRoomService({ roomRepository: createMovieNightRoomRepository(f.Session),
            titleRepository: createMovieNightTitleRepository(Title), codeGenerator: () => codes.shift() });
        const created = await service.createRoom({ id: a.user.id }, { ...configuration, voterCount: 2 });
        assert.equal(created.roomCode, "ZZZZZZZY"); assert.equal(codes.length, 0);
        assert.equal(await f.Session.countDocuments({ roomCode: room.roomCode }), 1);
    });
    await t.test("authenticated joins are idempotent and concurrent accounts cannot exceed capacity", async () => {
        await request(f.app).post("/api/movie-night/rooms/join").set("Origin", f.config.origin).send({ roomCode: room.roomCode }).expect(401);
        await join(a).expect(200); await join(a).expect(200);
        const responses = await Promise.all([join(b), join(c)]);
        assert.equal(responses.filter(r => r.status === 200).length, 1);
        assert.equal((await f.Session.findById(room.id)).participants.length, 2);
        const joined = responses[0].status === 200 ? b : c;
        f.participant = joined;
    });
    await t.test("only the host starts/resets; inaccessible accounts cannot poll", async () => {
        const outsider = f.participant === b ? c : b;
        await outsider.agent.get(endpoint(room.id)).expect(404);
        await f.post(f.participant.agent, endpoint(room.id) + "/start", undefined, 2).expect(403);
        await f.post(a.agent, endpoint(room.id) + "/start", undefined, 2).expect(200);
        await f.post(outsider.agent, "/api/movie-night/rooms/join", { roomCode: room.roomCode }).expect(409);
    });
    await t.test("different backend processes accept independent votes and reject account duplicates", async () => {
        const servers = [];
        t.after(async () => { await Promise.all(servers.map(s => s.close())); });
        for (let i = 0; i < 2; i++) servers.push(await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret }));
        const vote = (server, account, itemId) => request(server.origin).put(endpoint(room.id) + "/votes/me")
            .set("Origin", server.origin).set("Cookie", account.cookie).set("X-Movie-Night-Round", room.roundId).send({ itemId });
        const responses = await Promise.all([vote(servers[0], a, configuration.selectedIds[0]),
            vote(servers[1], a, configuration.selectedIds[1]), vote(servers[1], f.participant, configuration.selectedIds[1])]);
        assert.equal(responses.filter(r => r.status === 200).length, 2);
        assert.equal(responses.filter(r => r.status === 409).length, 1);
        const stored = await f.Session.findById(room.id).lean();
        assert.equal(stored.votes.length, 2); assert.equal(new Set(stored.votes.map(v => v.participantId)).size, 2);
        assert.equal(stored.status, "complete"); assert.equal(stored.revision, 5);
        await Promise.all(servers.map(s => s.close()));
    });
    await t.test("polling returns persistent results without raw identities/ballots", async () => {
        const state = (await f.participant.agent.get(endpoint(room.id)).expect(200)).body;
        assert.equal(state.results.complete, true); assert.equal(state.hasVoted, true);
        assert.equal(state.participants, undefined); assert.equal(state.votes, undefined); assert.equal(state.hostUser, undefined);
        assert.equal(state.roomCode, undefined); assert.equal(state.results.tallies.reduce((sum, t) => sum + t.count, 0), 2);
    });
    await t.test("reset persists a fresh round and rejects old ballots", async () => {
        const reset = (await f.post(a.agent, endpoint(room.id) + "/reset", undefined, 5).expect(200)).body;
        assert.notEqual(reset.roundId, room.roundId); assert.equal(reset.participantCount, 2);
        await f.post(a.agent, endpoint(room.id) + "/start", undefined, 6).expect(200);
        await f.participant.agent.put(endpoint(room.id) + "/votes/me").set("Origin", f.config.origin)
            .set("X-Movie-Night-Round", room.roundId).send({ itemId: configuration.selectedIds[0] }).expect(409);
        assert.equal((await f.Session.findById(room.id)).votes.length, 0);
    });
    await t.test("room joining has an authenticated per-account request limit", async () => {
        let last;
        for (let i = 0; i < 31; i++) last = await f.post(c.agent, "/api/movie-night/rooms/join", { roomCode: "ZZZZZZZZ" });
        assert.equal(last.status, 429); assert.equal(last.body.error.code, "ROOM_JOIN_LIMIT");
    });
});
