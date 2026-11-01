(function () {
    "use strict";

    let cataloguePromise = null;

    function validateCatalogue(catalogue) {
        if (!catalogue || !Array.isArray(catalogue.movies) || !Array.isArray(catalogue.shows)) {
            throw new Error("The catalogue must contain movies and shows arrays.");
        }

        const ids = new Set();
        for (const type of ["movie", "show"]) {
            for (const item of catalogue[type + "s"]) {
                if (!item || typeof item !== "object" || Array.isArray(item) || item.type !== type) {
                    throw new Error("Invalid " + type + " catalogue item.");
                }
                for (const field of ["id", "title", "genre", "poster", "description"]) {
                    if (typeof item[field] !== "string") {
                        throw new Error("Catalogue field " + field + " must be a string.");
                    }
                }
                if (!item.id.trim() || item.id !== item.id.trim() || !item.title.trim() || ids.has(item.id)) {
                    throw new Error("Catalogue IDs must be non-empty and globally unique; titles must be non-empty.");
                }
                if (item.year !== undefined && (!Number.isInteger(item.year) || item.year <= 0)) {
                    throw new Error("Catalogue years must be positive integers when provided.");
                }
                if (item.rating !== undefined && (typeof item.rating !== "number" || !Number.isFinite(item.rating))) {
                    throw new Error("Catalogue ratings must be numbers when provided.");
                }
                if (item.cast !== undefined && (!Array.isArray(item.cast) || item.cast.some(name => typeof name !== "string"))) {
                    throw new Error("Catalogue cast must be an array of names when provided.");
                }
                for (const field of ["director", "duration", "trailerUrl"]) {
                    if (item[field] !== undefined && typeof item[field] !== "string") {
                        throw new Error("Catalogue field " + field + " must be a string when provided.");
                    }
                }
                ids.add(item.id);
            }
        }
        return catalogue;
    }

    function loadCatalogue() {
        if (!cataloguePromise) {
            cataloguePromise = Promise.resolve()
                .then(() => fetch("data/catalogue.json"))
                .then(response => {
                    if (!response.ok) {
                        throw new Error("Unable to load the catalogue (HTTP " + response.status + ").");
                    }
                    return response.json().catch(() => {
                        throw new Error("The catalogue contains invalid JSON.");
                    });
                })
                .then(validateCatalogue)
                .catch(error => {
                    cataloguePromise = null;
                    throw error;
                });
        }
        return cataloguePromise;
    }

    function getAllItems(catalogue) {
        return [...catalogue.movies, ...catalogue.shows];
    }

    function getItemById(catalogue, id) {
        if (typeof id !== "string" || !id.trim()) return null;
        return getAllItems(catalogue).find(item => item.id === id) || null;
    }

    window.CineFlixCatalogue = { loadCatalogue, getAllItems, getItemById };
}());
