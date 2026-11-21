"use strict";
const { randomBytes } = require("node:crypto");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");
const { createApp } = require("../src/app");
const { loadAuthConfig } = require("../src/config/auth");
const { seedCatalogue } = require("../src/scripts/seedCatalogue");
const User = require("../src/models/User");
const { createMovieNightSessionModel } = require("../src/models/MovieNightSession.cjs");

async function integrationFixture(t) {
    const mongo = await MongoMemoryServer.create();
    t.after(async () => { await disconnectDatabase(); await mongo.stop(); });
    await connectDatabase(mongo.getUri()); // Explicit isolated URI, never process.env/Atlas.
    const Session = createMovieNightSessionModel({ mongoose, connection: mongoose.connection });
    await User.createIndexes();
    await Session.createIndexes(); // Test proposed indexes on the isolated database only.
    await seedCatalogue();
    const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("hex"), APP_ORIGIN: "http://cineflix.test" });
    const app = createApp({ authConfig: config });
    let serial = 0;
    async function account() {
        const agent = request.agent(app);
        const result = await agent.post("/api/auth/register").set("Origin", config.origin)
            .send({ name: "Movie Night Viewer", email: `movie-night-${++serial}@example.test`, password: "a private movie night test password" }).expect(201);
        return { agent, user: result.body.user, cookie: result.headers["set-cookie"][0].split(";")[0] };
    }
    const post = (agent, url, body, revision) => {
        const req = agent.post(url).set("Origin", config.origin);
        if (revision !== undefined) req.set("X-Movie-Night-Revision", String(revision));
        return body === undefined ? req : req.send(body);
    };
    return { mongo, app, config, Session, account, post };
}
const configuration = { selectedIds: ["movie-011", "movie-012", "movie-013"], voterCount: 4 };
module.exports = { integrationFixture, configuration };
