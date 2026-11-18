"use strict";

const {
    MovieNightRuleError,
    validateSessionConfiguration,
    validateSessionInput
} = require("./movieNightRules.cjs");

function requireMethods(repository, name, methods) {
    for (const method of methods) {
        if (!repository || typeof repository[method] !== "function") {
            throw new TypeError(`${name}.${method} is required.`);
        }
    }
}

// A caller precondition, NOT authentication. Only an authenticated controller may
// pass M2's req.user here; never populate this argument from request input/storage.
function requireHostId(actor) {
    if (!actor || typeof actor.id !== "string" || !actor.id.trim() || actor.id !== actor.id.trim()) {
        throw new MovieNightRuleError("AUTH_REQUIRED", "Sign in to manage Movie Night sessions.", 401);
    }
    return actor.id;
}

function ownedScope(actor, sessionId) {
    const hostUser = requireHostId(actor);
    if (typeof sessionId !== "string" || !sessionId.trim() || sessionId !== sessionId.trim()) {
        throw new MovieNightRuleError("INVALID_SESSION_ID", "Provide a valid session ID.");
    }
    return { sessionId, hostUser };
}

function notFound() {
    return new MovieNightRuleError("SESSION_NOT_FOUND", "Movie Night session not found.", 404);
}

// Repository DTOs must normalize MongoDB identifiers to strings. These checks
// reject accidental foreign results; the adapter MUST still scope the actual
// database query/write by host. A post-write check cannot undo an unsafe adapter.
function checkOwnedRecord(record, hostUser, sessionId) {
    if (!record || typeof record._id !== "string" || !record._id.trim() ||
        record.hostUser !== hostUser || (sessionId !== undefined && record._id !== sessionId)) {
        throw new Error("Movie Night repository returned a record outside the requested scope.");
    }
    return record;
}

/**
 * Repository-backed use cases only. No default repositories, routes, authentication,
 * database connection, vote submission, or revision mechanism are supplied.
 * See docs/movie-night-backend.md for the internal adapter contract.
 */
function createMovieNightSessionService({ sessionRepository, titleRepository } = {}) {
    requireMethods(sessionRepository, "sessionRepository", [
        "create", "findOwned", "listOwned", "updateOwned", "deleteOwned"
    ]);
    requireMethods(titleRepository, "titleRepository", ["findByIds"]);

    return {
        async createSession(actor, input) {
            const hostUser = requireHostId(actor);
            const configuration = validateSessionConfiguration(input);
            const titles = await titleRepository.findByIds([...configuration.selectedIds]);
            const validated = validateSessionInput(configuration, titles);
            const record = await sessionRepository.create({
                ...validated, hostUser, votes: [], status: "voting"
            });
            return checkOwnedRecord(record, hostUser);
        },

        async getSession(actor, sessionId) {
            const scope = ownedScope(actor, sessionId);
            const record = await sessionRepository.findOwned(scope);
            if (record === null) throw notFound();
            return checkOwnedRecord(record, scope.hostUser, scope.sessionId);
        },

        async listSessions(actor) {
            const hostUser = requireHostId(actor);
            const sessions = await sessionRepository.listOwned({ hostUser });
            if (!Array.isArray(sessions)) {
                throw new Error("Movie Night repository must return a session array.");
            }
            for (const record of sessions) checkOwnedRecord(record, hostUser);
            return { sessions };
        },

        async resetSession(actor, sessionId) {
            const scope = ownedScope(actor, sessionId);
            // Clear votes only. Do not replace configuration, host, or the record.
            const record = await sessionRepository.updateOwned(scope, { votes: [], status: "voting" });
            if (record === null) throw notFound();
            return checkOwnedRecord(record, scope.hostUser, scope.sessionId);
        },

        async deleteSession(actor, sessionId) {
            const scope = ownedScope(actor, sessionId);
            const deleted = await sessionRepository.deleteOwned(scope);
            if (deleted === false) throw notFound();
            if (deleted !== true) {
                throw new Error("Movie Night repository must return a deletion boolean.");
            }
            // Future HTTP controller sends the agreed 204 with no response body.
        }
    };
}

module.exports = { createMovieNightSessionService };
