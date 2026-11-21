"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { createApp } = require("../src/app");
const { loadAuthConfig } = require("../src/config/auth");
const { connectDatabase, disconnectDatabase } = require("../src/config/db");
const User = require("../src/models/User");
const { requireAuth } = require("../src/middleware/requireAuth");
const { requireAdmin } = require("../src/middleware/requireAdmin");
const { protectMutation } = require("../src/middleware/protectMutation");
const { verifyPassword } = require("../src/services/passwords");

const config = loadAuthConfig({ JWT_SECRET: randomBytes(48).toString("hex"), APP_ORIGIN: "http://localhost:3000" });
const password = "a correct horse battery staple";
let serial = 0;
const credentials = overrides => ({ name: "Test Viewer", email: `auth-${++serial}@example.test`, password, ...overrides });
const app = () => createApp({ authConfig: config });
const post = (server, endpoint, body) => request(server).post("/api/auth/" + endpoint).set("Origin", config.origin).send(body);
const register = (server, body = credentials()) => post(server, "register", body);
const cookie = response => response.headers["set-cookie"][0].split(";")[0];

test("authentication with real HTTP handlers and isolated MongoDB", { concurrency: false }, async t => {
    let mongo;
    t.before(async () => {
        mongo = await MongoMemoryServer.create();
        await connectDatabase(mongo.getUri());
        await User.createIndexes();
    });
    t.after(async () => { await disconnectDatabase(); if (mongo) await mongo.stop(); });

    await t.test("registration rejects invalid fields and privilege/ownership injection", async () => {
        const server = app();
        const valid = credentials();
        for (const body of [null, [], {}, { ...valid, name: " " }, { ...valid, name: "x".repeat(81) },
            { ...valid, email: "invalid" }, { ...valid, email: { $ne: null } },
            { ...valid, password: "short" }, { ...valid, password: "x".repeat(129) },
            { ...valid, password: 123456789012 }, { ...valid, role: "admin" },
            { ...valid, userId: new mongoose.Types.ObjectId().toString() }]) {
            const response = await post(server, "register", body).expect(400);
            assert.equal(typeof response.body.error.code, "string");
            assert.equal(response.headers["set-cookie"], undefined);
        }
        assert.equal(await User.countDocuments({ email: valid.email }), 0);
    });

    await t.test("registration normalizes email, hashes passwords and returns a safe cookie/user", async () => {
        const server = app();
        const body = credentials({ name: "  Viewer One  ", email: "  Viewer.One@Example.Test  " });
        const response = await register(server, body).expect(201);
        assert.deepEqual(Object.keys(response.body), ["user"]);
        assert.deepEqual(Object.keys(response.body.user).sort(), ["email", "id", "name", "role"]);
        assert.equal(response.body.user.email, "viewer.one@example.test");
        assert.equal(response.body.user.name, "Viewer One");
        assert.equal(response.body.user.role, "user");
        assert.equal(response.headers["cache-control"], "no-store");
        const header = response.headers["set-cookie"][0];
        assert.match(header, /HttpOnly/);
        assert.match(header, /SameSite=Strict/);
        assert.match(header, /Path=\//);
        assert.match(header, /Max-Age=3600/);
        assert(!header.includes("Secure"));
        const user = await User.findById(response.body.user.id);
        assert.equal(user.passwordHash, undefined);
        const stored = await User.findById(user.id).select("+passwordHash");
        assert(stored.createdAt instanceof Date);
        assert(stored.updatedAt instanceof Date);
        assert.notEqual(stored.passwordHash, password);
        assert(await verifyPassword(password, stored.passwordHash));
        assert(!JSON.stringify(stored).includes(stored.passwordHash));
        assert(!JSON.stringify(response.body).includes(password));
        const second = await register(server).expect(201);
        const other = await User.findById(second.body.user.id).select("+passwordHash");
        assert.notEqual(stored.passwordHash, other.passwordHash);
        await post(server, "register", { ...body, email: "VIEWER.ONE@example.test" }).expect(409);
    });

    await t.test("simultaneous duplicate registration is enforced by the real unique index", async () => {
        const server = app();
        const body = credentials();
        const results = await Promise.all([register(server, body), register(server, body)]);
        assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
        assert.equal(await User.countDocuments({ email: body.email }), 1);
    });

    await t.test("login/me/logout use real cookies and preserve account separation", async () => {
        const server = app();
        const one = credentials();
        const two = credentials();
        const agentA = request.agent(server);
        const agentB = request.agent(server);
        const a = await agentA.post("/api/auth/register").set("Origin", config.origin).send(one).expect(201);
        const b = await agentB.post("/api/auth/register").set("Origin", config.origin).send(two).expect(201);
        assert.notEqual(a.body.user.id, b.body.user.id);
        assert.equal((await agentA.get("/api/auth/me").expect(200)).body.user.id, a.body.user.id);
        assert.equal((await agentB.get("/api/auth/me").expect(200)).body.user.id, b.body.user.id);
        await request(server).get("/api/auth/me").expect(401);
        const wrong = await post(server, "login", { email: one.email, password: "wrong password" }).expect(401);
        const absent = await post(server, "login", { email: "absent@example.test", password }).expect(401);
        assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS");
        assert.match(wrong.body.error.message, /incorrect/i);
        assert.equal(absent.body.error.code, "USER_NOT_FOUND");
        assert.equal(absent.body.error.message, "User does not exist. Create an account to get started.");
        assert.equal(absent.headers["set-cookie"], undefined);
        assert.equal(wrong.headers["set-cookie"], undefined);
        const savedCookie = cookie(a);
        const logout = await agentA.post("/api/auth/logout").set("Origin", config.origin).expect(200);
        assert.deepEqual(logout.body, { message: "Signed out" });
        assert.match(logout.headers["set-cookie"][0], /Expires=Thu, 01 Jan 1970/);
        assert.match(logout.headers["set-cookie"][0], /SameSite=Strict/);
        await agentA.get("/api/auth/me").expect(401);
        await agentB.get("/api/auth/me").expect(200);
        await agentA.post("/api/auth/login").set("Origin", config.origin).send({ email: one.email.toUpperCase(), password }).expect(200);
        await agentA.get("/api/auth/me").expect(200);
        // Stateless logout clears the browser cookie; copied tokens remain valid until expiry.
        await request(server).get("/api/auth/me").set("Cookie", savedCookie).expect(200);
        await post(server, "logout").expect(200);
    });

    await t.test("signed JWTs require expiry, valid signatures, algorithm, issuer, audience and real users", async () => {
        const server = app();
        const response = await register(server).expect(201);
        const subject = response.body.user.id;
        const sign = (options, payload = {}) => jwt.sign(payload, config.secret, {
            algorithm: "HS256", subject, issuer: config.issuer, audience: config.audience, expiresIn: 3600, ...options
        });
        const bad = [sign({ expiresIn: -1 }), sign({ algorithm: "HS384" }), sign({ issuer: "other" }),
            sign({ audience: "other" }), sign({ subject: "not-an-object-id" }), sign({ expiresIn: 7200 }),
            sign({ noTimestamp: true }), sign({}, { nbf: Math.floor(Date.now() / 1000) + 1000 }),
            jwt.sign({ sub: subject, iss: config.issuer, aud: config.audience }, config.secret),
            sign({ subject: new mongoose.Types.ObjectId().toString() }), "bad-token"];
        const original = cookie(response).split("=")[1];
        bad.push(original.slice(0, -4) + "abcd");
        for (const token of bad) await request(server).get("/api/auth/me").set("Cookie", `${config.cookieName}=${token}`).expect(401);
        await User.deleteOne({ _id: subject });
        await request(server).get("/api/auth/me").set("Cookie", cookie(response)).expect(401);
    });

    await t.test("verified request identity ignores client IDs and uses the current database role", async () => {
        const server = app();
        server.get("/test-auth/context", requireAuth, (req, res) => res.json(req.user));
        server.post("/test-auth/admin", requireAuth, protectMutation, requireAdmin, (req, res) => res.json({ allowed: true }));
        const a = await register(server).expect(201);
        const b = await register(server).expect(201);
        const scope = await request(server).get("/test-auth/context?userId=" + b.body.user.id).set("Cookie", cookie(a)).expect(200);
        assert.deepEqual(scope.body, { id: a.body.user.id, email: a.body.user.email, role: "user" });
        await request(server).get("/test-auth/context").set("Authorization", "Bearer arbitrary-user").expect(401);
        await request(server).post("/test-auth/admin").set("Origin", config.origin).expect(401);
        await request(server).post("/test-auth/admin").set("Origin", config.origin).set("Cookie", cookie(a)).expect(403);
        await User.updateOne({ _id: a.body.user.id }, { $set: { role: "admin" } });
        await request(server).post("/test-auth/admin").set("Origin", config.origin).set("Cookie", cookie(a)).expect(200);
        await User.updateOne({ _id: a.body.user.id }, { $set: { role: "user" } });
        await request(server).post("/test-auth/admin").set("Origin", config.origin).set("Cookie", cookie(a)).expect(403);
    });

    await t.test("mutations require an exact trusted Origin or Referer and reject cross-site requests", async () => {
        const server = app();
        for (const origin of [undefined, "null", "https://evil.example", config.origin + ".evil.example", "http://localhost:3001"]) {
            let call = request(server).post("/api/auth/register");
            if (origin !== undefined) call = call.set("Origin", origin);
            await call.send(credentials()).expect(403);
        }
        await post(server, "register", credentials()).set("Sec-Fetch-Site", "cross-site").expect(403);
        await request(server).post("/api/auth/register").set("Referer", config.origin + "/login.html").send(credentials()).expect(201);
        await request(server).post("/api/auth/register").set("Origin", "null").set("Referer", config.origin + "/login.html").send(credentials()).expect(403);
        await request(server).post("/api/auth/logout").expect(403);
        await request(server).get("/api/auth/logout").expect(404);
    });

    await t.test("API validation and unexpected failures keep the JSON error contract", async () => {
        const server = app();
        await request(server).post("/api/auth/register").set("Origin", config.origin).type("form").send(credentials()).expect(400);
        const malformed = await request(server).post("/api/auth/login").set("Origin", config.origin).type("json").send('{"email":').expect(400);
        assert.equal(malformed.body.error.code, "INVALID_JSON");
        const oversized = await post(server, "register", { ...credentials(), password: "x".repeat(110000) }).expect(413);
        assert.equal(oversized.body.error.code, "PAYLOAD_TOO_LARGE");
        const missing = await request(server).get("/api/auth/unknown").expect(404);
        assert.equal(missing.body.error.code, "NOT_FOUND");
        const replacement = t.mock.method(User, "findOne", () => { throw new Error("simulated database failure"); });
        const log = t.mock.method(console, "error", () => {});
        try {
            const failed = await post(server, "login", { email: "valid@example.test", password }).expect(500);
            assert.equal(failed.body.error.code, "INTERNAL_ERROR");
            assert(!JSON.stringify(failed.body).includes("simulated"));
        } finally { replacement.mock.restore(); log.mock.restore(); }
    });

    await t.test("production cookies are Secure and account persistence survives a new app instance", async () => {
        const secureConfig = loadAuthConfig({ JWT_SECRET: config.secret, NODE_ENV: "production", APP_ORIGIN: "https://cineflix.example" });
        const secureApp = createApp({ authConfig: secureConfig });
        const signed = await request(secureApp).post("/api/auth/register").set("Origin", secureConfig.origin).send(credentials()).expect(201);
        assert.match(signed.headers["set-cookie"][0], /; Secure/);
        assert.match(signed.headers["set-cookie"][0], /; HttpOnly/);
        const restarted = createApp({ authConfig: secureConfig });
        const me = await request(restarted).get("/api/auth/me").set("Cookie", cookie(signed)).expect(200);
        assert.equal(me.body.user.id, signed.body.user.id);
        const cleared = await request(restarted).post("/api/auth/logout").set("Origin", secureConfig.origin).expect(200);
        assert.match(cleared.headers["set-cookie"][0], /; Secure/);
    });

    await t.test("login and registration share a bounded per-process IP rate limit", async () => {
        const server = app();
        for (let index = 0; index < 20; index++) await post(server, index % 2 ? "register" : "login", {}).expect(400);
        const limited = await post(server, "login", {}).expect(429);
        assert.equal(limited.body.error.code, "TOO_MANY_ATTEMPTS");
        assert(limited.headers["retry-after"]);
        await post(server, "logout").expect(200);
    });
});

test("configuration fails closed without private secrets or a valid production origin", () => {
    for (const secret of [undefined, "", "short", " ".repeat(40), "replace-me-".repeat(5)]) assert.throws(() => loadAuthConfig({ JWT_SECRET: secret }), /JWT_SECRET/);
    for (const origin of ["", "null", "http://example.test", "https://example.test/path", "https://user:password@example.test", "https://example.test?q=1"]) {
        assert.throws(() => loadAuthConfig({ JWT_SECRET: config.secret, NODE_ENV: "production", APP_ORIGIN: origin }), /APP_ORIGIN/);
    }
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../src/server.js")], {
        env: { ...process.env, JWT_SECRET: "", MONGODB_URI: "mongodb://127.0.0.1:1/unreachable" }, encoding: "utf8", timeout: 5000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /JWT_SECRET/);
    assert(!result.stderr.includes("127.0.0.1"));
});
