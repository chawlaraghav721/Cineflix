"use strict";
const { MovieNightRuleError, validateSessionConfiguration, validateSessionInput, validateRevision } = require("./movieNightRules.cjs");
const { requireHostId, requireMethods } = require("./movieNightSessionService.cjs");
const { generateRoomCode, generateRoundId, normalizeRoomCode, requireRoundId, validateRoom, roomView } = require("./movieNightRoomRules.cjs");
const fail = (code, message, statusCode = 409) => new MovieNightRuleError(code, message, statusCode);
function createMovieNightRoomService({ roomRepository, titleRepository, codeGenerator = generateRoomCode, roundGenerator = generateRoundId } = {}) {
    requireMethods(roomRepository, "roomRepository", ["createRoom", "findByCode", "findAccessible", "joinRoom", "startRoom", "resetRoom", "appendBallot"]);
    requireMethods(titleRepository, "titleRepository", ["findByIds"]);
    function stored(room, id) {
        if (!room) throw fail("ROOM_NOT_FOUND", "Movie Night room not found.", 404);
        try {
            if (typeof room._id !== "string" || !room._id || (id && id !== room._id) || typeof room.hostUser !== "string" || !room.hostUser) throw new Error();
            validateRoom(room);
        } catch { throw new Error("Repository returned invalid room state."); }
        return room;
    }
    async function read(actorId, roomId) {
        if (typeof roomId !== "string" || !roomId || roomId !== roomId.trim()) throw fail("INVALID_ROOM_ID", "Provide a room ID.", 400);
        const room = stored(await roomRepository.findAccessible({ roomId, actorId }), roomId);
        roomView(room, actorId); // Also verify the adapter's membership scope.
        return room;
    }
    function host(room, actorId, revision) {
        if (room.hostUser !== actorId) throw fail("HOST_REQUIRED", "Only the host can manage this room.", 403);
        if (room.revision !== revision) throw fail("SESSION_CONFLICT", "The room changed. Reload before continuing.");
    }
    function ballot(room, actorId, itemId, roundId) {
        if (!room.participants.includes(actorId)) throw fail("PARTICIPANT_REQUIRED", "Join the room before voting.", 403);
        if (room.roundId !== roundId) throw fail("ROUND_CONFLICT", "This voting round has changed.");
        if (room.votes.some(v => v.participantId === actorId)) throw fail("ALREADY_VOTED", "You have already voted in this round.");
        if (room.status !== "voting") throw fail("ROOM_CLOSED", "Voting is not open.");
        if (typeof itemId !== "string" || !room.selectedIds.includes(itemId)) throw fail("INVALID_VOTE", "Vote for a selected movie.", 400);
    }
    return {
        async createRoom(actor, input) {
            const actorId = requireHostId(actor);
            const config = validateSessionConfiguration(input);
            validateSessionInput(config, await titleRepository.findByIds([...config.selectedIds]));
            for (let attempt = 0; attempt < 5; attempt++) {
                const roomCode = normalizeRoomCode(codeGenerator());
                const roundId = requireRoundId(roundGenerator());
                try {
                    const room = stored(await roomRepository.createRoom({ ...config, mode: "room", hostUser: actorId,
                        roomCode, roundId, participants: [], votes: [], status: "waiting", revision: 0 }));
                    if (room.hostUser !== actorId || room.roomCode !== roomCode) throw new Error("Repository violated creation scope.");
                    return roomView(room, actorId);
                } catch (error) {
                    if (error.code !== 11000 || error.keyPattern?.roomCode !== 1) throw error;
                }
            }
            throw fail("ROOM_CODE_CONFLICT", "Could not allocate a room code. Try again.");
        },
        async getRoom(actor, roomId) { const actorId = requireHostId(actor); return roomView(await read(actorId, roomId), actorId); },
        async joinRoom(actor, input) {
            const actorId = requireHostId(actor);
            const code = normalizeRoomCode(input?.roomCode);
            const room = stored(await roomRepository.findByCode(code));
            if (room.roomCode !== code) throw new Error("Repository violated room-code scope.");
            if (room.participants.includes(actorId)) return roomView(room, actorId);
            if (room.status !== "waiting") throw fail("ROOM_CLOSED", "The roster is frozen for this round.");
            if (room.participants.length >= room.voterCount) throw fail("ROOM_FULL", "This room is full.");
            const joined = await roomRepository.joinRoom({ roomId: room._id, actorId, roundId: room.roundId });
            if (!joined) {
                const latest = stored(await roomRepository.findByCode(code), room._id);
                if (latest.participants.includes(actorId)) return roomView(latest, actorId);
                throw fail("ROOM_CONFLICT", "The room changed while joining. Reload and try again.");
            }
            stored(joined, room._id);
            if (!joined.participants.includes(actorId) || joined.roundId !== room.roundId || joined.revision <= room.revision) throw new Error("Repository did not apply membership.");
            return roomView(joined, actorId);
        },
        async startRoom(actor, roomId, expectedRevision) {
            const actorId = requireHostId(actor); validateRevision(expectedRevision);
            const room = await read(actorId, roomId); host(room, actorId, expectedRevision);
            if (room.status !== "waiting") throw fail("ROOM_CLOSED", "This round has already started.");
            if (room.participants.length !== room.voterCount) throw fail("ROOM_NOT_READY", "Fill every participant slot before starting.");
            const updated = await roomRepository.startRoom({ roomId, actorId, expectedRevision, roundId: room.roundId });
            if (!updated) { await read(actorId, roomId); throw fail("SESSION_CONFLICT", "The room changed while starting."); }
            stored(updated, roomId);
            if (updated.status !== "voting" || updated.revision !== expectedRevision + 1 || updated.roundId !== room.roundId) throw new Error("Repository did not start the round.");
            return roomView(updated, actorId);
        },
        async resetRoom(actor, roomId, expectedRevision) {
            const actorId = requireHostId(actor); validateRevision(expectedRevision);
            const room = await read(actorId, roomId); host(room, actorId, expectedRevision);
            const nextRoundId = requireRoundId(roundGenerator());
            if (nextRoundId === room.roundId) throw new Error("Round generator must create a fresh identity.");
            const updated = await roomRepository.resetRoom({ roomId, actorId, expectedRevision, roundId: room.roundId }, nextRoundId);
            if (!updated) { await read(actorId, roomId); throw fail("SESSION_CONFLICT", "The room changed while resetting."); }
            stored(updated, roomId);
            if (updated.status !== "waiting" || updated.revision !== expectedRevision + 1 || updated.roundId !== nextRoundId) throw new Error("Repository did not reset the round.");
            return roomView(updated, actorId);
        },
        async submitVote(actor, roomId, input, roundId) {
            const actorId = requireHostId(actor); requireRoundId(roundId);
            const room = await read(actorId, roomId); ballot(room, actorId, input?.itemId, roundId);
            const updated = await roomRepository.appendBallot({ roomId, actorId, roundId }, input.itemId);
            if (!updated) {
                ballot(await read(actorId, roomId), actorId, input.itemId, roundId);
                throw fail("ROOM_CONFLICT", "The room changed while voting. Reload its state.");
            }
            stored(updated, roomId);
            if (updated.roundId !== roundId || updated.revision <= room.revision ||
                !updated.votes.some(v => v.participantId === actorId && v.itemId === input.itemId)) throw new Error("Repository did not record the ballot.");
            return roomView(updated, actorId);
        }
    };
}
module.exports = { createMovieNightRoomService };
