"use strict";
const { MovieNightRuleError, validateSessionConfiguration, validateSessionInput,
    validateNextVote, validateRevision, calculateResults } = require("./movieNightRules.cjs");

function requireMethods(repository, name, methods) {
    for (const method of methods) {
        if (!repository || typeof repository[method] !== "function") throw new TypeError(`${name}.${method} is required.`);
    }
}

// Caller precondition only. M2's middleware must supply verified req.user.
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
const notFound = () => new MovieNightRuleError("SESSION_NOT_FOUND", "Movie Night session not found.", 404);
const conflict = () => new MovieNightRuleError("SESSION_CONFLICT", "The session changed. Reload its state before continuing.", 409);

function checkOwnedRecord(record, hostUser, sessionId) {
    if (!record || typeof record._id !== "string" || !record._id.trim() ||
        record.hostUser !== hostUser || (sessionId !== undefined && record._id !== sessionId) ||
        (record.mode !== undefined && record.mode !== "sequential")) {
        throw new Error("Movie Night repository returned a record outside the requested scope.");
    }
    try {
        if (!Number.isSafeInteger(record.revision) || record.revision < 0) throw new Error();
        const results = calculateResults(record);
        if (record.status !== (results.complete ? "complete" : "voting")) throw new Error();
    } catch {
        throw new Error("Movie Night repository returned invalid stored state.");
    }
    return record;
}

function createMovieNightSessionService({ sessionRepository, titleRepository } = {}) {
    requireMethods(sessionRepository, "sessionRepository", [
        "create", "findOwned", "listOwned", "appendVoteOwned", "resetVotesOwned", "deleteOwned"
    ]);
    requireMethods(titleRepository, "titleRepository", ["findByIds"]);
    async function read(scope) {
        const record = await sessionRepository.findOwned(scope);
        if (record === null) throw notFound();
        return checkOwnedRecord(record, scope.hostUser, scope.sessionId);
    }
    async function conditionalResult(record, scope, revision) {
        if (record === null) {
            await read(scope);
            throw conflict();
        }
        checkOwnedRecord(record, scope.hostUser, scope.sessionId);
        if (record.revision !== revision + 1) throw new Error("Repository did not advance the revision exactly once.");
        return record;
    }
    function checkRevision(record, revision) {
        if (record.revision !== revision) throw conflict();
    }
    return {
        async createSession(actor, input) {
            const hostUser = requireHostId(actor);
            const configuration = validateSessionConfiguration(input);
            const titles = await titleRepository.findByIds([...configuration.selectedIds]);
            const validated = validateSessionInput(configuration, titles);
            return checkOwnedRecord(await sessionRepository.create({
                ...validated, hostUser, votes: [], status: "voting", revision: 0
            }), hostUser);
        },
        async getSession(actor, sessionId) { return read(ownedScope(actor, sessionId)); },
        async listSessions(actor) {
            const hostUser = requireHostId(actor);
            const sessions = await sessionRepository.listOwned({ hostUser });
            if (!Array.isArray(sessions)) throw new Error("Movie Night repository must return a session array.");
            for (const record of sessions) checkOwnedRecord(record, hostUser);
            return { sessions };
        },
        async submitVote(actor, sessionId, input, expectedRevision) {
            const scope = ownedScope(actor, sessionId);
            validateRevision(expectedRevision);
            if (!input || typeof input !== "object" || Array.isArray(input)) {
                throw new MovieNightRuleError("INVALID_VOTE", "Provide an itemId.");
            }
            const current = await read(scope);
            checkRevision(current, expectedRevision);
            const itemId = validateNextVote(current, input.itemId);
            const nextStatus = current.votes.length + 1 === current.voterCount ? "complete" : "voting";
            const updated = await conditionalResult(await sessionRepository.appendVoteOwned(
                { ...scope, expectedRevision }, { itemId, nextStatus }
            ), scope, expectedRevision);
            if (updated.voterCount !== current.voterCount || JSON.stringify(updated.selectedIds) !== JSON.stringify(current.selectedIds) ||
                updated.votes.length !== current.votes.length + 1 || updated.votes.at(-1) !== itemId ||
                !current.votes.every((vote, index) => updated.votes[index] === vote)) throw new Error("Repository did not append exactly the requested vote.");
            return updated;
        },
        async getResults(actor, sessionId) { return calculateResults(await read(ownedScope(actor, sessionId))); },
        async resetSession(actor, sessionId, expectedRevision) {
            const scope = ownedScope(actor, sessionId);
            validateRevision(expectedRevision);
            const current = await read(scope);
            checkRevision(current, expectedRevision);
            const updated = await conditionalResult(await sessionRepository.resetVotesOwned({ ...scope, expectedRevision }), scope, expectedRevision);
            if (updated.votes.length || updated.voterCount !== current.voterCount || JSON.stringify(updated.selectedIds) !== JSON.stringify(current.selectedIds)) {
                throw new Error("Repository did not clear only the session votes.");
            }
            return updated;
        },
        async deleteSession(actor, sessionId) {
            const deleted = await sessionRepository.deleteOwned(ownedScope(actor, sessionId));
            if (deleted === false) throw notFound();
            if (deleted !== true) throw new Error("Movie Night repository must return a deletion boolean.");
        }
    };
}
module.exports = { createMovieNightSessionService, requireHostId, requireMethods };
