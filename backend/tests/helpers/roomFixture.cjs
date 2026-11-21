"use strict";
const { createMovieNightRoomService } = require("../../src/services/movieNightRoomService.cjs");
const { hostA, hostB, selectedIds, input } = require("./sessionFixture.cjs");
const catalogue = require("../../../data/catalogue.json");
const roomId = "000000000000000000000020";
const third = { id: "000000000000000000000003" };
const room = extra => ({ _id: roomId, mode: "room", hostUser: hostA.id, ...input({ voterCount: 2 }),
    roomCode: "ABCDEFGH", roundId: "round-one", revision: 0, participants: [], votes: [], status: "waiting", ...extra });
function fixture(seed = [room()], overrides = {}) {
    const records = new Map(seed.map(r => [r._id, structuredClone(r)])); const calls = [];
    const log = (name, s) => calls.push([name, structuredClone(s)]);
    const match = s => { const r = records.get(s.roomId); return r && r.roundId === s.roundId ? r : null; };
    const hostMatch = s => { const r = match(s); return r && r.hostUser === s.actorId && r.revision === s.expectedRevision ? r : null; };
    const roomRepository = {
        async createRoom(value) { const r = { ...structuredClone(value), _id: roomId }; records.set(roomId, r); return structuredClone(r); },
        async findByCode(code) { return structuredClone([...records.values()].find(r => r.roomCode === code) || null); },
        async findAccessible(s) { const r = records.get(s.roomId); return r && (r.hostUser === s.actorId || r.participants.includes(s.actorId)) ? structuredClone(r) : null; },
        async joinRoom(s) { log("join", s); const r = match(s);
            if (!r || r.status !== "waiting" || r.participants.includes(s.actorId) || r.participants.length >= r.voterCount) return null;
            r.participants.push(s.actorId); r.revision++; return structuredClone(r); },
        async startRoom(s) { log("start", s); const r = hostMatch(s);
            if (!r || r.status !== "waiting" || r.participants.length !== r.voterCount) return null;
            r.status = "voting"; r.revision++; return structuredClone(r); },
        async resetRoom(s, nextRound) { log("reset", s); const r = hostMatch(s); if (!r) return null;
            r.status = "waiting"; r.votes = []; r.roundId = nextRound; r.revision++; return structuredClone(r); },
        async appendBallot(s, itemId) { log("vote", s); const r = match(s);
            if (!r || r.status !== "voting" || !r.participants.includes(s.actorId) || r.votes.some(v => v.participantId === s.actorId) || r.votes.length >= r.voterCount) return null;
            r.votes.push({ participantId: s.actorId, itemId, roundId: s.roundId }); r.revision++;
            if (r.votes.length === r.voterCount) r.status = "complete";
            return structuredClone(r); }
    };
    const titleRepository = { async findByIds(ids) { return [...catalogue.movies, ...catalogue.shows].filter(t => ids.includes(t.id)); } };
    let nextRound = 0;
    const deps = { roomRepository, titleRepository, codeGenerator: () => "ABCDEFGH", roundGenerator: () => `round-new-${++nextRound}`, ...overrides };
    return { records, roomRepository, calls, service: createMovieNightRoomService(deps), deps };
}
module.exports = { fixture, room, roomId, hostA, hostB, third, selectedIds };
