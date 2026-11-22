"use strict";

const mongoose = require("mongoose");

const titleSchema = new mongoose.Schema({
    id: { type: String, required: true, trim: true, minlength: 3, maxlength: 128,
        match: /^(movie|show)-[a-z0-9]+(?:-[a-z0-9]+)*$/i },
    type: { type: String, required: true, enum: ["movie", "show"] },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    genre: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    poster: { type: String, required: true, trim: true, minlength: 1, maxlength: 2048 },
    description: { type: String, default: "", maxlength: 10000 },
    year: { type: Number, min: 1, max: 3000, validate: Number.isInteger },
    rating: { type: Number, min: 0, max: 10 },
    cast: { type: [{ type: String, trim: true, minlength: 1, maxlength: 120 }], default: undefined,
        validate: value => value.length <= 50 },
    director: { type: String, trim: true, maxlength: 200 },
    duration: { type: String, trim: true, maxlength: 80 },
    trailerUrl: { type: String, trim: true, maxlength: 2048 }
}, {
    timestamps: true,
    versionKey: false,
    strict: "throw",
    autoIndex: false,
    toJSON: { transform: (_document, value) => { delete value._id; return value; } },
    toObject: { transform: (_document, value) => { delete value._id; return value; } }
});

titleSchema.index({ id: 1 }, { unique: true, name: "unique_catalogue_id" });

module.exports = mongoose.models.Title || mongoose.model("Title", titleSchema);
