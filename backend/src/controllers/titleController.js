"use strict";

const Title = require("../models/Title");

const TITLE_FIELDS = Object.freeze(["id", "type", "title", "genre", "poster", "description", "year", "rating", "cast", "director", "duration", "trailerUrl"]);
const CREATE_FIELDS = new Set(TITLE_FIELDS);
const UPDATE_FIELDS = new Set(TITLE_FIELDS.filter(field => field !== "id"));
const STABLE_ID = /^(movie|show)-[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const STRING_LIMITS = Object.freeze({
    title: 200,
    genre: 100,
    poster: 2048,
    description: 10000,
    director: 200,
    duration: 80,
    trailerUrl: 2048
});

const SORTS = {
    title_asc: { title: 1, id: 1 },
    title_desc: { title: -1, id: 1 },
    year_asc: { year: 1, title: 1, id: 1 },
    year_desc: { year: -1, title: 1, id: 1 }
};

function publicTitle(document) {
    if (!document) return document;
    const value = typeof document.toObject === "function" ? document.toObject() : { ...document };
    delete value._id;
    delete value.createdAt;
    delete value.updatedAt;
    delete value.__v;
    return value;
}

function errorResponse(res, status, code, message) {
    return res.status(status).json({ error: { code, message } });
}

function validWebUrl(value) {
    try {
        const parsed = new URL(value);
        return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch { return false; }
}

function validateStableId(itemId) {
    return typeof itemId === "string" && itemId.length <= 128 && STABLE_ID.test(itemId);
}

function validateTitleInput(body, { partial = false } = {}) {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
        return { error: "The request body must be a JSON object." };
    }
    const fields = partial ? UPDATE_FIELDS : CREATE_FIELDS;
    const keys = Object.keys(body);
    for (const key of keys) {
        if (key === "id" && partial) return { error: "The stable catalogue id cannot be changed." };
        if (key.startsWith("$") || key.includes(".")) return { error: "MongoDB operators and dotted field names are not allowed." };
        if (!fields.has(key)) return { error: `Unexpected title field: ${key}.` };
    }
    if (partial && keys.length === 0) return { error: "Provide at least one supported field to update." };

    const value = {};
    if (!partial) {
        for (const key of ["id", "type", "title", "genre", "poster"]) {
            if (!Object.hasOwn(body, key)) return { error: `${key} is required.` };
        }
    }

    for (const [field, max] of Object.entries(STRING_LIMITS)) {
        if (!Object.hasOwn(body, field)) continue;
        const raw = body[field];
        if (typeof raw !== "string") return { error: `${field} must be a string.` };
        const normalized = raw.trim();
        if (normalized.length > max) return { error: `${field} must be no more than ${max} characters.` };
        if (["title", "genre", "poster"].includes(field) && normalized.length === 0) return { error: `${field} cannot be empty.` };
        if (field === "poster" && !(normalized.startsWith("/") && !normalized.startsWith("//") && !normalized.includes("\\")) && !validWebUrl(normalized)) {
            return { error: "poster must be an HTTP(S) URL or a root-relative path." };
        }
        if (field === "trailerUrl" && normalized && !validWebUrl(normalized)) return { error: "trailerUrl must be an HTTP(S) URL or an empty string." };
        value[field] = normalized;
    }

    if (Object.hasOwn(body, "id")) {
        if (typeof body.id !== "string" || body.id !== body.id.trim() || body.id.length > 128 || !STABLE_ID.test(body.id)) {
            return { error: "id must be a stable movie-... or show-... catalogue ID." };
        }
        value.id = body.id;
    }
    if (Object.hasOwn(body, "type")) {
        if (typeof body.type !== "string" || !["movie", "show"].includes(body.type)) return { error: "type must be movie or show." };
        value.type = body.type;
    }
    if (Object.hasOwn(body, "year")) {
        if (typeof body.year !== "number" || !Number.isSafeInteger(body.year) || body.year < 1 || body.year > 3000) {
            return { error: "year must be an integer between 1 and 3000." };
        }
        value.year = body.year;
    }
    if (Object.hasOwn(body, "rating")) {
        if (typeof body.rating !== "number" || !Number.isFinite(body.rating) || body.rating < 0 || body.rating > 10) {
            return { error: "rating must be a number between 0 and 10." };
        }
        value.rating = body.rating;
    }
    if (Object.hasOwn(body, "cast")) {
        if (!Array.isArray(body.cast) || body.cast.length > 50) return { error: "cast must be an array with no more than 50 names." };
        const cast = [];
        for (const name of body.cast) {
            if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
                return { error: "Each cast entry must be a non-empty string of at most 120 characters." };
            }
            cast.push(name.trim());
        }
        value.cast = cast;
    }

    if (!partial) {
        if (value.type && value.id && !value.id.toLowerCase().startsWith(value.type + "-")) {
            return { error: "id prefix must match type (movie- or show-)." };
        }
        value.description = Object.hasOwn(value, "description") ? value.description : "";
    }
    return { value };
}

function handleWriteError(res, error) {
    if (error && error.code === 11000) return errorResponse(res, 409, "DUPLICATE_TITLE_ID", "A title with that stable catalogue id already exists.");
    if (error && (error.name === "ValidationError" || error.name === "CastError" || error.name === "StrictModeError")) {
        return errorResponse(res, 400, "INVALID_TITLE", "The title fields do not satisfy the catalogue schema.");
    }
    return null;
}

async function createTitle(req, res, next) {
    const parsed = validateTitleInput(req.body);
    if (parsed.error) return errorResponse(res, 400, "INVALID_TITLE", parsed.error);
    try {
        const created = await Title.create(parsed.value);
        return res.status(201).json(publicTitle(created));
    } catch (error) {
        const response = handleWriteError(res, error);
        return response || next(error);
    }
}

