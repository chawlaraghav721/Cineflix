"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const { connectDatabase, disconnectDatabase } = require("../config/db");
const Title = require("../models/Title");

const cataloguePath = path.resolve(__dirname, "../../../data/catalogue.json");

async function seedCatalogue(options = {}) {
    const Model = options.Model || Title;
    const catalogue = options.catalogue || JSON.parse(await fs.readFile(cataloguePath, "utf8"));
    if (!catalogue || !Array.isArray(catalogue.movies) || !Array.isArray(catalogue.shows)) {
        throw new Error("Catalogue seed data must contain movies and shows arrays.");
    }
    const titles = [...catalogue.movies, ...catalogue.shows];
    const ids = new Set();
    for (const title of titles) {
        if (!title || typeof title.id !== "string" || !title.id.trim() || ids.has(title.id)) {
            throw new Error("Catalogue seed data must have unique, non-empty IDs.");
        }
        ids.add(title.id);
    }
    const operations = titles.map(title => ({
        updateOne: {
            filter: { id: title.id },
            update: { $set: title },
            upsert: true
        }
    }));
    return operations.length ? Model.bulkWrite(operations, { ordered: true }) : { upsertedCount: 0, modifiedCount: 0 };
}

async function main() {
    await connectDatabase();
    const result = await seedCatalogue();
    console.log(`Catalogue seed complete: ${result.upsertedCount || 0} inserted, ${result.modifiedCount || 0} updated.`);
}

if (require.main === module) {
    main().catch(error => {
        console.error("Catalogue seed failed:", error.message);
        process.exitCode = 1;
    }).finally(disconnectDatabase);
}

module.exports = { seedCatalogue };
