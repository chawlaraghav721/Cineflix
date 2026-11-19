"use strict";
const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = await derive(password, salt, 64, options);
    return `scrypt$32768$8$3$${salt}$${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
    if (typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$32768$8$3" ||
        !/^[a-f\d]{32}$/.test(parts[4]) || !/^[a-f\d]{128}$/.test(parts[5])) return false;
    const candidate = await derive(password, parts[4], 64, options);
    return timingSafeEqual(candidate, Buffer.from(parts[5], "hex"));
}

// Unknown accounts still perform password derivation before rejecting a login.
let dummyHash;
function getDummyHash() {
    if (!dummyHash) dummyHash = hashPassword(randomBytes(32).toString("hex"));
    return dummyHash;
}

module.exports = { hashPassword, verifyPassword, getDummyHash };
