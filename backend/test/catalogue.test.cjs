"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { startServer } = require("../src/server");
const { connectDatabase, disconnectDatabase, getDatabaseStatus } = require("../src/config/db");
const Title = require("../src/models/Title");
const User = require("../src/models/User");
const Rating = require("../src/models/Rating");
const Watchlist = require("../src/models/Watchlist");
const { createMovieNightSessionModel } = require("../src/models/MovieNightSession.cjs");
const dotenv = require("dotenv");
const originalDotenvConfig = dotenv.config;
let seedEnvPath;
dotenv.config = options => {
    seedEnvPath = options.path;
    return originalDotenvConfig(options);
};
const { seedCatalogue } = require("../src/scripts/seedCatalogue");
dotenv.config = originalDotenvConfig;
const { loadAuthConfig } = require("../src/config/auth");

const config = loadAuthConfig({ JWT_SECRET: "catalogue-test-secret-not-for-production-12345", APP_ORIGIN: "http://localhost:3000" });
const password = "a correct horse battery staple";
let mongo;
let server;
let accountSerial = 0;
let adminUserId;
const account = name => ({ name, email: `catalogue-${++accountSerial}@example.test`, password });
const newTitle = overrides => ({
    id: "movie-admin-created",
    type: "movie",
    title: "Admin Created Movie",
    genre: "Drama",
    poster: "/images/cineflix-logo.png",
    description: "A catalogue entry created for API verification.",
    year: 2025,
    rating: 7.5,
    cast: ["Test Actor"],
    director: "Test Director",
    duration: "1h 45m",
    trailerUrl: "https://www.youtube.com/embed/example",
    ...overrides
});

