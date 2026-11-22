"use strict";
const { randomBytes } = require("node:crypto");
const request = require("supertest");
const { ratingsDatabase } = require("./ratingsDatabase.cjs");
const { seedCatalogue } = require("../src/scripts/seedCatalogue");
const { createApp } = require("../src/app");
const { loadAuthConfig } = require("../src/config/auth");
const User = require("../src/models/User");

async function ratingsHttp(t) {
    const database = await ratingsDatabase(t);
    await User.createIndexes();
    await seedCatalogue();
    const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("hex"), APP_ORIGIN: "http://ratings.test" });
    const app = createApp({ authConfig: config });
    let sequence = 0;
    async function account() {
        const agent = request.agent(app);
        const response = await agent.post("/api/auth/register").set("Origin", config.origin)
            .send({ name: "Ratings Test Viewer", email: `ratings-${++sequence}@example.test`, password: "a private ratings test password" }).expect(201);
        return { agent, user: response.body.user };
    }
    return { ...database, config, app, account };
}
module.exports = { ratingsHttp };
