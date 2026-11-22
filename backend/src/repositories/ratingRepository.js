"use strict";
const Rating = require("../models/Rating");

const personalFields = { _id: 0, score: 1, reviewText: 1 };
const owned = (user, itemId) => ({ user, itemId });

async function findOwn(user, itemId) {
    return Rating.findOne(owned(user, itemId), personalFields).lean();
}

async function saveOwn(user, itemId, values) {
    // Explicitly build the update; never pass HTTP payloads to MongoDB.
    const changes = { score: values.score };
    if (Object.hasOwn(values, "reviewText")) changes.reviewText = values.reviewText;
    const filter = owned(user, itemId);
    const write = upsert => Rating.findOneAndUpdate(filter, { $set: changes }, {
        upsert, new: true, runValidators: true, setDefaultsOnInsert: true
    }).select(personalFields).lean();
    try { return await write(true); }
    catch (error) {
        if (error.code !== 11000 || !error.keyPattern?.user || !error.keyPattern?.itemId) throw error;
        // Only retry the expected concurrent insert collision; remain owner-scoped.
        const result = await write(false);
        if (!result) throw error;
        return result;
    }
}

async function removeOwn(user, itemId) {
    await Rating.deleteOne(owned(user, itemId));
}

async function community(itemId) {
    const [result] = await Rating.aggregate([
        { $match: { itemId } },
        { $facet: {
            statistics: [{ $group: { _id: null, average: { $avg: "$score" }, count: { $sum: 1 } } }],
            reviews: [
                { $match: { reviewText: { $type: "string", $ne: "" } } },
                { $sort: { updatedAt: -1, _id: -1 } },
                { $limit: 20 },
                { $project: { _id: 0, score: 1, reviewText: 1, createdAt: 1, updatedAt: 1 } }
            ]
        } }
    ]);
    const statistics = result?.statistics[0];
    return { average: statistics?.average ?? null, count: statistics?.count ?? 0, reviews: result?.reviews ?? [] };
}

async function listOwn(user) {
    return Rating.find({ user }).sort({ itemId: 1 }).select({ _id: 0, itemId: 1,
        score: 1, reviewText: 1, createdAt: 1, updatedAt: 1 }).lean();
}

module.exports = { findOwn, saveOwn, removeOwn, community, listOwn };
