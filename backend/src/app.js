"use strict";

const express = require("express");
const path = require("node:path");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const healthRoutes = require("./routes/healthRoutes");
const titleRoutes = require("./routes/titleRoutes");
const cookieParser = require("cookie-parser");
const { createAuthRouter } = require("./routes/authRoutes");
const { loadAuthConfig } = require("./config/auth");
const { createMovieNightRouter } = require("./routes/createMovieNightRouter.cjs");
const myListRoutes = require("./routes/myListRoutes");
const ratingRoutes = require("./routes/ratingRoutes");

const repositoryRoot = path.resolve(__dirname, "../..");

function isPrivatePath(requestPath) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(requestPath);
    } catch (_) {
        return true;
    }
    const segments = decodedPath.split(/[\\/]+/).filter(Boolean);
    return segments.some(segment => segment === ".git" || segment === "backend" || segment === "node_modules" || segment.startsWith("."));
}

function createApp({ authConfig = loadAuthConfig() } = {}) {
    const app = express();
    app.locals.authConfig = authConfig;
    app.disable("x-powered-by");
    app.use((req, res, next) => {
        res.set("X-Content-Type-Options", "nosniff");
        res.set("Referrer-Policy", "same-origin");
        if (isPrivatePath(req.path)) {
            return req.path.startsWith("/api/")
                ? res.status(404).json({ error: { code: "NOT_FOUND", message: "The requested API resource was not found." } })
                : res.sendStatus(404);
        }
        return next();
    });
    app.use(express.json({ limit: "100kb" }));
    app.use(cookieParser());

    app.use("/api/auth", createAuthRouter());
    app.use("/api/my-list", myListRoutes);
    app.use("/api/ratings", ratingRoutes);
    app.use("/api/movie-night", createMovieNightRouter());
    app.use("/api", healthRoutes);
    app.use("/api", titleRoutes);
    app.get("/api", (req, res) => res.json({ message: "CineFlix API" }));
    app.use(express.static(repositoryRoot, {
        dotfiles: "deny",
        index: "index.html",
        fallthrough: true,
        setHeaders(res) {
            res.setHeader("X-Content-Type-Options", "nosniff");
        }
    }));
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}

module.exports = { createApp, repositoryRoot };
