"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Watchlist = require("../src/models/Watchlist");

test("watchlist defaults, statuses, ownership, timestamps and unique index", async () => {
    const user = new mongoose.Types.ObjectId();
    const entry = new Watchlist({ user, itemId: "movie-004" });
    await entry.validate();
    assert.equal(entry.status, "want-to-watch");
    assert.equal(Watchlist.schema.path("user").options.ref, "User");
    assert.deepEqual(Watchlist.schema.options.timestamps, { createdAt: "addedAt", updatedAt: "updatedAt" });
    assert(Watchlist.schema.indexes().some(([keys, options]) => keys.user === 1 && keys.itemId === 1 && options.unique));
    for (const status of Watchlist.STATUSES) await new Watchlist({ user, itemId: "show-001", status }).validate();
    for (const values of [{ itemId: "movie-004" }, { user }, { user, itemId: " " },
        { user, itemId: " movie-004" }, { user, itemId: "x".repeat(129) },
        { user, itemId: "movie-004", status: "invalid" }, { user: "invalid", itemId: "movie-004" }]) {
        await assert.rejects(new Watchlist(values).validate(), { name: "ValidationError" });
    }
});
