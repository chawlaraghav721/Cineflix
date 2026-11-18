"use strict";

const MAX_REVIEW_LENGTH = 2000;

class RatingError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}

function validateItemId(itemId) {
    // Stable catalogue IDs, never a Title ObjectId. Existence is checked separately.
    if (typeof itemId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(itemId)) {
        throw new RatingError("INVALID_ITEM_ID", "Provide a valid catalogue itemId.");
    }
    return itemId;
}

function requireUserId(actor) {
    // Check actor shape; requireAuth must verify req.user before this service runs.
    if (typeof actor?.id !== "string" || !/^[a-f\d]{24}$/i.test(actor.id)) {
        throw new RatingError("AUTH_REQUIRED", "Sign in to manage your rating.", 401);
    }
    return actor.id;
}

function validateRating(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(key => !["score", "reviewText"].includes(key))) {
        throw new RatingError("INVALID_RATING", "Provide only score and optional reviewText.");
    }
    if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
        throw new RatingError("INVALID_SCORE", "Score must be an integer from 1 to 5.");
    }
    if (input.reviewText !== undefined &&
        (typeof input.reviewText !== "string" || input.reviewText.length > MAX_REVIEW_LENGTH)) {
        throw new RatingError("INVALID_REVIEW", "Review must be text of at most 2000 characters.");
    }
    return { score: input.score, ...(input.reviewText === undefined ? {} : { reviewText: input.reviewText.trim() }) };
}

function ratingDto(record) {
    return record ? { score: record.score, reviewText: record.reviewText || "" } : null;
}

function createRatingService({ ratingRepository, titleRepository }) {
    for (const method of ["findOwn", "upsertOwn", "deleteOwn", "summary"]) {
        if (typeof ratingRepository?.[method] !== "function") throw new TypeError("Rating repository is required.");
    }
    if (typeof titleRepository?.exists !== "function") throw new TypeError("Trusted title repository is required.");

    async function existingItem(itemId) {
        validateItemId(itemId);
        if (!await titleRepository.exists(itemId)) {
            throw new RatingError("TITLE_NOT_FOUND", "This catalogue title does not exist.", 404);
        }
    }

    return {
        async getSummary(itemId) {
            await existingItem(itemId);
            return ratingRepository.summary(itemId);
        },
        async getOwn(actor, itemId) {
            const user = requireUserId(actor);
            await existingItem(itemId);
            return { rating: ratingDto(await ratingRepository.findOwn({ user, itemId })) };
        },
        async putOwn(actor, itemId, input) {
            const user = requireUserId(actor);
            const values = validateRating(input);
            await existingItem(itemId);
            // PUT returns the saved rating directly, per the shared endpoint table.
            return ratingDto(await ratingRepository.upsertOwn({ user, itemId }, values));
        },
        async deleteOwn(actor, itemId) {
            const user = requireUserId(actor);
            await existingItem(itemId);
            await ratingRepository.deleteOwn({ user, itemId });
        }
    };
}

module.exports = { createRatingService, RatingError, validateRating, validateItemId, requireUserId, MAX_REVIEW_LENGTH };
