"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const catalogue = require("../../data/catalogue.json");
const {
    MovieNightRuleError,
    validateSessionInput,
    validateNextVote,
    calculateResults
} = require("../src/services/movieNightRules.cjs");

const selectedIds = ["movie-011", "movie-012", "movie-013"];
const titles = [...catalogue.movies, ...catalogue.shows];
const configuration = overrides => ({ selectedIds: [...selectedIds], voterCount: 4, ...overrides });
const session = overrides => ({ ...configuration(), votes: [], ...overrides });

function expectRuleError(action, code, statusCode = 400) {
    assert.throws(action, error => {
        assert(error instanceof MovieNightRuleError);
        assert.equal(error.code, code);
        assert.equal(error.statusCode, statusCode);
        assert.equal(typeof error.message, "string");
        assert(error.message.length > 0);
        return true;
    });
}

test("creation preserves stable IDs and returns configuration without client ownership", () => {
    const input = configuration({ userId: "untrusted", hostUser: "untrusted", votes: [selectedIds[0]], status: "complete" });
    const result = validateSessionInput(input, titles);
    assert.deepEqual(result, configuration());
    assert.notEqual(result.selectedIds, input.selectedIds);
    result.selectedIds.pop();
    assert.deepEqual(input.selectedIds, selectedIds);
});

test("creation accepts every configured voter count from 2 through 10", () => {
    for (let voterCount = 2; voterCount <= 10; voterCount++) {
        assert.equal(validateSessionInput(configuration({ voterCount }), titles).voterCount, voterCount);
    }
});

test("creation rejects missing or non-object input", () => {
    for (const input of [undefined, null, [], "session", 4, true]) {
        expectRuleError(() => validateSessionInput(input, titles), "INVALID_SESSION");
    }
});

test("selection requires exactly three distinct string IDs", () => {
    for (const ids of [undefined, null, "movie-011", [], selectedIds.slice(0, 2),
        [...selectedIds, "movie-014"], [selectedIds[0], selectedIds[0], selectedIds[2]],
        [null, selectedIds[1], selectedIds[2]], [11, selectedIds[1], selectedIds[2]],
        [{ id: selectedIds[0] }, selectedIds[1], selectedIds[2]], new Array(3),
        ["", selectedIds[1], selectedIds[2]], [" movie-011", selectedIds[1], selectedIds[2]],
        ["movie-011 ", selectedIds[1], selectedIds[2]]]) {
        expectRuleError(() => validateSessionInput(configuration({ selectedIds: ids }), titles), "INVALID_SELECTED_IDS");
    }
});

test("selection rejects shows, unknown IDs, titles, and MongoDB-style IDs", () => {
    for (const id of ["show-001", "movie-missing", "Inception", "507f1f77bcf86cd799439011"]) {
        expectRuleError(() => validateSessionInput(configuration({ selectedIds: [id, ...selectedIds.slice(1)] }), titles), "INVALID_SELECTED_IDS");
    }
});

test("movie-looking IDs are rejected when the trusted catalogue classifies them as shows", () => {
    const records = selectedIds.map(id => ({ id, type: id === selectedIds[0] ? "show" : "movie" }));
    expectRuleError(() => validateSessionInput(configuration(), records), "INVALID_SELECTED_IDS");
});

test("creation uses supplied catalogue records and does not rely on title text or an ID prefix", () => {
    const records = selectedIds.map(id => ({ id, type: "movie", title: "Same renamed title" }));
    assert.deepEqual(validateSessionInput(configuration(), records), configuration());
    expectRuleError(() => validateSessionInput(configuration(), []), "INVALID_SELECTED_IDS");
    assert.throws(() => validateSessionInput(configuration(), undefined), TypeError);
});

test("voter counts are strict integers without coercion or defaults", () => {
    for (const voterCount of [undefined, null, "4", true, 0, 1, 11, -2, 2.5, NaN, Infinity]) {
        expectRuleError(() => validateSessionInput(configuration({ voterCount }), titles), "INVALID_VOTER_COUNT");
    }
});

test("validation accepts frozen input and frozen trusted records without mutation", () => {
    const input = Object.freeze({ selectedIds: Object.freeze([...selectedIds]), voterCount: 4 });
    const records = Object.freeze(selectedIds.map(id => Object.freeze({ id, type: "movie" })));
    assert.deepEqual(validateSessionInput(input, records), configuration());
});

test("a selected movie may receive votes from multiple sequential voter slots", () => {
    const state = session({ votes: [selectedIds[0]] });
    assert.equal(validateNextVote(state, selectedIds[0]), selectedIds[0]);
    assert.deepEqual(state.votes, [selectedIds[0]]);
});

test("each selected movie is accepted for the last remaining slot", () => {
    const state = session({ votes: [selectedIds[0], selectedIds[1], selectedIds[0]] });
    for (const id of selectedIds) assert.equal(validateNextVote(state, id), id);
});

