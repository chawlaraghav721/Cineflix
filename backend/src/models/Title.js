"use strict";

const mongoose = require("mongoose");

const titleSchema = new mongoose.Schema({
    id: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: ["movie", "show"] },
    title: { type: String, required: true, trim: true },
    genre: { type: String, required: true, trim: true },
    poster: { type: String, required: true },
    description: { type: String, required: true },
    year: { type: Number, min: 1 },
    rating: { type: Number, min: 0, max: 10 },
    cast: { type: [String], default: undefined },
    director: { type: String },
    duration: { type: String },
    trailerUrl: { type: String }
}, {
    timestamps: true,
    versionKey: false,
    toJSON: { transform: (_document, value) => { delete value._id; return value; } },
    toObject: { transform: (_document, value) => { delete value._id; return value; } }
});

titleSchema.index({ id: 1 }, { unique: true, name: "unique_catalogue_id" });

module.exports = mongoose.models.Title || mongoose.model("Title", titleSchema);
