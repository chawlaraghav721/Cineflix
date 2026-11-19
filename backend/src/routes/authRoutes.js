"use strict";
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const controller = require("../controllers/authController");
const { requireAuth } = require("../middleware/requireAuth");
const { protectMutation } = require("../middleware/protectMutation");

function createAuthRouter() {
    const router = express.Router();
    const attempts = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
        message: { error: { code: "TOO_MANY_ATTEMPTS", message: "Too many sign-in attempts. Please try again later." } } });
    router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
    router.post("/register", protectMutation, attempts, controller.register);
    router.post("/login", protectMutation, attempts, controller.login);
    router.post("/logout", protectMutation, controller.logout);
    router.get("/me", requireAuth, controller.me);
    return router;
}

module.exports = { createAuthRouter };
