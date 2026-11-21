"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { createApp } = require("../src/app");
const { integrationFixture, configuration } = require("./helpers/movieNightIntegration.cjs");

test("Movie Night on the shared app, real cookie authentication and isolated MongoDB", async t => {
    const f = await integrationFixture(t);
    const a = await f.account(), b = await f.account();
    let session;
    await t.test("creates and lists a persisted host-owned session with stable catalogue IDs", async () => {
        session = (await f.post(a.agent, "/api/movie-night/sessions", { ...configuration, hostUser: b.user.id }).expect(201)).body;
        assert.equal(session.hostUser, a.user.id); assert.equal(session.revision, 0);
        const stored = await f.Session.findById(session._id).lean();
        assert.deepEqual(stored.selectedIds, configuration.selectedIds);
        assert(stored.createdAt instanceof Date); assert(stored.updatedAt instanceof Date);
        assert.equal((await a.agent.get("/api/movie-night/sessions").expect(200)).body.sessions.length, 1);
        assert.deepEqual((await b.agent.get("/api/movie-night/sessions").expect(200)).body.sessions, []);
    });
    await t.test("rejects unauthenticated, malformed and expired cookies without exposing sessions", async () => {
        const endpoint = "/api/movie-night/sessions/" + session._id;
        await request(f.app).get(endpoint).expect(401);
        await request(f.app).get(endpoint).set("Cookie", "cineflix_session=invalid").expect(401);
        const expired = jwt.sign({ sub: a.user.id }, f.config.secret,
            { algorithm: "HS256", issuer: f.config.issuer, audience: f.config.audience, expiresIn: -10 });
        await request(f.app).get(endpoint).set("Cookie", "cineflix_session=" + expired).expect(401);
    });
    await t.test("foreign accounts cannot read, vote, reset or delete the host session", async () => {
        const endpoint = "/api/movie-night/sessions/" + session._id;
        await b.agent.get(endpoint).expect(404); await b.agent.get(endpoint + "/results").expect(404);
        await f.post(b.agent, endpoint + "/votes", { itemId: configuration.selectedIds[0], userId: a.user.id }, 0).expect(404);
        await f.post(b.agent, endpoint + "/reset", undefined, 0).expect(404);
        await b.agent.delete(endpoint).set("Origin", f.config.origin).expect(404);
    });
    await t.test("existing Origin protection rejects mutations without a matching origin", async () => {
        const endpoint = "/api/movie-night/sessions/" + session._id + "/votes";
        for (const origin of [undefined, "https://foreign.test"]) {
            const req = a.agent.post(endpoint).set("X-Movie-Night-Revision", "0");
            if (origin) req.set("Origin", origin);
            await req.send({ itemId: configuration.selectedIds[0] }).expect(403);
        }
        assert.equal((await f.Session.findById(session._id)).votes.length, 0);
    });
    await t.test("valid votes persist and a fresh app calculates final ties from stored state", async () => {
        const endpoint = "/api/movie-night/sessions/" + session._id;
        for (let revision = 0; revision < 4; revision++) {
            session = (await f.post(a.agent, endpoint + "/votes", { itemId: configuration.selectedIds[revision % 2] }, revision).expect(200)).body;
        }
        assert.equal(session.status, "complete");
        const reopened = createApp({ authConfig: f.config });
        const results = (await request(reopened).get(endpoint + "/results").set("Cookie", a.cookie).expect(200)).body;
        assert.equal(results.complete, true); assert.equal(results.isTie, true);
        assert.deepEqual(results.winners, configuration.selectedIds.slice(0, 2));
        await f.post(a.agent, endpoint + "/votes", { itemId: configuration.selectedIds[0] }, 0).expect(409);
        await f.post(a.agent, endpoint + "/votes", { itemId: configuration.selectedIds[0] }, 4).expect(409);
    });
    await t.test("reset advances revision and deletion removes only the owned record", async () => {
        const endpoint = "/api/movie-night/sessions/" + session._id;
        const reset = (await f.post(a.agent, endpoint + "/reset", undefined, 4).expect(200)).body;
        assert.equal(reset.revision, 5); assert.deepEqual(reset.votes, []); assert.deepEqual(reset.selectedIds, configuration.selectedIds);
        await f.post(a.agent, endpoint + "/votes", { itemId: configuration.selectedIds[0] }, 0).expect(409);
        await a.agent.delete(endpoint).set("Origin", f.config.origin).expect(204);
        assert.equal(await f.Session.findById(session._id), null);
    });
    await t.test("invalid movie selection/count and malformed JSON retain shared error conventions", async () => {
        for (const body of [{ ...configuration, selectedIds: ["show-001", "movie-011", "movie-012"] },
            { ...configuration, selectedIds: ["movie-011", "movie-011", "movie-012"] }, { ...configuration, voterCount: 11 }]) {
            const response = await f.post(a.agent, "/api/movie-night/sessions", body).expect(400);
            assert.equal(typeof response.body.error.code, "string");
        }
        const response = await a.agent.post("/api/movie-night/sessions").set("Origin", f.config.origin)
            .set("Content-Type", "application/json").send("{invalid").expect(400);
        assert.equal(response.body.error.code, "INVALID_JSON");
        await request(f.app).get("/api/catalogue").expect(200);
    });
});
