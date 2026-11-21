"use strict";

const express = require("express");
const mongoose = require("mongoose");
const Title = require("../models/Title");
const { requireAuth } = require("../middleware/requireAuth");
const { protectMutation } = require("../middleware/protectMutation");
const { createMovieNightSessionModel } = require("../models/MovieNightSession.cjs");
const { createMovieNightRepository, createMovieNightTitleRepository } = require("../repositories/movieNightRepository.cjs");
const { createMovieNightSessionService } = require("../services/movieNightSessionService.cjs");
const { createMovieNightControllers } = require("../controllers/movieNightController.cjs");
const { registerMovieNightRoutes } = require("./movieNightRoutes.cjs");
const { rateLimit } = require("express-rate-limit");
const { createMovieNightRoomRepository } = require("../repositories/movieNightRoomRepository.cjs");
const { createMovieNightRoomService } = require("../services/movieNightRoomService.cjs");

const getSessionModel = () => createMovieNightSessionModel({ mongoose, connection: mongoose.connection });
async function ensureMovieNightIndexes() {
    // Non-destructive index creation, verified first against isolated MongoDB.
    // Startup must finish this before serving rooms that require unique codes.
    await getSessionModel().createIndexes();
}

function createMovieNightRouter() {
    // Same Mongoose singleton/connection used by config/db.js, User and Title.
    const Session = getSessionModel();
    const titleRepository = createMovieNightTitleRepository(Title);
    const sessionService = createMovieNightSessionService({
        sessionRepository: createMovieNightRepository(Session),
        titleRepository
    });
    const roomService = createMovieNightRoomService({ roomRepository: createMovieNightRoomRepository(Session), titleRepository });
    const joinLimiter = rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => req.user.id,
        standardHeaders: true, legacyHeaders: false,
        message: { error: { code: "ROOM_JOIN_LIMIT", message: "Too many room join attempts. Please wait a minute." } } });
    return registerMovieNightRoutes({ router: express.Router(),
        controllers: createMovieNightControllers({ sessionService, roomService }),
        requireAuth, protectMutation, enableRooms: true, joinLimiter });
}

module.exports = { createMovieNightRouter, ensureMovieNightIndexes };
