"use strict";
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["user", "admin"], default: "user", required: true }
}, { timestamps: true, versionKey: false, strict: "throw", autoIndex: false,
    toJSON: { transform(_doc, value) { delete value.passwordHash; delete value._id; return value; } } });

userSchema.index({ email: 1 }, { unique: true, name: "user_email_unique" });
module.exports = mongoose.models.User || mongoose.model("User", userSchema);
