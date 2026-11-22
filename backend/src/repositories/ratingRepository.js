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

module.exports = { findOwn, saveOwn, removeOwn };
