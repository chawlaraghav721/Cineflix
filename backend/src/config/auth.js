"use strict";

class AuthConfigurationError extends Error {}

function loadAuthConfig(env = process.env) {
    const secret = env.JWT_SECRET;
    if (typeof secret !== "string" || !secret.trim() || Buffer.byteLength(secret) < 32 ||
        /change.?me|replace.?me|your.?secret|placeholder/i.test(secret)) {
        throw new AuthConfigurationError("Set JWT_SECRET to a private random value of at least 32 bytes.");
    }
    const secure = env.NODE_ENV === "production";
    const configuredOrigin = env.APP_ORIGIN || (secure ? "" : `http://localhost:${env.PORT || 3000}`);
    let origin;
    try {
        const parsed = new URL(configuredOrigin);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password ||
            parsed.pathname !== "/" || parsed.search || parsed.hash || (secure && parsed.protocol !== "https:")) throw new Error();
        origin = parsed.origin;
    } catch {
        throw new AuthConfigurationError("APP_ORIGIN must be the website origin; production requires HTTPS.");
    }
    return Object.freeze({ secret, origin, secure, cookieName: "cineflix_session", ttlSeconds: 3600,
        issuer: "cineflix", audience: "cineflix-web" });
}

module.exports = { loadAuthConfig, AuthConfigurationError };
