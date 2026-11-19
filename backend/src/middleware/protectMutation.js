"use strict";

function protectMutation(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const expected = req.app.locals.authConfig.origin;
    const origin = req.get("Origin");
    const fetchSite = req.get("Sec-Fetch-Site");
    let trusted = origin === expected;
    if (origin === undefined) {
        try { trusted = new URL(req.get("Referer")).origin === expected; } catch { trusted = false; }
    }
    if (!trusted || (fetchSite && !["same-origin", "none"].includes(fetchSite))) {
        return res.status(403).json({ error: { code: "INVALID_ORIGIN", message: "This request must come from the CineFlix website." } });
    }
    return next();
}

module.exports = { protectMutation };