test("catalogue API integration and admin CRUD", { concurrency: false }, async t => {
    let admin;
    let normalUser;

    await t.before(async () => {
        mongo = await MongoMemoryServer.create();
        // Insert through the native collection before the server starts. Startup must
        // create the unique index without dropping or rewriting an existing record.
        await connectDatabase(mongo.getUri());
        await mongoose.connection.collection("titles").insertOne({
            id: "movie-startup-preserved", type: "movie", title: "Startup Preserved",
            genre: "Drama", poster: "/poster.svg", description: ""
        });
        await disconnectDatabase();
        server = await startServer({ mongoUri: mongo.getUri(), authConfig: config, port: 0 });
    });
    await t.after(async () => {
        if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await disconnectDatabase();
        if (mongo) await mongo.stop();
    });

    await t.test("seed script loads backend/.env relative to its own file", () => {
        assert.equal(seedEnvPath, path.resolve(__dirname, "../.env"));
    });

    await t.test("startup creates the unique stable-ID index and preserves existing data", async () => {
        assert.equal(getDatabaseStatus(), "connected");
        const indexes = await Title.collection.indexes();
        const stableIdIndex = indexes.find(index => index.name === "unique_catalogue_id");
        assert(stableIdIndex);
        assert.equal(stableIdIndex.unique, true);
        const preserved = await Title.findOne({ id: "movie-startup-preserved" }).lean();
        assert.equal(preserved.title, "Startup Preserved");
        await assert.rejects(
            Title.create({ id: "movie-startup-preserved", type: "movie", title: "Duplicate", genre: "Drama", poster: "/poster.svg" }),
            error => error && error.code === 11000
        );
        assert.equal(await Title.countDocuments({ id: "movie-startup-preserved" }), 1);
        await Title.deleteOne({ id: "movie-startup-preserved" });
        const [first, second] = await Promise.all([connectDatabase(mongo.getUri()), connectDatabase(mongo.getUri())]);
        assert.equal(first, second);
        assert.equal(await connectDatabase(""), mongoose.connection);
    });

    await t.test("health endpoint and static-file boundaries", async () => {
        const health = await request(server).get("/api/health").expect(200);
        assert.equal(health.body.status, "ok");
        assert.equal(health.body.database, "connected");
        await request(server).get("/").expect(200);
        await request(server).get("/backend/.env").expect(404);
        await request(server).get("/.git/config").expect(404);
        await request(server).get("/backend/src/server.js").expect(404);
        await request(server).get("/node_modules/express/package.json").expect(404);
    });

    await t.test("API misses and malformed JSON use the shared error response", async () => {
        const missing = await request(server).get("/api/not-a-route").expect(404);
        assert.equal(missing.body.error.code, "NOT_FOUND");
        const malformed = await request(server).post("/api/titles").set("Content-Type", "application/json").send('{"title":').expect(400);
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
        const response = await request(server).get("/api/catalogue").expect(200);
        assert.deepEqual(Object.keys(response.body), ["movies", "shows"]);
        assert.equal(response.body.movies.length, 20);
        assert.equal(response.body.shows.length, 10);
        assert.equal(response.body.movies[0].id, "movie-001");
        assert.equal(response.body.shows[0].id, "show-001");
        assert(!Object.hasOwn(response.body.movies[0], "_id"));
        assert.equal(response.body.movies.find(item => item.id === "movie-004").duration, "2h 08m");
    });

    await t.test("single-title lookup uses the stable public ID", async () => {
        const found = await request(server).get("/api/titles/movie-012").expect(200);
        assert.equal(found.body.id, "movie-012");
        assert.equal(found.body.title, "Interstellar");
        await request(server).get("/api/titles/missing-title").expect(404).expect(({ body }) => {
            assert.equal(body.error.code, "TITLE_NOT_FOUND");
        });
        await request(server).get("/api/titles/%20").expect(400).expect(({ body }) => {
            assert.equal(body.error.code, "INVALID_ITEM_ID");
        });
    });

    await t.test("search, type and complete genre-label filters combine", async () => {
        const search = await request(server).get("/api/titles?type=movie&q=interstellar").expect(200);
        assert.equal(search.body.total, 1);
        assert.equal(search.body.items[0].id, "movie-012");
        const genre = await request(server).get("/api/titles?genre=Thriller").expect(200);
        assert(genre.body.items.some(item => item.id === "movie-004"));
        assert(!genre.body.items.some(item => item.id === "movie-004" && item.genre !== "Action / Thriller"));
        const literal = await request(server).get("/api/titles?q=.*").expect(200);
        assert.equal(literal.body.total, 0);
        const noResults = await request(server).get("/api/titles?q=not-a-real-title").expect(200);
        assert.deepEqual(noResults.body.items, []);
        assert.equal(noResults.body.total, 0);
    });

    await t.test("sorting and pagination return deterministic metadata", async () => {
        const asc = await request(server).get("/api/titles?type=movie&sort=title_asc&page=1&limit=2").expect(200);
        assert.deepEqual(asc.body.items.map(item => item.title), ["Avatar", "Avengers: Endgame"]);
        assert.equal(asc.body.total, 20);
        assert.equal(asc.body.page, 1);
        assert.equal(asc.body.limit, 2);
        const next = await request(server).get("/api/titles?type=movie&sort=title_desc&page=2&limit=2").expect(200);
        assert.equal(next.body.items.length, 2);
        assert(next.body.items[0].title.localeCompare(next.body.items[1].title) >= 0);
        const years = await request(server).get("/api/titles?type=show&sort=year_desc&limit=1").expect(200);
        assert.equal(years.body.items[0].year, 2026);
        await Title.create({ id: "show-yearless-test", type: "show", title: "Yearless Test", genre: "Drama", poster: "/poster.svg", description: "" });
        try {
            const ascending = await request(server).get("/api/titles?type=show&sort=year_asc&limit=50").expect(200);
            assert.equal(ascending.body.items.at(-1).id, "show-yearless-test");
        } finally {
            await Title.deleteOne({ id: "show-yearless-test" });
        }
    });

    await t.test("invalid queries are rejected with consistent JSON errors", async () => {
        for (const query of ["type=film", "page=0", "page=1.5", "limit=51", "sort=unknown", "q=a&q=b", "extra=value"]) {
            const response = await request(server).get("/api/titles?" + query).expect(400);
            assert.equal(response.body.error.code, "INVALID_QUERY");
        }
    });

    await t.test("real registration cookies enforce auth, origin and admin role in route order", async () => {
        for (const [method, endpoint] of [
            ["post", "/api/titles"], ["patch", "/api/titles/movie-001"], ["delete", "/api/titles/movie-001"]
        ]) {
            await request(server)[method](endpoint).set("Origin", config.origin).send({ title: "Attempt" }).expect(401);
        }

        const normalAgent = request.agent(server);
        const normalRegistration = await normalAgent.post("/api/auth/register").set("Origin", config.origin).send(account("Catalogue Viewer")).expect(201);
        normalUser = await User.findById(normalRegistration.body.user.id);
        assert.equal(normalUser.role, "user");
        await normalAgent.post("/api/titles").set("Origin", config.origin).send(newTitle()).expect(403);
        await normalAgent.post("/api/titles").set("Origin", config.origin).send({ ...newTitle(), role: "admin", userId: "forged-user" }).expect(403);
        await normalAgent.patch("/api/titles/movie-001").set("Origin", config.origin).send({ title: "Attempt" }).expect(403);
        await normalAgent.delete("/api/titles/movie-001").set("Origin", config.origin).expect(403);
        assert.equal((await User.findById(normalRegistration.body.user.id)).role, "user");

        admin = request.agent(server);
        const adminRegistration = await admin.post("/api/auth/register").set("Origin", config.origin).send(account("Catalogue Admin")).expect(201);
        adminUserId = adminRegistration.body.user.id;
        await User.updateOne({ _id: adminRegistration.body.user.id }, { $set: { role: "admin" } });
        for (const [method, endpoint] of [
            ["post", "/api/titles"], ["patch", "/api/titles/movie-001"], ["delete", "/api/titles/movie-001"]
        ]) {
            await admin[method](endpoint).set("Origin", "https://untrusted.example").send({ title: "Attempt" }).expect(403);
        }
        assert.equal((await User.findById(adminRegistration.body.user.id)).role, "admin");
    });

    await t.test("admins can create valid movies and shows; records persist without internal IDs", async () => {
        const movie = await admin.post("/api/titles").set("Origin", config.origin).send(newTitle()).expect(201);
        assert.equal(movie.body.id, "movie-admin-created");
        assert.equal(movie.body.type, "movie");
        assert(!Object.hasOwn(movie.body, "_id"));
        assert(!Object.hasOwn(movie.body, "createdAt"));
        assert.equal((await Title.findOne({ id: movie.body.id }).lean()).title, "Admin Created Movie");

        const show = await admin.post("/api/titles").set("Origin", config.origin).send(newTitle({
            id: "show-admin-created", type: "show", title: "Admin Created Show", year: 2026,
            genre: "Sci-Fi", cast: [], description: ""
        })).expect(201);
        assert.equal(show.body.id, "show-admin-created");
        assert.equal(show.body.type, "show");
        assert.deepEqual(show.body.cast, []);
        assert.equal((await Title.findOne({ id: show.body.id }).lean()).type, "show");
    });

    await t.test("create rejects missing, invalid, extra and MongoDB operator fields", async () => {
        const complete = newTitle({ id: "movie-invalid-check" });
        for (const field of ["id", "type", "title", "genre", "poster"]) {
            const missing = { ...complete };
            delete missing[field];
            const response = await admin.post("/api/titles").set("Origin", config.origin).send(missing).expect(400);
            assert.equal(response.body.error.code, "INVALID_TITLE");
        }
        const invalidBodies = [
            { ...complete, id: "show-invalid-prefix" },
            { ...complete, type: "film" },
            { ...complete, title: 42 },
            { ...complete, year: "2025" },
            { ...complete, year: 2025.5 },
            { ...complete, rating: 11 },
            { ...complete, cast: ["Actor", { $ne: "" }] },
            { ...complete, poster: "javascript:alert(1)" },
            { ...complete, trailerUrl: "data:text/html,unsafe" },
            { ...complete, unknown: "unexpected" },
            { ...complete, $set: { title: "injected" } },
            { ...complete, "title.$ne": "injected" },
            { ...complete, title: "T".repeat(201) }
        ];
        for (const body of invalidBodies) {
            const response = await admin.post("/api/titles").set("Origin", config.origin).send(body).expect(400);
            assert.equal(response.body.error.code, "INVALID_TITLE");
        }
        const duplicate = await admin.post("/api/titles").set("Origin", config.origin).send(newTitle({ id: "movie-001" })).expect(409);
        assert.equal(duplicate.body.error.code, "DUPLICATE_TITLE_ID");
        assert.deepEqual(Object.keys(duplicate.body.error).sort(), ["code", "message"]);
        assert(!JSON.stringify(duplicate.body).includes("MongoServerError"));
    });

    await t.test("patch applies a field allowlist and preserves omitted metadata", async () => {
        const before = await Title.findOne({ id: "movie-001" }).lean();
        const response = await admin.patch("/api/titles/movie-001").set("Origin", config.origin).send({
            title: "Updated Catalogue Title", description: "Only provided properties change.", year: 2024, cast: ["Updated Actor"]
        }).expect(200);
        assert.equal(response.body.title, "Updated Catalogue Title");
        assert.equal(response.body.year, 2024);
        assert.equal(response.body.genre, before.genre);
        assert.equal(response.body.poster, before.poster);
        assert.equal(response.body.rating, before.rating);
        const stored = await Title.findOne({ id: "movie-001" }).lean();
        assert.equal(stored.description, "Only provided properties change.");
        assert.equal(stored.director, before.director);
        assert.equal(stored.trailerUrl, before.trailerUrl);
        assert.deepEqual(stored.cast, ["Updated Actor"]);

        for (const body of [{ id: "movie-rewritten" }, { $set: { title: "Injected" } }, { title: 100 }, { rating: -1 }, { unexpected: "x" }, {}]) {
            const invalid = await admin.patch("/api/titles/movie-001").set("Origin", config.origin).send(body).expect(400);
            assert.equal(invalid.body.error.code, "INVALID_TITLE");
        }
        await admin.patch("/api/titles/movie-001").set("Origin", config.origin).send({ type: "show" }).expect(400);
        const missing = await admin.patch("/api/titles/movie-not-present").set("Origin", config.origin).send({ title: "Missing" }).expect(404);
        assert.equal(missing.body.error.code, "TITLE_NOT_FOUND");
        await admin.patch("/api/titles/not-a-stable-id").set("Origin", config.origin).send({ title: "Invalid ID" }).expect(400);
    });

    await t.test("delete returns an empty 204 and leaves unrelated and user-owned data intact", async () => {
        const created = await admin.post("/api/titles").set("Origin", config.origin).send(newTitle({
            id: "movie-admin-delete", title: "Delete Test Title", cast: []
        })).expect(201);
        const adminUser = await User.findById(adminUserId);
        assert(adminUser);
        const MovieNightSession = createMovieNightSessionModel({ mongoose, connection: mongoose.connection });
        let movieNightSession;
        try {
            await Rating.create({ user: adminUser._id, itemId: created.body.id, score: 5, reviewText: "Keep this record." });
            await Watchlist.create({ user: adminUser._id, itemId: created.body.id, status: "watching" });
            movieNightSession = await MovieNightSession.create({
                hostUser: adminUser._id,
                selectedIds: [created.body.id, "movie-001", "movie-002"],
                voterCount: 2,
                votes: [],
                status: "voting"
            });
            assert.deepEqual(movieNightSession.selectedIds, [created.body.id, "movie-001", "movie-002"]);
            const countBeforeDelete = await Title.countDocuments();

            const response = await admin.delete("/api/titles/movie-admin-delete").set("Origin", config.origin).expect(204);
            assert.equal(response.text, "");
            assert.equal(await Title.findOne({ id: created.body.id }), null);
            assert.equal(await Title.countDocuments(), countBeforeDelete - 1);
            assert(await Title.findOne({ id: "movie-001" }));
            assert(await Rating.findOne({ user: adminUser._id, itemId: created.body.id }));
            assert(await Watchlist.findOne({ user: adminUser._id, itemId: created.body.id }));

            const retainedSession = await MovieNightSession.findById(movieNightSession._id).lean();
            assert(retainedSession);
            assert.equal(retainedSession.mode, movieNightSession.mode);
            assert.equal(String(retainedSession.hostUser), String(adminUser._id));
            assert.deepEqual(retainedSession.selectedIds, [created.body.id, "movie-001", "movie-002"]);
            assert.equal(retainedSession.voterCount, movieNightSession.voterCount);
            assert.deepEqual(retainedSession.votes, movieNightSession.votes);
            assert.equal(retainedSession.status, "voting");
            assert.equal(retainedSession.revision, movieNightSession.revision);

            const missing = await admin.delete("/api/titles/movie-admin-delete").set("Origin", config.origin).expect(404);
            assert.equal(missing.body.error.code, "TITLE_NOT_FOUND");
            await admin.delete("/api/titles/not-a-stable-id").set("Origin", config.origin).expect(400);
        } finally {
            await Promise.all([
                Rating.deleteOne({ user: adminUser._id, itemId: created.body.id }),
                Watchlist.deleteOne({ user: adminUser._id, itemId: created.body.id }),
                movieNightSession ? MovieNightSession.deleteOne({ _id: movieNightSession._id }) : Promise.resolve(),
                Title.deleteOne({ id: created.body.id })
            ]);
            assert.equal(await Rating.countDocuments({ user: adminUser._id, itemId: created.body.id }), 0);
            assert.equal(await Watchlist.countDocuments({ user: adminUser._id, itemId: created.body.id }), 0);
            assert.equal(movieNightSession ? await MovieNightSession.countDocuments({ _id: movieNightSession._id }) : 0, 0);
            assert.equal(await Title.countDocuments({ id: created.body.id }), 0);
        }
    });

    await t.test("a duplicate legacy database ID makes index creation fail without deleting data", async () => {
        const isolatedMongo = await MongoMemoryServer.create();
        const connection = await mongoose.createConnection(isolatedMongo.getUri(), { autoIndex: false }).asPromise();
        try {
            const raw = connection.collection("titles");
            const common = { id: "movie-duplicate-legacy", type: "movie", title: "Legacy", genre: "Drama", poster: "/poster.svg" };
            await raw.insertMany([{ ...common, title: "Legacy One" }, { ...common, title: "Legacy Two" }]);
            const IsolatedTitle = connection.model("IsolatedTitleIndexCheck", Title.schema, "titles");
            await assert.rejects(IsolatedTitle.createIndexes());
            assert.equal(await raw.countDocuments({ id: "movie-duplicate-legacy" }), 2);
        } finally {
            await connection.close();
            await isolatedMongo.stop();
        }
    });
});
