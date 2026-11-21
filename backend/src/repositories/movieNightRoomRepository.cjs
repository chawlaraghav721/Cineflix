"use strict";
const { identifier, toRecord } = require("./movieNightRepository.cjs");
const { requireMethods } = require("../services/movieNightSessionService.cjs");
const { validateRevision } = require("../services/movieNightRules.cjs");
const { normalizeRoomCode, requireRoundId, validateRoom } = require("../services/movieNightRoomRules.cjs");

function createMovieNightRoomRepository(model) {
    requireMethods(model, "model", ["create", "findOne", "findOneAndUpdate"]);
    const base = s => ({ _id: identifier(s.roomId), mode: "room" });
    const round = s => ({ ...base(s), roundId: requireRoundId(s.roundId), revision: { $lt: Number.MAX_SAFE_INTEGER } });
    const host = s => ({ ...round(s), hostUser: identifier(s.actorId), revision: validateRevision(s.expectedRevision) });
    const options = { returnDocument: "after", upsert: false };
    const update = async (filter, mutation, opts = options) => toRecord(await model.findOneAndUpdate(filter, mutation, opts).lean().exec());
    return {
        async createRoom(r) {
            validateRoom(r);
            const { selectedIds, voterCount, roomCode, roundId } = r;
            return toRecord(await model.create({ mode: "room", hostUser: identifier(r.hostUser), selectedIds, voterCount,
                roomCode, roundId, participants: [], votes: [], status: "waiting", revision: 0 }));
        },
        async findByCode(code) { return toRecord(await model.findOne({ mode: "room", roomCode: normalizeRoomCode(code) }).lean().exec()); },
        async findAccessible(s) {
            const actorId = identifier(s.actorId);
            return toRecord(await model.findOne({ ...base(s), $or: [{ hostUser: actorId }, { participants: actorId }] }).lean().exec());
        },
        async joinRoom(s) {
            return update({ ...round(s), status: "waiting", participants: { $ne: identifier(s.actorId) },
                $expr: { $lt: [{ $size: "$participants" }, "$voterCount"] } },
            { $push: { participants: s.actorId }, $inc: { revision: 1 } });
        },
        async startRoom(s) {
            return update({ ...host(s), status: "waiting", $expr: { $eq: [{ $size: "$participants" }, "$voterCount"] } },
                { $set: { status: "voting" }, $inc: { revision: 1 } });
        },
        async resetRoom(s, nextRoundId) {
            requireRoundId(nextRoundId);
            if (nextRoundId === s.roundId) throw new TypeError("A fresh round ID is required.");
            return update(host(s), { $set: { votes: [], status: "waiting", roundId: nextRoundId }, $inc: { revision: 1 } });
        },
        async appendBallot(s, itemId) {
            const actorId = identifier(s.actorId);
            if (typeof itemId !== "string" || !itemId) throw new TypeError("A selected catalogue ID is required.");
            const filter = { ...round(s), status: "voting", participants: actorId, selectedIds: itemId,
                votes: { $not: { $elemMatch: { participantId: actorId, roundId: s.roundId } } },
                $expr: { $lt: [{ $size: "$votes" }, "$voterCount"] } };
            // Pipeline derives completion after appending, so concurrent different
            // participants cannot leave a full room marked as still voting.
            const pipeline = [
                { $set: { votes: { $concatArrays: ["$votes", { $literal: [{ participantId: actorId, itemId, roundId: s.roundId }] }] },
                    revision: { $add: ["$revision", 1] }, updatedAt: "$$NOW" } },
                { $set: { status: { $cond: [{ $eq: [{ $size: "$votes" }, "$voterCount"] }, "complete", "voting"] } } }
            ];
            return update(filter, pipeline, { ...options, updatePipeline: true, timestamps: false });
        }
    };
}
module.exports = { createMovieNightRoomRepository };
