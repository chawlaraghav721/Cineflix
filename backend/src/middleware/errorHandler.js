"use strict";

function notFoundHandler(req, res, next) {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "The requested API resource was not found." } });
    }
    return next();
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    if (error && error.type === "entity.parse.failed") {
        return res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must contain valid JSON." } });
    }
    console.error("CineFlix request failed:", error && error.message ? error.message : "Unknown error");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
}

module.exports = { notFoundHandler, errorHandler };
