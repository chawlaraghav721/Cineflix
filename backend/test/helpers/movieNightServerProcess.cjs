"use strict";
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function startBackendProcess({ mongoUri, secret, port }) {
    if (!port) {
        const probe = http.createServer();
        await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
        port = probe.address().port;
        await new Promise(resolve => probe.close(resolve));
    }
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [path.resolve(__dirname, "../../src/server.js")], {
        env: { ...process.env, NODE_ENV: "test", PORT: String(port), APP_ORIGIN: origin,
            JWT_SECRET: secret, MONGODB_URI: mongoUri }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true
    });
    const close = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise(resolve => {
            const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
            child.once("exit", () => { clearTimeout(timer); resolve(); });
            child.kill("SIGTERM");
        });
    };
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Isolated backend startup timed out.")), 15000);
            const fail = () => { clearTimeout(timer); reject(new Error("Isolated backend failed to start.")); };
            child.once("error", fail); child.once("exit", fail);
            child.stderr.on("data", () => {}); // Never echo secrets or database diagnostics.
            child.stdout.on("data", chunk => {
                if (chunk.toString().includes("listening on port")) { clearTimeout(timer); resolve(); }
            });
        });
    } catch (error) { await close(); throw error; }
    return { origin, port, close };
}
module.exports = { startBackendProcess };
