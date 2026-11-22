"use strict";
const router = require("express").Router();
const { requireAuth } = require("../middleware/requireAuth");
const { protectMutation } = require("../middleware/protectMutation");
const controller = require("../controllers/ratingController");

function expectedAccount(req, res, next) {
    const expected = req.get("X-Ratings-Account");
    // Only cookie authentication establishes ownership. This optional comparison
    // prevents a draft sent during a cookie/account switch from reaching the new owner.
    if (expected !== undefined && expected !== req.user.id) {
        return res.status(409).json({ error: { code: "ACCOUNT_CHANGED", message: "Your account changed. Refresh ratings and try again." } });
    }
    return next();
}

router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (Object.keys(req.query).length) return res.status(400).json({ error: { code: "INVALID_QUERY", message: "Ratings endpoints do not accept query parameters." } });
    return next();
});
router.get("/", requireAuth, expectedAccount, controller.list);
router.get("/:itemId", controller.summary);
router.get("/:itemId/me", requireAuth, expectedAccount, controller.own);
router.put("/:itemId/me", requireAuth, protectMutation, expectedAccount, controller.save);
router.delete("/:itemId/me", requireAuth, protectMutation, expectedAccount, controller.remove);
module.exports = router;
