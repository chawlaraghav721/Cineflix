"use strict";
const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { protectMutation } = require("../middleware/protectMutation");
const controller = require("../controllers/myListController");

const router = express.Router();
router.use(requireAuth, protectMutation);
router.get("/", controller.getMyList);
router.post("/", controller.addMyList);
module.exports = router;
