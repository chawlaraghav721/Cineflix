"use strict";

const Title = require("../models/Title");

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
        filter.$or = ["title", "genre", "description", "director", "cast"].map(field => ({ [field]: expression }));
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

module.exports = { getCatalogue, getTitleById, queryTitles, parseQuery, publicTitle };
