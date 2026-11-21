"use strict";
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");
const { createApp } = require("../src/app");
const { loadAuthConfig } = require("../src/config/auth");
const { seedCatalogue } = require("../src/scripts/seedCatalogue");
const User = require("../src/models/User");
const { createRatingModel } = require("../src/models/Rating.cjs");
const { ensureRatingIndexes } = require("../src/routes/createRatingRouter.cjs");

async function ratingsFixture(t) {
    const mongo = await MongoMemoryServer.create();
    t.after(async () => { await disconnectDatabase(); await mongo.stop(); });
    await connectDatabase(mongo.getUri()); // Never use .env or the shared Atlas database.
    await User.createIndexes();
    await ensureRatingIndexes();
    await seedCatalogue();
    const Rating = createRatingModel({ mongoose, connection: mongoose.connection });
    const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("hex"), APP_ORIGIN: "http://cineflix.test" });
    const app = createApp({ authConfig: config });
    let serial = 0;
    async function account() {
        const agent = request.agent(app);
        const result = await agent.post("/api/auth/register").set("Origin", config.origin)
            .send({ name: "Ratings Viewer", email: `ratings-${++serial}@example.test`, password: "private ratings integration password" }).expect(201);
        return { agent, user: result.body.user };
    }
    return { mongo, Rating, config, app, account };
}
module.exports = { ratingsFixture };
