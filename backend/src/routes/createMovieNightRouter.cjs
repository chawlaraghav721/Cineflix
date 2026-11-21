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

function createMovieNightRouter() {
    // Same Mongoose singleton/connection used by config/db.js, User and Title.
    const Session = createMovieNightSessionModel({ mongoose, connection: mongoose.connection });
    const sessionService = createMovieNightSessionService({
        sessionRepository: createMovieNightRepository(Session),
        titleRepository: createMovieNightTitleRepository(Title)
    });
    return registerMovieNightRoutes({ router: express.Router(),
        controllers: createMovieNightControllers({ sessionService }), requireAuth, protectMutation });
}

module.exports = { createMovieNightRouter };
