"use strict";

// Pure rules only: no database connection, HTTP handling, or user identity.
// Explicit CommonJS keeps this module independent of M1's future package type.
class MovieNightRuleError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "MovieNightRuleError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

function validateSelectedIds(selectedIds) {
    if (!Array.isArray(selectedIds) || selectedIds.length !== 3) {
        throw new MovieNightRuleError("INVALID_SELECTED_IDS", "Choose exactly three distinct movie IDs.");
    }
    for (const id of selectedIds) {
        if (typeof id !== "string" || !id.trim() || id !== id.trim()) {
            throw new MovieNightRuleError("INVALID_SELECTED_IDS", "Movie IDs must be non-empty strings without surrounding whitespace.");
        }
    }
    if (new Set(selectedIds).size !== 3) {
        throw new MovieNightRuleError("INVALID_SELECTED_IDS", "Choose three different movies.");
    }
}

function validateVoterCount(voterCount) {
    if (!Number.isInteger(voterCount) || voterCount < 2 || voterCount > 10) {
        throw new MovieNightRuleError("INVALID_VOTER_COUNT", "Voter count must be an integer from 2 to 10.");
    }
}

// Validate shape before a service asks the catalogue repository to resolve IDs.
function validateSessionConfiguration(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new MovieNightRuleError("INVALID_SESSION", "Provide selectedIds and voterCount.");
    }
    const { selectedIds, voterCount } = input;
    validateSelectedIds(selectedIds);
    validateVoterCount(voterCount);
    return { selectedIds: [...selectedIds], voterCount };
}

/**
 * Validate creation input against trusted catalogue records supplied by the caller.
 * Integration must obtain records from M1's Title model, never from the request.
 * Returns only session configuration; ownership belongs to the authenticated controller.
 */
function validateSessionInput(input, catalogueTitles) {
    const configuration = validateSessionConfiguration(input);
    if (!Array.isArray(catalogueTitles)) {
        throw new TypeError("Trusted catalogue title records are required.");
    }
    for (const id of configuration.selectedIds) {
        const title = catalogueTitles.find(item => item && item.id === id);
        if (!title || title.type !== "movie") {
            throw new MovieNightRuleError("INVALID_SELECTED_IDS", "Every selected ID must identify an existing catalogue movie.");
        }
    }
    return configuration;
}

// State is configuration plus an ordered list of stable movie IDs. Identity and
// persistence are deliberately separate so room voting can reuse result rules.
function validateVoteHistory(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        throw new MovieNightRuleError("INVALID_SESSION", "A session state is required.");
    }
    validateSelectedIds(state.selectedIds);
    validateVoterCount(state.voterCount);
    if (!Array.isArray(state.votes) || state.votes.length > state.voterCount) {
        throw new MovieNightRuleError("INVALID_VOTES", "Votes must be an array within the configured voter count.");
    }
    for (const vote of state.votes) {
        if (typeof vote !== "string" || !state.selectedIds.includes(vote)) {
            throw new MovieNightRuleError("INVALID_VOTES", "Each stored vote must identify a selected movie.");
        }
    }
}

/**
 * Check one sequential vote against a snapshot, without changing that snapshot.
 * This is NOT an atomic write or duplicate-request safeguard. The persistence
 * milestone must enforce ownership, a turn precondition, and capacity atomically.
 */
function validateNextVote(state, itemId) {
    validateVoteHistory(state);
    if (typeof itemId !== "string" || !state.selectedIds.includes(itemId)) {
        throw new MovieNightRuleError("INVALID_VOTE", "Vote for one of the selected movies.");
    }
    if (state.votes.length === state.voterCount) {
        throw new MovieNightRuleError("VOTING_COMPLETE", "All configured votes have already been cast.", 409);
    }
    return itemId;
}

/**
 * Internal result representation, not a mounted API response contract.
 * Include zero counts in selection order; announce winners only when complete.
 */
function validateRevision(revision) {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
        throw new MovieNightRuleError("INVALID_REVISION", "Provide a nonnegative, incrementable session revision.");
    }
    return revision;
}

function calculateResults(state) {
    validateVoteHistory(state);
    const counts = new Map(state.selectedIds.map(id => [id, 0]));
    for (const itemId of state.votes) counts.set(itemId, counts.get(itemId) + 1);
    const tallies = state.selectedIds.map(itemId => ({ itemId, count: counts.get(itemId) }));
    const complete = state.votes.length === state.voterCount;
    const highest = Math.max(...counts.values());
    const winners = complete ? tallies.filter(item => item.count === highest).map(item => item.itemId) : [];
    return { complete, tallies, winners, isTie: complete && winners.length > 1 };
}

module.exports = {
    MovieNightRuleError,
    validateSessionConfiguration,
    validateSessionInput,
    validateNextVote,
    validateRevision,
    calculateResults
};
