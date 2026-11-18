"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRatingService } = require("../src/services/ratingService.cjs");
const { createRatingControllers } = require("../src/controllers/ratingController.cjs");
const { registerRatingRoutes } = require("../src/routes/ratingRoutes.cjs");
let express;
try { express = require(process.env.CINEFLIX_EXPRESS_PATH || "express"); } catch (error) {
    if (process.env.CINEFLIX_EXPRESS_PATH || error.code !== "MODULE_NOT_FOUND") throw error;
}

test("route factory has one public read and requires auth/protection for all own writes", () => {
    const routes = [];
    const router = Object.fromEntries(["get", "put", "delete"].map(method => [method, (...args) => routes.push([method, ...args])]));
    const auth = () => {};
    const protect = () => {};
    const controllers = Object.fromEntries(["getSummary", "getOwn", "putOwn", "deleteOwn"].map(method => [method, () => {}]));
    assert.throws(() => registerRatingRoutes({ router, controllers, requireAuth: auth }));
    assert.equal(routes.length, 0);
    assert.equal(registerRatingRoutes({ router, controllers, requireAuth: auth, protectMutation: protect }), router);
    assert.deepEqual(routes, [
        ["get", "/:itemId", controllers.getSummary],
        ["get", "/:itemId/me", auth, controllers.getOwn],
        ["put", "/:itemId/me", auth, protect, controllers.putOwn],
        ["delete", "/:itemId/me", auth, protect, controllers.deleteOwn]
    ]);
});

test("controller forwards unexpected failures to shared error handler", async () => {
    const error = new Error("private database information");
    const controllers = createRatingControllers({ ratingService: Object.fromEntries(
        ["getSummary", "getOwn", "putOwn", "deleteOwn"].map(method => [method, async () => { throw error; }])) });
    let forwarded;
    await controllers.getSummary({ params: { itemId: "movie-004" } }, { set() {} }, failure => { forwarded = failure; });
    assert.equal(forwarded, error);
});

test("real Express HTTP contract with test-only identity/database fixtures", { skip: !express }, async t => {
    const rows = new Map();
    const scopeKey = scope => scope.user + scope.itemId;
    let fail = false;
    const service = createRatingService({
        titleRepository: { exists: async id => {
            if (fail) throw new Error("secret database details");
            return ["movie-004", "show-001"].includes(id);
        } },
        ratingRepository: {
            findOwn: async scope => rows.get(scopeKey(scope)) || null,
            upsertOwn: async (scope, values) => {
                const saved = { reviewText: "", ...rows.get(scopeKey(scope)), ...values };
                rows.set(scopeKey(scope), saved);
                return saved;
            },
            deleteOwn: async scope => rows.delete(scopeKey(scope)),
            summary: async itemId => {
                const all = [...rows.entries()].filter(([key]) => key.endsWith(itemId)).map(([, row]) => row);
                return { average: all.length ? all.reduce((sum, row) => sum + row.score, 0) / all.length : null,
                    count: all.length, reviews: all.filter(row => row.reviewText) };
            }
        }
    });
    const app = express();
    app.use(express.json());
    // These are NOT M2's authentication/CSRF implementation; used ONLY in tests.
    const auth = (req, res, next) => {
        const id = { "test-user=alice": "000000000000000000000001", "test-user=bob": "000000000000000000000002" }[req.get("Cookie")];
        if (!id) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in." } });
        req.user = { id };
        next();
    };
    const protect = (req, res, next) => req.get("Origin") === "https://cineflix.test" ? next()
        : res.status(403).json({ error: { code: "INVALID_ORIGIN", message: "Invalid origin." } });
    app.use("/api/ratings", registerRatingRoutes({ router: express.Router(), controllers: createRatingControllers({ ratingService: service }),
        requireAuth: auth, protectMutation: protect }));
    app.use((error, req, res, next) => res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Request failed." } }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = "http://127.0.0.1:" + server.address().port + "/api/ratings/";
    async function call(path, method = "GET", body, user = "alice", origin = "https://cineflix.test") {
        return fetch(url + path, { method,
            headers: { "Content-Type": "application/json", Origin: origin, ...(user ? { Cookie: "test-user=" + user } : {}) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }

    const empty = await call("movie-004", "GET", undefined, null);
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get("cache-control"), "no-store");
    assert.deepEqual(await empty.json(), { average: null, count: 0, reviews: [] });
    for (const method of ["GET", "PUT", "DELETE"]) {
        assert.equal((await call("movie-004/me", method, method === "PUT" ? { score: 4 } : undefined, null)).status, 401);
    }
    assert.deepEqual(await (await call("movie-004/me")).json(), { rating: null });
    assert.equal((await call("movie-004/me", "PUT", { score: 5 }, "alice", "https://evil.test")).status, 403);
    assert.equal((await call("movie-004/me", "PUT", { score: 5, userId: "bob" })).status, 400);
    const saved = await call("movie-004/me", "PUT", { score: 5, reviewText: "A review" });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { score: 5, reviewText: "A review" });
    await call("movie-004/me", "PUT", { score: 4 });
    await call("movie-004/me", "PUT", { score: 2 }, "bob");
    const summary = await (await call("movie-004")).json();
    assert.equal(summary.count, 2);
    assert.equal(summary.average, 3);
    assert(!JSON.stringify(summary).includes("000000"));
    assert.deepEqual(await (await call("movie-004/me", "GET", undefined, "bob")).json(), { rating: { score: 2, reviewText: "" } });
    for (const score of [0, 6, 3.5, "4"]) {
        const bad = await call("movie-004/me", "PUT", { score });
        assert.equal(bad.status, 400);
        assert.equal((await bad.json()).error.code, "INVALID_SCORE");
    }
    assert.equal((await call("movie-004/me", "PUT", { score: 4, reviewText: "x".repeat(2001) })).status, 400);
    for (const method of ["GET", "PUT", "DELETE"]) {
        assert.equal((await call("movie-missing/me", method, method === "PUT" ? { score: 4 } : undefined)).status, 404);
    }
    assert.equal((await call("movie-missing")).status, 404);
    assert.equal((await call("show-001/me", "PUT", { score: 1 })).status, 200);
    const deleted = await call("movie-004/me", "DELETE");
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), "");
    assert.equal((await call("movie-004/me", "DELETE")).status, 204);
    assert.equal((await (await call("movie-004")).json()).average, 2);
    assert.equal((await (await call("show-001/me")).json()).rating.score, 1);
    fail = true;
    const failure = await call("movie-004");
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: { code: "INTERNAL_ERROR", message: "Request failed." } });
});
