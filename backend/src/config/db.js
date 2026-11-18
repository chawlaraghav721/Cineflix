"use strict";

const mongoose = require("mongoose");

let connectionPromise = null;

function getDatabaseStatus() {
    return mongoose.connection.readyState === 1 ? "connected" : "disconnected";
}

async function connectDatabase(uri = process.env.MONGODB_URI) {
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    if (!uri || typeof uri !== "string" || !uri.trim()) {
        throw new Error("MONGODB_URI is required to start the CineFlix backend.");
    }
    if (!connectionPromise) {
        connectionPromise = mongoose.connect(uri.trim(), {
            serverSelectionTimeoutMS: 10000
        }).then(() => mongoose.connection).catch(error => {
            connectionPromise = null;
            throw error;
        });
    }
    return connectionPromise;
}

async function disconnectDatabase() {
    connectionPromise = null;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

module.exports = { connectDatabase, disconnectDatabase, getDatabaseStatus };
