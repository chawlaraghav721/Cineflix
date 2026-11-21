"use strict";
const express = require("express");
const mongoose = require("mongoose");
const Title = require("../models/Title");
const { requireAuth } = require("../middleware/requireAuth");
const { protectMutation } = require("../middleware/protectMutation");
const { createRatingModel } = require("../models/Rating.cjs");
const { createRatingRepository, createRatingTitleRepository } = require("../repositories/ratingRepository.cjs");
const { createRatingService } = require("../services/ratingService.cjs");
const { createRatingControllers } = require("../controllers/ratingController.cjs");
const { registerRatingRoutes } = require("./ratingRoutes.cjs");

const getRatingModel = () => createRatingModel({ mongoose, connection: mongoose.connection });
const ensureRatingIndexes = () => getRatingModel().createIndexes();

function createRatingRouter() {
    const ratingService = createRatingService({
        ratingRepository: createRatingRepository({ Rating: getRatingModel() }),
        titleRepository: createRatingTitleRepository({ Title })
    });
    return registerRatingRoutes({ router: express.Router(),
        controllers: createRatingControllers({ ratingService }), requireAuth, protectMutation });
}

module.exports = { createRatingRouter, ensureRatingIndexes };
