"use strict";

const mongoose = require("mongoose");
const STATUSES = Object.freeze(["want-to-watch", "watching", "watched"]);

const watchlistSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    itemId: { type: String, required: true, immutable: true, maxlength: 128,
        validate: value => value.length > 0 && value === value.trim() },
    status: { type: String, enum: STATUSES, default: "want-to-watch", required: true }
}, { timestamps: { createdAt: "addedAt", updatedAt: "updatedAt" }, versionKey: false });

watchlistSchema.index({ user: 1, itemId: 1 }, { unique: true, name: "unique_user_watchlist_item" });

module.exports = mongoose.models.Watchlist || mongoose.model("Watchlist", watchlistSchema);
module.exports.STATUSES = STATUSES;
