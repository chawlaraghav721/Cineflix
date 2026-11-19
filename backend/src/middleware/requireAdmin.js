"use strict";

function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in to continue." } });
    if (req.user.role !== "admin") return res.status(403).json({ error: { code: "ADMIN_REQUIRED", message: "Administrator access is required." } });
    return next();
}

module.exports = { requireAdmin };
