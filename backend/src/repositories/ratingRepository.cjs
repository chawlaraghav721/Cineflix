"use strict";

const REVIEW_LIMIT = 20;
const ownProjection = { _id: 0, score: 1, reviewText: 1 };

function createRatingRepository({ Rating }) {
    if (!Rating) throw new TypeError("Shared-connection Rating model is required.");
    const scope = ({ user, itemId }) => ({ user, itemId });
    const values = input => ({ score: input.score,
        ...(input.reviewText === undefined ? {} : { reviewText: input.reviewText }) });
    const update = (filter, input, upsert) => Rating.findOneAndUpdate(filter, { $set: values(input) }, {
        upsert, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true,
        projection: ownProjection
    }).lean().exec();
    return {
        findOwn: filter => Rating.findOne(scope(filter), ownProjection).lean().exec(),
        async upsertOwn(filter, input) {
            const owned = scope(filter);
            try {
                return await update(owned, input, true);
            } catch (error) {
                // Concurrent first PUTs can race the unique key. Retry once as an
                // update only; never insert again or touch another user's row.
                if (error.code !== 11000 || !error.keyPattern?.user || !error.keyPattern?.itemId) throw error;
                const saved = await update(owned, input, false);
                if (!saved) throw error;
                return saved;
            }
        },
        deleteOwn: filter => Rating.deleteOne(scope(filter)).exec(),
        async summary(itemId) {
            // One pipeline: count/average include ALL scores, even empty reviews.
            // Public reviews are bounded and never expose user IDs/emails or _id.
            const [result] = await Rating.aggregate([
                { $match: { itemId } },
                { $facet: {
                    totals: [{ $group: { _id: null, average: { $avg: "$score" }, count: { $sum: 1 } } }],
                    reviews: [
                        { $match: { reviewText: { $type: "string", $ne: "" } } },
                        { $sort: { updatedAt: -1, _id: -1 } }, { $limit: REVIEW_LIMIT },
                        { $project: { _id: 0, score: 1, reviewText: 1, createdAt: 1, updatedAt: 1 } }
                    ]
                } }
            ]).exec();
            return { average: result?.totals[0]?.average ?? null, count: result?.totals[0]?.count ?? 0,
                reviews: result?.reviews ?? [] };
        }
    };
}

function createRatingTitleRepository({ Title }) {
    if (!Title) throw new TypeError("Member 1's Title model is required.");
    return { exists: async itemId => Boolean(await Title.exists({ id: itemId }).exec()) };
}

module.exports = { createRatingRepository, createRatingTitleRepository, REVIEW_LIMIT };
