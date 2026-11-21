"use strict";
const Watchlist = require("../models/Watchlist");
const Title = require("../models/Title");
const { validateBody } = require("../services/watchlistValidation");

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
async function addMyList(req, res, next) {
    const invalid = validateBody(req.body);
    if (invalid) return fail(res, 400, "INVALID_INPUT", invalid);
    try {
        if (!await Title.exists({ id: req.body.itemId })) return fail(res, 404, "TITLE_NOT_FOUND", "No catalogue title has that ID.");
        const entry = await Watchlist.create({ user: req.user.id, itemId: req.body.itemId, status: req.body.status });
        return res.status(201).json(publicEntry(entry));
    } catch (error) {
        if (error.code === 11000) return fail(res, 409, "ALREADY_SAVED", "This title is already in your list.");
        return next(error);
    }
}
async function updateMyList(req, res, next) {
    const invalid = validateBody(req.body, true);
    if (invalid) return fail(res, 400, "INVALID_INPUT", invalid);
    try {
        if (!await Title.exists({ id: req.params.itemId })) return fail(res, 404, "TITLE_NOT_FOUND", "No catalogue title has that ID.");
        const entry = await Watchlist.findOneAndUpdate({ user: req.user.id, itemId: req.params.itemId },
            { $set: { status: req.body.status } }, { new: true, runValidators: true });
        if (!entry) return fail(res, 404, "ENTRY_NOT_FOUND", "This title is not in your list.");
        return res.json(publicEntry(entry));
    } catch (error) { return next(error); }
}
async function removeMyList(req, res, next) {
    try {
        // Saved titles can still be removed after catalogue deletion.
        const result = await Watchlist.deleteOne({ user: req.user.id, itemId: req.params.itemId });
        if (!result.deletedCount) return fail(res, 404, "ENTRY_NOT_FOUND", "This title is not in your list.");
        return res.status(204).end();
    } catch (error) { return next(error); }
}
async function clearMyList(req, res, next) {
    try {
        await Watchlist.deleteMany({ user: req.user.id });
        return res.status(204).end();
    } catch (error) { return next(error); }
}
module.exports = { getMyList, addMyList, updateMyList, removeMyList, clearMyList, publicEntry, fail };
