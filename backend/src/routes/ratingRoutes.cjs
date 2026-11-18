"use strict";

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
    router.get("/:itemId/me", requireAuth, controllers.getOwn);
    router.put("/:itemId/me", requireAuth, protectMutation, controllers.putOwn);
    router.delete("/:itemId/me", requireAuth, protectMutation, controllers.deleteOwn);
    return router; // Mount once at /api/ratings in the shared application.
}

module.exports = { registerRatingRoutes };
