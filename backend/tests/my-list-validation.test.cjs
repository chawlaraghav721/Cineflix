const test = require("node:test");
const assert = require("node:assert/strict");
const { validItemId, validateBody } = require("../src/services/watchlistValidation");
test("watchlist input rejects malformed IDs, statuses, ownership and MongoDB operators", () => {
    assert.equal(validateBody({ itemId: "movie-004" }), null);
    assert.equal(validateBody({ status: "watching" }, true), null);
    for (const value of [null, [], {}, "", " movie-004", "movie-004 ", "x".repeat(129)]) assert(!validItemId(value));
    for (const body of [null, [], {}, { itemId: { $ne: null } }, { itemId: "movie-004", status: null },
        { itemId: "movie-004", userId: "someone-else" }, { itemId: "movie-004", $set: {} }]) assert(validateBody(body));
    for (const body of [{}, { status: 1 }, { status: "WATCHED" }, { status: "watched", user: "other" }]) assert(validateBody(body, true));
});
