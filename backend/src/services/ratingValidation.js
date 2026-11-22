"use strict";

class RatingError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

function validateItemId(itemId) {
    if (typeof itemId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(itemId)) {
        throw new RatingError("INVALID_ITEM_ID", "Provide a valid catalogue title ID.");
    }
    return itemId;
}

function validateRating(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => !["score", "reviewText"].includes(key))) {
        throw new RatingError("INVALID_RATING", "Send only score and optional reviewText as a JSON object.");
    }
    if (!Object.hasOwn(body, "score") || !Number.isInteger(body.score) || body.score < 1 || body.score > 5) {
        throw new RatingError("INVALID_SCORE", "Score must be an integer from 1 to 5.");
    }
    const result = { score: body.score };
    if (Object.hasOwn(body, "reviewText")) {
        if (typeof body.reviewText !== "string" || body.reviewText.length > 2000) {
            throw new RatingError("INVALID_REVIEW", "Review must be text of at most 2000 characters.");
        }
        result.reviewText = body.reviewText.trim();
    }
    return result;
}

function authenticatedId(user) {
    if (typeof user?.id !== "string" || !/^[a-f\d]{24}$/i.test(user.id)) {
        throw new RatingError("AUTH_REQUIRED", "Sign in to access your account ratings.", 401);
    }
    return user.id;
}

module.exports = { RatingError, validateItemId, validateRating, authenticatedId };