async function updateTitle(req, res, next) {
    const itemId = req.params.itemId;
    if (!validateStableId(itemId)) return errorResponse(res, 400, "INVALID_ITEM_ID", "itemId must be a stable movie-... or show-... catalogue ID.");
    const parsed = validateTitleInput(req.body, { partial: true });
    if (parsed.error) return errorResponse(res, 400, "INVALID_TITLE", parsed.error);
    if (parsed.value.type && !itemId.toLowerCase().startsWith(parsed.value.type + "-")) {
        return errorResponse(res, 400, "INVALID_TITLE", "type must match the stable itemId prefix.");
    }
    try {
        const updated = await Title.findOneAndUpdate({ id: itemId }, { $set: parsed.value }, {
            new: true,
            runValidators: true,
            context: "query",
            strict: "throw"
        }).lean();
        if (!updated) return errorResponse(res, 404, "TITLE_NOT_FOUND", "No catalogue title has that ID.");
        return res.json(publicTitle(updated));
    } catch (error) {
        const response = handleWriteError(res, error);
        return response || next(error);
    }
}

async function deleteTitle(req, res, next) {
    const itemId = req.params.itemId;
    if (!validateStableId(itemId)) return errorResponse(res, 400, "INVALID_ITEM_ID", "itemId must be a stable movie-... or show-... catalogue ID.");
    try {
        const result = await Title.deleteOne({ id: itemId });
        if (result.deletedCount === 0) return errorResponse(res, 404, "TITLE_NOT_FOUND", "No catalogue title has that ID.");
        return res.status(204).end();
    } catch (error) { return next(error); }
}

async function getCatalogue(req, res, next) {
    try {
        const [movies, shows] = await Promise.all([
            Title.find({ type: "movie" }).sort({ id: 1 }).lean(),
            Title.find({ type: "show" }).sort({ id: 1 }).lean()
        ]);
        return res.json({ movies: movies.map(publicTitle), shows: shows.map(publicTitle) });
    } catch (error) { return next(error); }
}

async function getTitleById(req, res, next) {
    const itemId = req.params.itemId;
    if (typeof itemId !== "string" || !itemId.trim() || itemId !== itemId.trim() || itemId.length > 128) {
        return errorResponse(res, 400, "INVALID_ITEM_ID", "itemId must be a non-empty catalogue ID of at most 128 characters.");
    }
    try {
        const title = await Title.findOne({ id: itemId }).lean();
        if (!title) return errorResponse(res, 404, "TITLE_NOT_FOUND", "No catalogue title has that ID.");
        return res.json(publicTitle(title));
    } catch (error) { return next(error); }
}

function parseQuery(query) {
    const allowed = new Set(["type", "q", "genre", "sort", "page", "limit"]);
    for (const key of Object.keys(query)) {
        if (!allowed.has(key) || Array.isArray(query[key])) return { error: "Unsupported or repeated query parameter: " + key + "." };
    }
    if (query.type !== undefined && !["movie", "show"].includes(query.type)) return { error: "type must be movie or show." };
    for (const key of ["q", "genre"]) {
        if (query[key] !== undefined && (typeof query[key] !== "string" || query[key].length > 100)) return { error: key + " must be at most 100 characters." };
    }
    if (query.sort !== undefined && !Object.hasOwn(SORTS, query.sort)) return { error: "sort must be title_asc, title_desc, year_asc, or year_desc." };
    function positiveInteger(value, key, fallback, max) {
        if (value === undefined) return fallback;
        if (!/^\d+$/.test(value)) return null;
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 && (!max || number <= max) ? number : null;
    }
    const page = positiveInteger(query.page, "page", 1);
    const limit = positiveInteger(query.limit, "limit", 12, 50);
    if (page === null) return { error: "page must be a positive integer." };
    if (limit === null) return { error: "limit must be an integer between 1 and 50." };
    return { type: query.type, q: query.q, genre: query.genre, sort: query.sort || "title_asc", page, limit };
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function queryTitles(req, res, next) {
    const options = parseQuery(req.query);
    if (options.error) return errorResponse(res, 400, "INVALID_QUERY", options.error);
    const filter = {};
    if (options.type) filter.type = options.type;
    if (options.q && options.q.trim()) {
        const expression = new RegExp(escapeRegex(options.q.trim()), "i");
        filter.$or = ["id", "title", "genre", "description", "director", "cast"].map(field => ({ [field]: expression }));
    }
    if (options.genre && options.genre.trim()) {
        filter.genre = new RegExp("(^|\\s/\\s)" + escapeRegex(options.genre.trim()) + "(\\s/\\s|$)", "i");
    }
    try {
        const offset = (options.page - 1) * options.limit;
        const itemsPromise = options.sort.startsWith("year_")
            ? Title.aggregate([
                { $match: filter },
                { $addFields: { __yearMissing: { $cond: [{ $in: [{ $type: "$year" }, ["missing", "null"]] }, 1, 0] } } },
                { $sort: { __yearMissing: 1, year: SORTS[options.sort].year, title: 1, id: 1 } },
                { $skip: offset },
                { $limit: options.limit },
                { $project: { __yearMissing: 0 } }
            ])
            : Title.find(filter).sort(SORTS[options.sort]).skip(offset).limit(options.limit).lean();
        const [items, total] = await Promise.all([itemsPromise, Title.countDocuments(filter)]);
        return res.json({ items: items.map(publicTitle), total, page: options.page, limit: options.limit });
    } catch (error) { return next(error); }
}

module.exports = { getCatalogue, getTitleById, queryTitles, createTitle, updateTitle, deleteTitle, parseQuery, publicTitle, validateTitleInput, validateStableId };
