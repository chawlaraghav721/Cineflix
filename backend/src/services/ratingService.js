"use strict";
const Title = require("../models/Title");
const repository = require("../repositories/ratingRepository");
const { RatingError, validateItemId, validateRating, authenticatedId } = require("./ratingValidation");

const personalRating = row => row ? { score: row.score, reviewText: row.reviewText || "" } : null;

function createRatingService({ ratings = repository, titles = Title } = {}) {
    async function title(itemId) {
        validateItemId(itemId);
        if (!await titles.exists({ id: itemId })) throw new RatingError("TITLE_NOT_FOUND", "This catalogue title does not exist.", 404);
    }
    return {
        async list(actor) {
            return { items: await ratings.listOwn(authenticatedId(actor)) };
        },
        async summary(itemId) {
            await title(itemId);
            return ratings.community(itemId);
        },
        async own(actor, itemId) {
            const user = authenticatedId(actor);
            await title(itemId);
            return { rating: personalRating(await ratings.findOwn(user, itemId)) };
        },
        async save(actor, itemId, body) {
            const user = authenticatedId(actor);
            const values = validateRating(body);
            await title(itemId);
            const saved = await ratings.saveOwn(user, itemId, values);
            if (!saved) throw new Error("Rating write returned no saved record.");
            return personalRating(saved);
        },
        async remove(actor, itemId) {
            const user = authenticatedId(actor);
            await title(itemId);
            await ratings.removeOwn(user, itemId);
        }
    };
}
module.exports = { createRatingService };
