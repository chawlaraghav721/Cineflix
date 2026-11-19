"use strict";
const jwt = require("jsonwebtoken");

function cookieOptions(config) {
    return { httpOnly: true, sameSite: "strict", secure: config.secure, path: "/" };
}

function setAuthCookie(res, user, config) {
    const token = jwt.sign({}, config.secret, { algorithm: "HS256", subject: user.id,
        expiresIn: config.ttlSeconds, issuer: config.issuer, audience: config.audience });
    res.cookie(config.cookieName, token, { ...cookieOptions(config), maxAge: config.ttlSeconds * 1000 });
}

function clearAuthCookie(res, config) {
    res.clearCookie(config.cookieName, cookieOptions(config));
}

module.exports = { setAuthCookie, clearAuthCookie };
