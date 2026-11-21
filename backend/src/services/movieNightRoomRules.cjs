"use strict";
const { randomInt, randomUUID } = require("node:crypto");
const { MovieNightRuleError, validateSessionConfiguration, calculateResults } = require("./movieNightRules.cjs");
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRoomCode() {
    return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
function normalizeRoomCode(code) {
    if (typeof code !== "string" || !/^[A-HJ-NP-Z2-9]{8}$/.test(code.trim().toUpperCase())) {
        throw new MovieNightRuleError("INVALID_ROOM_CODE", "Enter an eight-character room code.");
    }
    return code.trim().toUpperCase();
}
function requireRoundId(roundId) {
    if (typeof roundId !== "string" || !roundId || roundId !== roundId.trim() || roundId.length > 64) {
        throw new MovieNightRuleError("INVALID_ROUND", "Provide the current round ID.");
    }
    return roundId;
}
function roomResults(room) {
    return calculateResults({ ...room, votes: room.votes.map(v => v.itemId) });
}
function validateRoom(room) {
    validateSessionConfiguration(room);
    if (room.mode !== "room" || normalizeRoomCode(room.roomCode) !== room.roomCode || !Number.isSafeInteger(room.revision) || room.revision < 0) throw new Error("Invalid room identity or revision.");
    requireRoundId(room.roundId);
    const users = room.participants;
    if (!Array.isArray(users) || users.length > room.voterCount || new Set(users).size !== users.length ||
        [...users].some(u => typeof u !== "string" || !u || u !== u.trim())) throw new Error("Invalid roster.");
    if (!Array.isArray(room.votes) || room.votes.some(v => !v || !users.includes(v.participantId) || v.roundId !== room.roundId) ||
        new Set(room.votes.map(v => v.participantId)).size !== room.votes.length) throw new Error("Invalid ballots.");
    const result = roomResults(room);
    if (room.status === "waiting") { if (room.votes.length) throw new Error("Waiting room has votes."); }
    else if (!["voting", "complete"].includes(room.status) || users.length !== room.voterCount ||
        (room.status === "complete") !== result.complete) throw new Error("Invalid lifecycle state.");
    return true;
}
function roomView(room, actorId) {
    validateRoom(room);
    const isHost = room.hostUser === actorId;
    const hasJoined = room.participants.includes(actorId);
    if (!isHost && !hasJoined) throw new MovieNightRuleError("ROOM_NOT_FOUND", "Movie Night room not found.", 404);
    return { id: room._id, mode: "room", selectedIds: [...room.selectedIds], voterCount: room.voterCount,
        participantCount: room.participants.length, status: room.status, revision: room.revision, roundId: room.roundId,
        isHost, hasJoined, hasVoted: room.votes.some(v => v.participantId === actorId),
        canStart: isHost && room.status === "waiting" && room.participants.length === room.voterCount,
        results: roomResults(room), ...(isHost ? { roomCode: room.roomCode } : {}) };
}
module.exports = { generateRoomCode, normalizeRoomCode, requireRoundId, validateRoom, roomView, roomResults, generateRoundId: randomUUID };
