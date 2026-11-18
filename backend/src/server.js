"use strict";

const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { createApp } = require("./app");
const { connectDatabase, disconnectDatabase } = require("./config/db");

async function startServer() {
    await connectDatabase();
    const port = Number.parseInt(process.env.PORT || "3000", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535.");
    }
    const server = createApp().listen(port, () => {
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
    startServer().catch(error => {
        console.error("CineFlix backend startup failed:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { startServer };
