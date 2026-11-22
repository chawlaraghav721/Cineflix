"use strict";
const { MongoMemoryServer } = require("mongodb-memory-server");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");
const Rating = require("../src/models/Rating");

async function ratingsDatabase(t) {
    const mongo = await MongoMemoryServer.create();
    t.after(async () => { await disconnectDatabase(); await mongo.stop(); });
    await connectDatabase(mongo.getUri()); // Explicit disposable URI; never .env/Atlas.
    await Rating.createIndexes();
    return { mongo, Rating };
}
module.exports = { ratingsDatabase };