test("invalid next votes are rejected without changing existing progress", () => {
    const state = session({ votes: [selectedIds[0]] });
    const before = structuredClone(state);
    for (const itemId of [undefined, null, {}, 11, "", "movie-014", "show-001", "Inception", " movie-011"]) {
        expectRuleError(() => validateNextVote(state, itemId), "INVALID_VOTE");
    }
    assert.deepEqual(state, before);
});

test("a completed session rejects any further selected vote as a conflict", () => {
    const state = session({ voterCount: 2, votes: [selectedIds[0], selectedIds[1]] });
    for (const id of selectedIds) expectRuleError(() => validateNextVote(state, id), "VOTING_COMPLETE", 409);
});

test("result and vote checks reject malformed session configuration", () => {
    for (const state of [null, undefined, [], "session"]) {
        expectRuleError(() => calculateResults(state), "INVALID_SESSION");
        expectRuleError(() => validateNextVote(state, selectedIds[0]), "INVALID_SESSION");
    }
    expectRuleError(() => calculateResults(session({ selectedIds: [] })), "INVALID_SELECTED_IDS");
    expectRuleError(() => validateNextVote(session({ voterCount: 11 }), selectedIds[0]), "INVALID_VOTER_COUNT");
});

test("malformed, foreign, sparse, or excess stored votes cannot produce results or accept a vote", () => {
    for (const votes of [undefined, null, "movie-011", [null], [{}], ["movie-014"], ["show-001"],
        ["Inception"], new Array(1), Array(5).fill(selectedIds[0])]) {
        const state = session({ votes });
        expectRuleError(() => calculateResults(state), "INVALID_VOTES");
        expectRuleError(() => validateNextVote(state, selectedIds[0]), "INVALID_VOTES");
    }
});

test("an empty session reports all zero totals without declaring a tie or winner", () => {
    assert.deepEqual(calculateResults(session()), {
        complete: false,
        tallies: selectedIds.map(itemId => ({ itemId, count: 0 })),
        winners: [], isTie: false
    });
});

test("partial votes expose progress but never announce a final winner or tie", () => {
    for (const votes of [[selectedIds[0]], [selectedIds[0], selectedIds[1]]]) {
        const result = calculateResults(session({ votes }));
        assert.equal(result.complete, false);
        assert.deepEqual(result.winners, []);
        assert.equal(result.isTie, false);
        assert.equal(result.tallies.reduce((sum, item) => sum + item.count, 0), votes.length);
    }
});

test("completed results identify the highest tally and include zero-vote movies", () => {
    assert.deepEqual(calculateResults(session({ votes: [selectedIds[1], selectedIds[0], selectedIds[1], selectedIds[1]] })), {
        complete: true,
        tallies: [{ itemId: selectedIds[0], count: 1 }, { itemId: selectedIds[1], count: 3 }, { itemId: selectedIds[2], count: 0 }],
        winners: [selectedIds[1]], isTie: false
    });
});

test("two-way ties contain only the tied leaders in selection order", () => {
    const result = calculateResults(session({ votes: [selectedIds[2], selectedIds[0], selectedIds[2], selectedIds[0]] }));
    assert.equal(result.complete, true);
    assert.deepEqual(result.winners, [selectedIds[0], selectedIds[2]]);
    assert.equal(result.isTie, true);
});

test("three-way ties retain all stable IDs", () => {
    const result = calculateResults(session({ voterCount: 3, votes: [...selectedIds] }));
    assert.equal(result.complete, true);
    assert.deepEqual(result.winners, selectedIds);
    assert.equal(result.isTie, true);
});

test("completion and totals work at both voter-count boundaries", () => {
    for (const voterCount of [2, 10]) {
        const result = calculateResults(session({ voterCount, votes: Array(voterCount).fill(selectedIds[2]) }));
        assert.equal(result.complete, true);
        assert.deepEqual(result.winners, [selectedIds[2]]);
        assert.deepEqual(result.tallies.map(item => item.count), [0, 0, voterCount]);
    }
});

test("results are independent of vote order and do not mutate or expose input arrays", () => {
    const state = Object.freeze({
        selectedIds: Object.freeze([...selectedIds]), voterCount: 4,
        votes: Object.freeze([selectedIds[2], selectedIds[0], selectedIds[2], selectedIds[0]])
    });
    const result = calculateResults(state);
    assert.deepEqual(result, calculateResults({ ...state, votes: [...state.votes].reverse() }));
    result.tallies[0].count = 99;
    result.winners.pop();
    assert.deepEqual(calculateResults(state).winners, [selectedIds[0], selectedIds[2]]);
    assert.deepEqual(state.votes, [selectedIds[2], selectedIds[0], selectedIds[2], selectedIds[0]]);
    assert.equal(validateNextVote({ ...state, votes: [] }, selectedIds[0]), selectedIds[0]);
});
