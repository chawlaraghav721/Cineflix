"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { createApp } = require("./app");
const { connectDatabase, disconnectDatabase } = require("./config/db");
const { loadAuthConfig, AuthConfigurationError } = require("./config/auth");
const User = require("./models/User");
const Watchlist = require("./models/Watchlist");
const Rating = require("./models/Rating");
const { ensureMovieNightIndexes } = require("./routes/createMovieNightRouter.cjs");

async function startServer() {
    const authConfig = loadAuthConfig();
    await connectDatabase();
    await User.createIndexes();
    await Watchlist.createIndexes();
    await Rating.createIndexes();
    await ensureMovieNightIndexes();
    const port = Number.parseInt(process.env.PORT || "3000", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535.");
    }
    const server = createApp({ authConfig }).listen(port, () => {
        console.log(`CineFlix backend listening on port ${port}`);
    });
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
        console.error("CineFlix backend startup failed:", error instanceof AuthConfigurationError
            ? error.message : "Check database access and server configuration.");
        await disconnectDatabase();
        process.exitCode = 1;
    });
}

module.exports = { startServer };
