"use strict";
const { MAX_REVIEW_LENGTH, validateItemId } = require("../services/ratingService.cjs");

// Reuse M1's already connected Mongoose connection. No connect()/server here.
function createRatingModel({ mongoose, connection }) {
    if (!mongoose?.Schema || typeof connection?.model !== "function") {
        throw new TypeError("Mongoose and the shared connection are required.");
    }
    if (connection.models.Rating) return connection.models.Rating;
    const schema = new mongoose.Schema({
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
        itemId: { type: String, required: true, immutable: true, validate: value => {
            try { validateItemId(value); return true; } catch { return false; }
        } },
        score: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
        reviewText: { type: String, default: "", maxlength: MAX_REVIEW_LENGTH, trim: true }
    }, { collection: "ratings", timestamps: true, versionKey: false, strict: "throw", autoIndex: false });
    schema.index({ user: 1, itemId: 1 }, { unique: true, name: "rating_user_item_unique" });
    schema.index({ itemId: 1, updatedAt: -1, _id: -1 });
    return connection.model("Rating", schema);
}

module.exports = { createRatingModel };
