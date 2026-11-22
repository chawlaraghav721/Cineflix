"use strict";
const { createRatingService } = require("../services/ratingService");
const { RatingError } = require("../services/ratingValidation");
const service = createRatingService();

function handle(work, status = 200) {
    return async (req, res, next) => {
        try {
            const result = await work(req);
            return status === 204 ? res.status(204).end() : res.status(status).json(result);
        } catch (error) {
            if (error instanceof RatingError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
            return next(error);
        }
    };
}

exports.summary = handle(req => service.summary(req.params.itemId));
exports.list = handle(req => service.list(req.user));
exports.own = handle(req => service.own(req.user, req.params.itemId));
exports.save = handle(req => service.save(req.user, req.params.itemId, req.body));
exports.remove = handle(req => {
    if (req.body && (Array.isArray(req.body) || Object.keys(req.body).length)) {
        throw new RatingError("INVALID_RATING", "DELETE does not accept rating fields.");
    }
    return service.remove(req.user, req.params.itemId);
}, 204);
