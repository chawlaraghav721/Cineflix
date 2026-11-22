"use strict";
const mongoose = require("mongoose");

const ratingSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    itemId: { type: String, required: true, immutable: true, maxlength: 128,
        validate: value => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value) },
    score: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    reviewText: { type: String, default: "", trim: true, maxlength: 2000,
        validate: value => typeof value === "string" }
}, { collection: "ratings", timestamps: true, versionKey: false, strict: "throw", autoIndex: false });

// Schema validation must reject coercible strings/booleans even outside HTTP.
ratingSchema.path("score").castFunction(value => {
    if (typeof value !== "number") throw new mongoose.Error.CastError("Number", value, "score");
    return value;
});
ratingSchema.path("reviewText").castFunction(value => {
    if (typeof value !== "string") throw new mongoose.Error.CastError("String", value, "reviewText");
    return value;
});
ratingSchema.index({ user: 1, itemId: 1 }, { unique: true, name: "unique_user_rating_item" });
ratingSchema.index({ itemId: 1, updatedAt: -1, _id: -1 }, { name: "recent_title_reviews" });

module.exports = mongoose.models.Rating || mongoose.model("Rating", ratingSchema);
