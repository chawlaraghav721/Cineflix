"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../src/app");
const { loadAuthConfig } = require("../src/config/auth");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");
const Watchlist = require("../src/models/Watchlist");
const Title = require("../src/models/Title");
const config = loadAuthConfig({ JWT_SECRET: "watchlist-isolated-tests-secret-1234567890", APP_ORIGIN: "http://localhost:3000" });
let app, a, b, userA, userB;
const call = (method, path = "", cookie = a) => request(app)[method]("/api/my-list" + path).set("Cookie", cookie).set("Origin", config.origin);

test("watchlist HTTP API with verified cookies and disposable MongoDB", async t => {
    const mongo = await MongoMemoryServer.create();
    t.after(async () => { await disconnectDatabase(); await mongo.stop(); });
    await connectDatabase(mongo.getUri());
    await Watchlist.init();
    app = createApp({ authConfig: config });
    async function register(name) {
        const res = await request(app).post("/api/auth/register").set("Origin", config.origin)
            .send({ name, email: name + "@example.test", password: "watchlist test password" }).expect(201);
        return [res.headers["set-cookie"][0].split(";")[0], res.body.user.id];
    }
    [a, userA] = await register("ViewerA"); [b, userB] = await register("ViewerB");
    await Title.create([{ id: "movie-004", type: "movie", title: "Movie", genre: "Drama", poster: "poster.svg" },
        { id: "show-001", type: "show", title: "Show", genre: "Drama", poster: "poster.svg" }]);

    await t.test("GET requires authentication and returns only the current user's entries", async () => {
        await request(app).get("/api/my-list").expect(401);
        assert.deepEqual((await call("get").expect(200)).body, { items: [] });
        await Watchlist.create({ user: userB, itemId: "show-001" });
        assert.deepEqual((await call("get").expect(200)).body, { items: [] });
        const response = await call("get", "", b).expect(200);
        assert.equal(response.body.items[0].itemId, "show-001");
        assert.deepEqual(Object.keys(response.body.items[0]).sort(), ["addedAt", "itemId", "status", "updatedAt"]);
        assert.equal(response.headers["cache-control"], "no-store");
    });
    await t.test("POST persists movie/show defaults, rejects duplicates and invalid input", async () => {
        const created = await call("post").send({ itemId: "movie-004" }).expect(201);
        assert.equal(created.body.status, "want-to-watch");
        assert(created.body.addedAt && created.body.updatedAt);
        await call("post").send({ itemId: "show-001", status: "watching" }).expect(201);
        await call("post").send({ itemId: "movie-004" }).expect(409);
        await call("post").send({ itemId: "missing" }).expect(404);
        for (const body of [null, [], {}, { itemId: { $ne: null } }, { itemId: "movie-004", status: "bad" },
            { itemId: "movie-004", userId: userB }, { itemId: "movie-004", user: userB }]) {
            const result = await call("post").send(body).expect(400);
            assert(result.body.error.code);
        }
        assert.equal(await Watchlist.countDocuments({ user: userA }), 2);
    });
});
