"use strict";
const { requireMethods } = require("../services/movieNightSessionService.cjs");
const { validateRevision } = require("../services/movieNightRules.cjs");

function identifier(value) {
    if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) throw new TypeError("A MongoDB identifier string is required.");
    return value;
}
function toRecord(value) {
    if (value === null) return null;
    const record = typeof value.toObject === "function" ? value.toObject() : { ...value };
    record._id = String(record._id);
    record.hostUser = String(record.hostUser);
    if (record.participants) record.participants = record.participants.map(String);
    if (record.votes) record.votes = record.votes.map(v => typeof v === "string" ? v : { ...v, participantId: String(v.participantId) });
    return record;
}

// Query-building adapter only. The caller owns model/connection/startup/index creation.
function createMovieNightRepository(model) {
    requireMethods(model, "model", ["create", "findOne", "find", "findOneAndUpdate", "deleteOne"]);
    const owned = s => ({ _id: identifier(s.sessionId), hostUser: identifier(s.hostUser), mode: "sequential" });
    const conditional = s => ({ ...owned(s), revision: validateRevision(s.expectedRevision) });
    const updateOptions = { returnDocument: "after", upsert: false };
    return {
        async create(record) {
            const { hostUser, selectedIds, voterCount } = record;
            return toRecord(await model.create({ hostUser: identifier(hostUser), selectedIds, voterCount,
                mode: "sequential", votes: [], status: "voting", revision: 0 }));
        },
        async findOwned(s) { return toRecord(await model.findOne(owned(s)).lean().exec()); },
        async listOwned(s) {
            return (await model.find({ hostUser: identifier(s.hostUser), mode: "sequential" }).sort({ createdAt: -1 }).lean().exec()).map(toRecord);
        },
        async appendVoteOwned(s, { itemId, nextStatus }) {
            if (typeof itemId !== "string" || !["voting", "complete"].includes(nextStatus)) throw new TypeError("Invalid vote update.");
            const filter = { ...conditional(s), status: "voting", selectedIds: itemId,
                $expr: { $lt: [{ $size: "$votes" }, "$voterCount"] } };
            return toRecord(await model.findOneAndUpdate(filter,
                { $push: { votes: itemId }, $inc: { revision: 1 }, $set: { status: nextStatus } }, updateOptions).lean().exec());
        },
        async resetVotesOwned(s) {
            return toRecord(await model.findOneAndUpdate(conditional(s),
                { $set: { votes: [], status: "voting" }, $inc: { revision: 1 } }, updateOptions).lean().exec());
        },
        async deleteOwned(s) { return (await model.deleteOne(owned(s)).exec()).deletedCount === 1; }
    };
}
function createMovieNightTitleRepository(titleModel) {
    requireMethods(titleModel, "titleModel", ["find"]);
    return { async findByIds(ids) {
        if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new TypeError("Catalogue IDs must be strings.");
        return titleModel.find({ id: { $in: [...ids] } }).select({ id: 1, type: 1, _id: 0 }).lean().exec();
    } };
}
module.exports = { createMovieNightRepository, createMovieNightTitleRepository, identifier, toRecord };
