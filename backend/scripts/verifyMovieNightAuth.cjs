"use strict";
// Optional cross-feature verification against an unchanged Movie Night source checkout.
// Runs only on an isolated temporary MongoDB instance, never on Atlas.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");
const { loadAuthConfig } = require("../src/config/auth");
const { createAuthRouter } = require("../src/routes/authRoutes");
const { requireAuth } = require("../src/middleware/requireAuth");
const { protectMutation } = require("../src/middleware/protectMutation");
const { errorHandler } = require("../src/middleware/errorHandler");
const { seedCatalogue } = require("../src/scripts/seedCatalogue");
const User = require("../src/models/User");
const Title = require("../src/models/Title");

test("real JWT cookies isolate two accounts on Movie Night session endpoints", async t => {
    if (!process.env.MOVIE_NIGHT_SOURCE) throw new Error("Set MOVIE_NIGHT_SOURCE to the Movie Night backend/src checkout directory.");
    const source = path.resolve(process.env.MOVIE_NIGHT_SOURCE);
    const { createMovieNightSessionModel } = require(path.join(source, "models/MovieNightSession.cjs"));
    const { createMovieNightRepository, createMovieNightTitleRepository } = require(path.join(source, "repositories/movieNightRepository.cjs"));
    const { createMovieNightSessionService } = require(path.join(source, "services/movieNightSessionService.cjs"));
    const { createMovieNightControllers } = require(path.join(source, "controllers/movieNightController.cjs"));
    const { registerMovieNightRoutes } = require(path.join(source, "routes/movieNightRoutes.cjs"));
    const mongo = await MongoMemoryServer.create();
    t.after(async () => { await disconnectDatabase(); await mongo.stop(); });
    await connectDatabase(mongo.getUri());
    await User.createIndexes();
    await seedCatalogue();
    const Session = createMovieNightSessionModel({ mongoose, connection: mongoose.connection });
    const service = createMovieNightSessionService({ sessionRepository: createMovieNightRepository(Session),
        titleRepository: createMovieNightTitleRepository(Title) });
    const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("hex"), APP_ORIGIN: "http://cineflix.test" });
    const app = express();
    app.locals.authConfig = config;
    app.use(express.json(), cookieParser());
    app.use("/api/auth", createAuthRouter());
    app.use("/api/movie-night", registerMovieNightRoutes({ router: express.Router(),
        controllers: createMovieNightControllers({ sessionService: service }), requireAuth, protectMutation }));
    app.use(errorHandler);
    const a = request.agent(app), b = request.agent(app);
    const account = email => ({ name: "Session Viewer", email, password: "safe session password phrase" });
    const alice = await a.post("/api/auth/register").set("Origin", config.origin).send(account("alice@example.test")).expect(201);
    await b.post("/api/auth/register").set("Origin", config.origin).send(account("bob@example.test")).expect(201);
    const session = await a.post("/api/movie-night/sessions").set("Origin", config.origin)
        .send({ selectedIds: ["movie-001", "movie-002", "movie-003"], voterCount: 2 }).expect(201);
    const id = session.body._id;
    assert.equal(session.body.hostUser, alice.body.user.id);
    assert.equal((await Session.findById(id).lean()).hostUser.toString(), alice.body.user.id);
    const resource = "/api/movie-night/sessions/" + id;
    await request(app).get(resource).expect(401);
    await a.get(resource).expect(200);
    assert.deepEqual((await b.get("/api/movie-night/sessions").expect(200)).body, { sessions: [] });
    await b.get(resource).expect(404);
    await b.get(resource + "/results").expect(404);
    await b.post(resource + "/votes").set("Origin", config.origin).set("X-Movie-Night-Revision", "0")
        .send({ itemId: "movie-001", userId: alice.body.user.id }).expect(404);
    await b.post(resource + "/reset").set("Origin", config.origin).set("X-Movie-Night-Revision", "0").expect(404);
    await b.delete(resource).set("Origin", config.origin).expect(404);
    await a.post(resource + "/votes").set("Origin", "https://evil.test").set("X-Movie-Night-Revision", "0")
        .send({ itemId: "movie-001" }).expect(403);
    assert.equal((await Session.findById(id).lean()).votes.length, 0);
    await a.post(resource + "/votes").set("Origin", config.origin).set("X-Movie-Night-Revision", "0")
        .send({ itemId: "movie-001" }).expect(200);
    assert.equal((await Session.findById(id).lean()).votes.length, 1);
    await a.delete(resource).set("Origin", config.origin).expect(204);
    assert.equal(await Session.countDocuments(), 0);
});
