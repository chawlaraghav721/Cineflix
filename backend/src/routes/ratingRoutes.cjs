"use strict";

function checkExpectedAccount(req, res, next) {
    // Optional browser concurrency guard, never a source of authenticated identity.
    // A cookie can switch accounts between reading a draft and dispatching its write.
    const expected = req.get("X-Ratings-Owner");
    if (expected !== undefined && expected !== req.user.id) {
        return res.status(409).json({ error: { code: "ACCOUNT_CHANGED", message: "Your account changed. Refresh ratings before trying again." } });
    }
    return next();
}

function registerRatingRoutes({ router, controllers, requireAuth, protectMutation }) {
    if (typeof requireAuth !== "function" || typeof protectMutation !== "function") {
        throw new TypeError("Real authentication and Origin/CSRF protection middleware are required.");
    }
    for (const method of ["get", "put", "delete"]) {
        if (typeof router?.[method] !== "function") throw new TypeError("Supply an Express router.");
    }
    for (const method of ["getSummary", "getOwn", "putOwn", "deleteOwn"]) {
        if (typeof controllers?.[method] !== "function") throw new TypeError("Supply ratings controllers.");
    }
    router.get("/:itemId", controllers.getSummary);
    router.get("/:itemId/me", requireAuth, checkExpectedAccount, controllers.getOwn);
    router.put("/:itemId/me", requireAuth, protectMutation, checkExpectedAccount, controllers.putOwn);
    router.delete("/:itemId/me", requireAuth, protectMutation, checkExpectedAccount, controllers.deleteOwn);
    return router; // Mount once at /api/ratings in the shared application.
}

module.exports = { registerRatingRoutes };
