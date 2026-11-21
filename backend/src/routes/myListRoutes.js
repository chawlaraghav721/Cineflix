"use strict";
const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { protectMutation } = require("../middleware/protectMutation");
const controller = require("../controllers/myListController");
const { validItemId } = require("../services/watchlistValidation");

const router = express.Router();
router.use(requireAuth, protectMutation);
router.param("itemId", (req, res, next, value) => validItemId(value) ? next()
    : controller.fail(res, 400, "INVALID_ITEM_ID", "Provide a valid catalogue itemId."));
router.get("/", controller.getMyList);
router.post("/", controller.addMyList);
router.patch("/:itemId", controller.updateMyList);
router.delete("/:itemId", controller.removeMyList);
module.exports = router;
