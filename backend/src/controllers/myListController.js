"use strict";
const Watchlist = require("../models/Watchlist");

function publicEntry(entry) {
    return { itemId: entry.itemId, status: entry.status, addedAt: entry.addedAt, updatedAt: entry.updatedAt };
}
function fail(res, status, code, message) {
    return res.status(status).json({ error: { code, message } });
}
async function getMyList(req, res, next) {
    try {
        const entries = await Watchlist.find({ user: req.user.id }).sort({ addedAt: -1, itemId: 1 }).lean();
        return res.json({ items: entries.map(publicEntry) });
    } catch (error) { return next(error); }
}
module.exports = { getMyList, publicEntry, fail };
