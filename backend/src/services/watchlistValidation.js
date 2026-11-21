"use strict";
const { STATUSES } = require("../models/Watchlist");

function validItemId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 128 && value === value.trim();
}

function validateBody(body, update = false) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return "Send a JSON object.";
    const allowed = update ? ["status"] : ["itemId", "status"];
    if (Object.keys(body).some(key => !allowed.includes(key))) return "Unsupported request field.";
    if (!update && !validItemId(body.itemId)) return "Provide a valid catalogue itemId (up to 128 characters).";
    if ((update || Object.hasOwn(body, "status")) && !STATUSES.includes(body.status)) {
        return "status must be want-to-watch, watching, or watched.";
    }
    return null;
}

module.exports = { validItemId, validateBody };
