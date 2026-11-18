"use strict";

const express = require("express");
const controller = require("../controllers/titleController");

const router = express.Router();
router.get("/catalogue", controller.getCatalogue);
router.get("/titles", controller.queryTitles);
router.get("/titles/:itemId", controller.getTitleById);

module.exports = router;
