"use strict";

const express = require("express");
const controller = require("../controllers/titleController");
const { requireAuth } = require("../middleware/requireAuth");
const { protectMutation } = require("../middleware/protectMutation");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();
router.get("/catalogue", controller.getCatalogue);
router.get("/titles", controller.queryTitles);
router.get("/titles/:itemId", controller.getTitleById);
router.post("/titles", requireAuth, protectMutation, requireAdmin, controller.createTitle);
router.patch("/titles/:itemId", requireAuth, protectMutation, requireAdmin, controller.updateTitle);
router.delete("/titles/:itemId", requireAuth, protectMutation, requireAdmin, controller.deleteTitle);

module.exports = router;
