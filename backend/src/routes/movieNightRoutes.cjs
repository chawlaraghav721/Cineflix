"use strict";
const { requireMethods } = require("../services/movieNightSessionService.cjs");

// Feature routes only. M1 supplies a router and mounts it, after team approval.
// No Express import, server, middleware implementation, or automatic registration.
function registerMovieNightRoutes({ router, controllers, requireAuth, protectMutation, enableRooms = false }) {
    requireMethods(router, "router", ["get", "post", "put", "delete"]);
    if (typeof requireAuth !== "function" || typeof protectMutation !== "function") {
        throw new TypeError("Real authentication and mutation-protection middleware are required.");
    }
    const routes = [
        ["post", "/sessions", "createSession"], ["get", "/sessions", "listSessions"],
        ["get", "/sessions/:sessionId", "getSession"], ["post", "/sessions/:sessionId/votes", "voteSession"],
        ["get", "/sessions/:sessionId/results", "getSessionResults"], ["post", "/sessions/:sessionId/reset", "resetSession"],
        ["delete", "/sessions/:sessionId", "deleteSession"]
    ];
    if (enableRooms) routes.push(["post", "/rooms", "createRoom"], ["post", "/rooms/join", "joinRoom"],
        ["get", "/rooms/:roomId", "getRoom"], ["post", "/rooms/:roomId/start", "startRoom"],
        ["post", "/rooms/:roomId/reset", "resetRoom"], ["put", "/rooms/:roomId/votes/me", "voteRoom"]);
    requireMethods(controllers, "controllers", routes.map(r => r[2]));
    for (const [method, path, name] of routes) {
        router[method](path, requireAuth, ...(method === "get" ? [] : [protectMutation]), controllers[name]);
    }
    return router;
}
module.exports = { registerMovieNightRoutes };
