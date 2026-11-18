"use strict";

const express = require("express");
const { getDatabaseStatus } = require("../config/db");

const router = express.Router();
router.get("/health", (req, res) => {
    const database = getDatabaseStatus();
    const healthy = database === "connected";
    return res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "error", database });
});

module.exports = router;
