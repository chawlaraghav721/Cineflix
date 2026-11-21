"use strict";
const { RatingError } = require("../services/ratingService.cjs");

function createRatingControllers({ ratingService }) {
    for (const method of ["getSummary", "getOwn", "putOwn", "deleteOwn"]) {
        if (typeof ratingService?.[method] !== "function") throw new TypeError("Rating service is required.");
    }
    const handle = (action, status = 200) => async (req, res, next) => {
        res.set("Cache-Control", "no-store");
        try {
            const data = await action(req);
            return status === 204 ? res.status(204).end() : res.status(status).json(data);
        } catch (error) {
            if (error instanceof RatingError) {
                return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
            }
            return next(error); // Forward unexpected failures to the shared JSON error handler.
        }
    };
    return {
        getSummary: handle(req => ratingService.getSummary(req.params.itemId)),
        getOwn: handle(req => ratingService.getOwn(req.user, req.params.itemId)),
        putOwn: handle(req => ratingService.putOwn(req.user, req.params.itemId, req.body)),
        deleteOwn: handle(req => {
            if (req.body && (Array.isArray(req.body) || Object.keys(req.body).length)) {
                throw new RatingError("INVALID_RATING", "DELETE does not accept rating fields.");
            }
            return ratingService.deleteOwn(req.user, req.params.itemId);
        }, 204)
    };
}

module.exports = { createRatingControllers };
