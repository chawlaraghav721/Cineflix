"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { integrationFixture, configuration } = require("../test-support/movieNightIntegration.cjs");
const { startBackendProcess } = require("../test-support/movieNightServerProcess.cjs");

test("MongoDB sequential concurrency across two real shared-server processes", { timeout: 90000 }, async t => {
    const f = await integrationFixture(t);
    const servers = [];
    t.after(async () => { await Promise.all(servers.map(s => s.close())); });
    for (let i = 0; i < 2; i++) servers.push(await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret }));
    const a = await f.account();
    const create = async () => (await f.post(a.agent, "/api/movie-night/sessions", { ...configuration, voterCount: 2 }).expect(201)).body;
    const mutate = (server, id, action, revision) => request(server.origin).post(`/api/movie-night/sessions/${id}/${action}`)
        .set("Origin", server.origin).set("Cookie", a.cookie).set("X-Movie-Night-Revision", String(revision))
        .send(action === "votes" ? { itemId: configuration.selectedIds[0] } : {});
    await t.test("competing duplicate turns accept one write across separate connection pools", async () => {
        const s = await create();
        const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => mutate(servers[i % 2], s._id, "votes", 0)));
        assert.equal(responses.filter(r => r.status === 200).length, 1);
        assert.equal(responses.filter(r => r.status === 409).length, 9);
        const stored = await f.Session.findById(s._id).lean(); assert.equal(stored.revision, 1); assert.equal(stored.votes.length, 1);
    });
    await t.test("last-slot competition writes completion without exceeding capacity", async () => {
        const s = await create(); await mutate(servers[0], s._id, "votes", 0).expect(200);
        const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => mutate(servers[i % 2], s._id, "votes", 1)));
        assert.equal(responses.filter(r => r.status === 200).length, 1);
        const stored = await f.Session.findById(s._id).lean();
        assert.equal(stored.revision, 2); assert.equal(stored.votes.length, 2); assert.equal(stored.status, "complete");
    });
    await t.test("reset/vote races advance once and pre-reset requests remain stale", async () => {
        for (let i = 0; i < 6; i++) {
            const s = await create();
            const responses = await Promise.all([mutate(servers[0], s._id, "reset", 0), mutate(servers[1], s._id, "votes", 0)]);
            assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
            const stored = await f.Session.findById(s._id).lean(); assert.equal(stored.revision, 1);
            assert(stored.votes.length <= 1);
            await mutate(servers[0], s._id, "votes", 0).expect(409);
        }
    });
    await t.test("session state survives a real backend restart", async () => {
        const s = await create(); await mutate(servers[0], s._id, "votes", 0).expect(200);
        const port = servers[0].port; await servers[0].close();
        servers[0] = await startBackendProcess({ mongoUri: f.mongo.getUri(), secret: f.config.secret, port });
        const response = await request(servers[0].origin).get(`/api/movie-night/sessions/${s._id}`).set("Cookie", a.cookie).expect(200);
        assert.equal(response.body.revision, 1); assert.deepEqual(response.body.votes, [configuration.selectedIds[0]]);
    });
});
