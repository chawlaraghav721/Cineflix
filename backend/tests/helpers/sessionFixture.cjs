"use strict";
const catalogue = require("../../../data/catalogue.json");
const { createMovieNightSessionService } = require("../../src/services/movieNightSessionService.cjs");
const hostA = { id: "000000000000000000000001", role: "user" };
const hostB = { id: "000000000000000000000002", role: "user" };
const sessionId = "000000000000000000000010";
const selectedIds = ["movie-011", "movie-012", "movie-013"];
const input = extra => ({ selectedIds: [...selectedIds], voterCount: 4, ...extra });
const record = extra => ({ _id: sessionId, hostUser: hostA.id, ...input(), votes: [selectedIds[0]],
    status: "voting", revision: 1, ...extra });
function fixture(seed = [record()]) {
    const records = new Map(seed.map(r => [r._id, structuredClone(r)]));
    const calls = [];
    const log = (method, ...args) => calls.push({ method, args: structuredClone(args) });
    const owned = s => {
        const r = records.get(s.sessionId);
        return r && r.hostUser === s.hostUser ? r : null;
    };
    const cas = s => {
        const r = owned(s);
        return r && r.revision === s.expectedRevision ? r : null;
    };
    let id = 1000;
    const sessionRepository = {
        async create(value) { log("create", value); const r = { ...structuredClone(value), _id: String(id++).padStart(24, "0") }; records.set(r._id, r); return structuredClone(r); },
        async findOwned(s) { log("findOwned", s); return structuredClone(owned(s)); },
        async listOwned(s) { log("listOwned", s); return structuredClone([...records.values()].filter(r => r.hostUser === s.hostUser)); },
        async appendVoteOwned(s, vote) {
            log("appendVoteOwned", s, vote);
            const r = cas(s);
            if (!r || r.status !== "voting" || !r.selectedIds.includes(vote.itemId) || r.votes.length >= r.voterCount) return null;
            r.votes.push(vote.itemId); r.status = vote.nextStatus; r.revision++;
            return structuredClone(r);
        },
        async resetVotesOwned(s) { log("resetVotesOwned", s); const r = cas(s); if (!r) return null; r.votes = []; r.status = "voting"; r.revision++; return structuredClone(r); },
        async deleteOwned(s) { log("deleteOwned", s); return owned(s) ? records.delete(s.sessionId) : false; }
    };
    const titleRepository = { async findByIds(ids) { log("findByIds", ids); return [...catalogue.movies, ...catalogue.shows].filter(t => ids.includes(t.id)); } };
    return { records, calls, sessionRepository, titleRepository,
        service: createMovieNightSessionService({ sessionRepository, titleRepository }) };
}
module.exports = { fixture, hostA, hostB, sessionId, selectedIds, input, record };
