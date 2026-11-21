"use strict";
const { calculateResults } = require("../services/movieNightRules.cjs");
const { validateRoom } = require("../services/movieNightRoomRules.cjs");

function validateStoredSession(record) {
    if (record.mode === "room") return validateRoom({ ...record,
        participants: record.participants.map(String) });
    const results = calculateResults(record);
    if (!Number.isSafeInteger(record.revision) || record.revision < 0 ||
        record.status !== (results.complete ? "complete" : "voting")) {
        throw new Error("Invalid session status or revision.");
    }
    return true;
}

// M1 supplies BOTH the Mongoose library and its existing connection. Never connect here.
function createMovieNightSessionModel({ mongoose, connection }) {
    if (!mongoose?.Schema || typeof connection?.model !== "function") throw new TypeError("Mongoose and the shared connection are required.");
    if (connection.models.MovieNightSession) return connection.models.MovieNightSession;
    const schema = new mongoose.Schema({
        mode: { type: String, enum: ["sequential", "room"], default: "sequential", required: true, immutable: true },
        hostUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
        selectedIds: { type: [String], required: true, default: undefined, immutable: true },
        voterCount: { type: Number, required: true, min: 2, max: 10, immutable: true, validate: Number.isInteger },
        votes: { type: [mongoose.Schema.Types.Mixed], default: [] },
        status: { type: String, enum: ["waiting", "voting", "complete"], required: true },
        roomCode: { type: String, immutable: true, required: function () { return this.mode === "room"; } },
        roundId: { type: String, required: function () { return this.mode === "room"; } },
        participants: { type: [mongoose.Schema.Types.ObjectId], default: [] },
        revision: { type: Number, required: true, default: 0, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger }
    }, { collection: "movienightsessions", timestamps: true, versionKey: false, strict: "throw", autoIndex: false });
    schema.path("votes").validate(function (votes) {
        // Document validation only; atomic updates require explicit query guards.
        if (typeof this.toObject !== "function") return true;
        try { return validateStoredSession({ ...this.toObject(), votes }); } catch { return false; }
    }, "Invalid Movie Night configuration, vote history or completion state.");
    schema.index({ hostUser: 1, mode: 1, createdAt: -1 });
    schema.index({ roomCode: 1 }, { unique: true, partialFilterExpression: { mode: "room", roomCode: { $type: "string" } } });
    schema.index({ mode: 1, participants: 1 });
    return connection.model("MovieNightSession", schema);
}
module.exports = { createMovieNightSessionModel, validateStoredSession };
