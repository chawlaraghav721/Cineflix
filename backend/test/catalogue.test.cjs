"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { createApp } = require("../src/app");
const { connectDatabase, disconnectDatabase, getDatabaseStatus } = require("../src/config/db");
const Title = require("../src/models/Title");
const { seedCatalogue } = require("../src/scripts/seedCatalogue");

let mongo;
const app = createApp();

test("backend API integration", { concurrency: false }, async t => {
    await t.before(async () => {
        mongo = await MongoMemoryServer.create();
        await connectDatabase(mongo.getUri());
        await Title.init();
    });
    await t.after(async () => {
        await disconnectDatabase();
        if (mongo) await mongo.stop();
    });

    await t.test("connection module connects once and reports status", async () => {
        assert.equal(getDatabaseStatus(), "connected");
        const [first, second] = await Promise.all([connectDatabase(mongo.getUri()), connectDatabase(mongo.getUri())]);
        assert.equal(first, second);
        assert.equal(await connectDatabase(""), mongoose.connection);
    });

    await t.test("health endpoint and static-file boundaries", async () => {
        const health = await request(app).get("/api/health").expect(200);
        assert.equal(health.body.status, "ok");
        assert.equal(health.body.database, "connected");
        await request(app).get("/").expect(200);
        await request(app).get("/backend/.env").expect(404);
        await request(app).get("/.git/config").expect(404);
        await request(app).get("/backend/src/server.js").expect(404);
        await request(app).get("/node_modules/express/package.json").expect(404);
    });

    await t.test("API misses and malformed JSON use the shared error response", async () => {
        const missing = await request(app).get("/api/not-a-route").expect(404);
        assert.equal(missing.body.error.code, "NOT_FOUND");
        const malformed = await request(app).post("/api/titles").set("Content-Type", "application/json").send('{"title":').expect(400);
        assert.equal(malformed.body.error.code, "INVALID_JSON");
        assert.equal(typeof malformed.body.error.message, "string");
    });

    await t.test("seeding twice upserts the same 30 stable catalogue IDs", async () => {
        const first = await seedCatalogue();
        const second = await seedCatalogue();
        assert.equal(first.upsertedCount, 30);
        assert.equal(await Title.countDocuments(), 30);
        assert.equal(second.upsertedCount, 0);
        assert.equal(await Title.countDocuments(), 30);
    });

    await t.test("catalogue response preserves the legacy movies and shows shape", async () => {
        const response = await request(app).get("/api/catalogue").expect(200);
        assert.deepEqual(Object.keys(response.body), ["movies", "shows"]);
        assert.equal(response.body.movies.length, 20);
        assert.equal(response.body.shows.length, 10);
        assert.equal(response.body.movies[0].id, "movie-001");
        assert.equal(response.body.shows[0].id, "show-001");
        assert(!Object.hasOwn(response.body.movies[0], "_id"));
        assert.equal(response.body.movies.find(item => item.id === "movie-004").duration, "2h 08m");
    });

    await t.test("single-title lookup uses the stable public ID", async () => {
        const found = await request(app).get("/api/titles/movie-012").expect(200);
        assert.equal(found.body.id, "movie-012");
        assert.equal(found.body.title, "Interstellar");
        await request(app).get("/api/titles/missing-title").expect(404).expect(({ body }) => {
            assert.equal(body.error.code, "TITLE_NOT_FOUND");
        });
    });

    await t.test("search, type and complete genre-label filters combine", async () => {
        const search = await request(app).get("/api/titles?type=movie&q=interstellar").expect(200);
        assert.equal(search.body.total, 1);
        assert.equal(search.body.items[0].id, "movie-012");
        const genre = await request(app).get("/api/titles?genre=Thriller").expect(200);
        assert(genre.body.items.some(item => item.id === "movie-004"));
        assert(!genre.body.items.some(item => item.id === "movie-004" && item.genre !== "Action / Thriller"));
        const literal = await request(app).get("/api/titles?q=.*").expect(200);
        assert.equal(literal.body.total, 0);
        const noResults = await request(app).get("/api/titles?q=not-a-real-title").expect(200);
        assert.deepEqual(noResults.body.items, []);
        assert.equal(noResults.body.total, 0);
    });

    await t.test("sorting and pagination return deterministic metadata", async () => {
        const asc = await request(app).get("/api/titles?type=movie&sort=title_asc&page=1&limit=2").expect(200);
        assert.deepEqual(asc.body.items.map(item => item.title), ["Avatar", "Avengers: Endgame"]);
        assert.equal(asc.body.total, 20);
        assert.equal(asc.body.page, 1);
        assert.equal(asc.body.limit, 2);
        const next = await request(app).get("/api/titles?type=movie&sort=title_desc&page=2&limit=2").expect(200);
        assert.equal(next.body.items.length, 2);
        assert(next.body.items[0].title.localeCompare(next.body.items[1].title) >= 0);
        const years = await request(app).get("/api/titles?type=show&sort=year_desc&limit=1").expect(200);
        assert.equal(years.body.items[0].year, 2026);
        await Title.create({ id: "yearless-test", type: "show", title: "Yearless Test", genre: "Drama", poster: "/poster.svg", description: "" });
        try {
            const ascending = await request(app).get("/api/titles?type=show&sort=year_asc&limit=50").expect(200);
            assert.equal(ascending.body.items.at(-1).id, "yearless-test");
        } finally {
            await Title.deleteOne({ id: "yearless-test" });
        }
    });

    await t.test("invalid queries are rejected with consistent JSON errors", async () => {
        for (const query of ["type=film", "page=0", "page=1.5", "limit=51", "sort=unknown", "q=a&q=b", "extra=value"]) {
            const response = await request(app).get("/api/titles?" + query).expect(400);
            assert.equal(response.body.error.code, "INVALID_QUERY");
        }
    });

    await t.test("duplicate stable IDs are rejected by the unique index", async () => {
        const item = await Title.findOne({ id: "movie-001" }).lean();
        await assert.rejects(Title.create(item), error => error && error.code === 11000);
    });

    await t.test("admin mutations remain unavailable until real auth middleware is integrated", async () => {
        await request(app).post("/api/titles").send({}).expect(404);
        await request(app).patch("/api/titles/movie-001").send({ title: "Changed" }).expect(404);
        await request(app).delete("/api/titles/movie-001").expect(404);
    });
});
