/* Shared, data-source-independent utilities for Movies and TV Shows browsing. */
(function (root, factory) {
    const browseUtils = factory();

    // Expose the same API to browser scripts and Node's built-in test runner.
    if (typeof module === "object" && module.exports) {
        module.exports = browseUtils;
    }

    if (root) {
        root.CineFlixBrowseUtils = browseUtils;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const collator = new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: "base"
    });

    // Keep this list aligned with the optional fields in the shared catalogue contract.
    const SEARCH_FIELDS = [
        "title",
        "year",
        "genre",
        "description",
        "rating",
        "cast",
        "director",
        "duration"
    ];

    /** Convert supported catalogue values to searchable text without stringifying objects. */
    function valueToText(value) {
        if (value === null || value === undefined) {
            return "";
        }

        if (Array.isArray(value)) {
            return value.map(valueToText).filter(Boolean).join(" ");
        }

        if (typeof value === "string" || typeof value === "number") {
            return String(value);
        }

        return "";
    }

    function normalizeText(value) {
        return valueToText(value).trim().toLocaleLowerCase();
    }

    /**
     * Catalogue genre values are strings. A slash, comma, pipe or semicolon
     * separates multiple labels, e.g. "Drama/Horror" becomes two genres.
     */
    function splitGenres(genreValue) {
        if (typeof genreValue !== "string") {
            return [];
        }

        return genreValue
            .split(/[,/|;]/)
            .map(function (genre) { return genre.trim(); })
            .filter(Boolean);
    }

    /** Return unique genre labels found in the supplied catalogue items. */
    function getGenres(items) {
        if (!Array.isArray(items)) {
            return [];
        }

        const labelsByNormalizedValue = new Map();

        items.forEach(function (item) {
            if (!item || typeof item !== "object") {
                return;
            }

            splitGenres(item.genre).forEach(function (genre) {
                const normalizedGenre = normalizeText(genre);
                if (normalizedGenre && !labelsByNormalizedValue.has(normalizedGenre)) {
                    labelsByNormalizedValue.set(normalizedGenre, genre);
                }
            });
        });

        return Array.from(labelsByNormalizedValue.values()).sort(collator.compare);
    }

    /** Search title and known catalogue metadata using a case-insensitive substring match. */
    function matchesSearch(item, query) {
        const normalizedQuery = normalizeText(query);
        if (!normalizedQuery) {
            return true;
        }

        if (!item || typeof item !== "object") {
            return false;
        }

        const searchableText = SEARCH_FIELDS
            .map(function (field) { return valueToText(item[field]); })
            .join(" ")
            .toLocaleLowerCase();

        return searchableText.includes(normalizedQuery);
    }

    /** Match a selected genre against complete labels, not partial substrings. */
    function matchesGenre(item, selectedGenre) {
        const normalizedSelection = normalizeText(selectedGenre);
        if (!normalizedSelection) {
            return true;
        }

        return splitGenres(item && item.genre).some(function (genre) {
            return normalizeText(genre) === normalizedSelection;
        });
    }

    /** Apply search and genre filtering without modifying the source array. */
    function filterItems(items, options) {
        const sourceItems = Array.isArray(items) ? items : [];
        const settings = options && typeof options === "object" ? options : {};

        return sourceItems.filter(function (item) {
            return Boolean(item && typeof item === "object") &&
                matchesSearch(item, settings.query) &&
                matchesGenre(item, settings.genre);
        });
    }

    function toValidYear(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const year = Number(value);
        return Number.isFinite(year) ? year : null;
    }

    /** Sort a copy; missing or invalid years always remain at the end. */
    function sortItems(items, sortBy) {
        const sourceItems = Array.isArray(items) ? items : [];
        const sortMode = typeof sortBy === "string" ? sortBy : "default";

        if (sortMode === "default") {
            return sourceItems.slice();
        }

        const sortDirections = {
            "title-asc": { field: "title", direction: 1 },
            "title-desc": { field: "title", direction: -1 },
            "year-asc": { field: "year", direction: 1 },
            "year-desc": { field: "year", direction: -1 }
        };
        const settings = sortDirections[sortMode];

        if (!settings) {
            return sourceItems.slice();
        }

        return sourceItems
            .map(function (item, originalIndex) {
                return { item: item, originalIndex: originalIndex };
            })
            .sort(function (left, right) {
                let comparison = 0;

                if (settings.field === "year") {
                    const leftYear = toValidYear(left.item && left.item.year);
                    const rightYear = toValidYear(right.item && right.item.year);

                    // Keep missing/invalid years last in both ascending and descending sorts.
                    if (leftYear === null && rightYear !== null) return 1;
                    if (leftYear !== null && rightYear === null) return -1;
                    if (leftYear !== null && rightYear !== null) {
                        comparison = leftYear - rightYear;
                    }
                } else {
                    comparison = collator.compare(
                        valueToText(left.item && left.item.title),
                        valueToText(right.item && right.item.title)
                    );
                }

                if (comparison === 0) {
                    return left.originalIndex - right.originalIndex;
                }

                return comparison * settings.direction;
            })
            .map(function (entry) { return entry.item; });
    }

    /**
     * Full browsing pipeline: search -> exact genre match -> sort.
     * The caller supplies the already type-scoped movies or shows array.
     */
    function getVisibleItems(items, options) {
        const settings = options && typeof options === "object" ? options : {};
        const filteredItems = filterItems(items, settings);
        return sortItems(filteredItems, settings.sortBy || "default");
    }

    return Object.freeze({
        getGenres: getGenres,
        matchesSearch: matchesSearch,
        matchesGenre: matchesGenre,
        filterItems: filterItems,
        sortItems: sortItems,
        getVisibleItems: getVisibleItems
    });
});
