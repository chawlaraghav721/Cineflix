"use strict";
const { MovieNightRuleError, validateRevision } = require("../services/movieNightRules.cjs");
const { requireHostId, requireMethods } = require("../services/movieNightSessionService.cjs");
const { requireRoundId } = require("../services/movieNightRoomRules.cjs");

function revisionHeader(req) {
    const value = req.get("X-Movie-Night-Revision");
    if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
        throw new MovieNightRuleError("INVALID_REVISION", "Provide the current X-Movie-Night-Revision header.");
    }
    return validateRevision(Number(value));
}
function resourceId(req, key) {
    const id = req.params?.[key];
    if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) throw new MovieNightRuleError("INVALID_RESOURCE_ID", "Provide a valid session or room ID.");
    return id;
}
function requestBody(req) {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new MovieNightRuleError("INVALID_BODY", "Provide a JSON object.");
    return req.body;
}
function createMovieNightControllers({ sessionService, roomService } = {}) {
    requireMethods(sessionService, "sessionService", ["createSession", "getSession", "listSessions", "submitVote", "getResults", "resetSession", "deleteSession"]);
    if (roomService) requireMethods(roomService, "roomService", ["createRoom", "joinRoom", "getRoom", "startRoom", "resetRoom", "submitVote"]);
    const handle = (action, status = 200) => async (req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            requireHostId(req.user); // Presence only; M2's requireAuth must run first.
            const value = await action(req);
            if (status === 204) return res.status(204).end();
            return res.status(status).json(value);
        } catch (error) {
            if (error instanceof MovieNightRuleError && error.statusCode >= 400 && error.statusCode < 500) {
                return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
            }
            // Unexpected failures belong to M1's safe shared 500 handler.
            return next(error);
        }
    };
    const controllers = {
        createSession: handle(req => sessionService.createSession(req.user, requestBody(req)), 201),
        listSessions: handle(req => sessionService.listSessions(req.user)),
        getSession: handle(req => sessionService.getSession(req.user, resourceId(req, "sessionId"))),
        voteSession: handle(req => sessionService.submitVote(req.user, resourceId(req, "sessionId"), requestBody(req), revisionHeader(req))),
        getSessionResults: handle(req => sessionService.getResults(req.user, resourceId(req, "sessionId"))),
        resetSession: handle(req => sessionService.resetSession(req.user, resourceId(req, "sessionId"), revisionHeader(req))),
        deleteSession: handle(req => sessionService.deleteSession(req.user, resourceId(req, "sessionId")), 204)
    };
    if (roomService) Object.assign(controllers, {
        createRoom: handle(req => roomService.createRoom(req.user, requestBody(req)), 201),
        joinRoom: handle(req => roomService.joinRoom(req.user, requestBody(req))),
        getRoom: handle(req => roomService.getRoom(req.user, resourceId(req, "roomId"))),
        startRoom: handle(req => roomService.startRoom(req.user, resourceId(req, "roomId"), revisionHeader(req))),
        resetRoom: handle(req => roomService.resetRoom(req.user, resourceId(req, "roomId"), revisionHeader(req))),
        voteRoom: handle(req => roomService.submitVote(req.user, resourceId(req, "roomId"), requestBody(req), requireRoundId(req.get("X-Movie-Night-Round"))))
    });
    return controllers;
}
module.exports = { createMovieNightControllers, revisionHeader };
