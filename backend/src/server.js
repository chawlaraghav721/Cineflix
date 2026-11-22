"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { createApp } = require("./app");
const { connectDatabase, disconnectDatabase } = require("./config/db");
const { loadAuthConfig, AuthConfigurationError } = require("./config/auth");
const Title = require("./models/Title");
const User = require("./models/User");
const Watchlist = require("./models/Watchlist");
const Rating = require("./models/Rating");
const { ensureMovieNightIndexes } = require("./routes/createMovieNightRouter.cjs");

async function startServer({ mongoUri = process.env.MONGODB_URI, authConfig = loadAuthConfig(), port = process.env.PORT || "3000" } = {}) {
    const requestedPort = Number(port);
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
        throw new Error("PORT must be an integer between 0 and 65535.");
    }
    await connectDatabase(mongoUri);
    // createIndexes is non-destructive and must complete before the listener accepts requests.
    await Title.createIndexes();
    await User.createIndexes();
    await Watchlist.createIndexes();
    await Rating.createIndexes();
    await ensureMovieNightIndexes();
    const server = createApp({ authConfig }).listen(requestedPort);
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    if (requestedPort !== 0) console.log(`CineFlix backend listening on port ${requestedPort}`);
    const shutdown = () => {
        server.close(async () => {
            await disconnectDatabase();
            process.exit(0);
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return server;
}

if (require.main === module) {
    startServer().catch(async error => {
        const safeMessage = error instanceof AuthConfigurationError
            ? error.message
            : error && error.code === 11000
                ? "A unique database index could not be created because duplicate records exist. Review the affected data without deleting records."
                : "Check database access and server configuration.";
        console.error("CineFlix backend startup failed:", safeMessage);
        await disconnectDatabase();
        process.exitCode = 1;
    });
}

module.exports = { startServer };
