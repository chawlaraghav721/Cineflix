"use strict";
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { userDto } = require("../services/authService");

async function requireAuth(req, res, next) {
    res.set("Cache-Control", "no-store");
    const config = req.app.locals.authConfig;
    const token = req.cookies?.[config.cookieName];
    const unauthorized = () => res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in to continue." } });
    if (typeof token !== "string" || token.length > 4096) return unauthorized();
    let claims;
    try {
        claims = jwt.verify(token, config.secret, { algorithms: ["HS256"], issuer: config.issuer, audience: config.audience });
        if (!claims || typeof claims.sub !== "string" || !/^[a-f\d]{24}$/i.test(claims.sub) ||
            !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) ||
            claims.exp - claims.iat > config.ttlSeconds || claims.iat > Math.floor(Date.now() / 1000)) return unauthorized();
    } catch { return unauthorized(); }
    try {
        // Read current identity/role so deleted accounts and revoked admin roles do not persist in old tokens.
        const user = await User.findById(claims.sub).select("name email role").lean();
        if (!user) return unauthorized();
        req.user = { id: String(user._id), email: user.email, role: user.role };
        req.authenticatedUser = userDto(user);
        return next();
    } catch (error) { return next(error); }
}

module.exports = { requireAuth };
