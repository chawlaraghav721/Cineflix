(function () {
    "use strict";

    const STORAGE_KEY = "cineflixMyList";

    // Keep IDs unchanged. The caller checks whether they exist in the catalogue.
    function isValidId(id) {
        return typeof id === "string" && id.length > 0 && id === id.trim();
    }

    function readIds() {
        let saved;
        try {
            saved = window.localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            // A failed read must not lead to overwriting an existing list.
            return null;
        }

        try {
            const ids = JSON.parse(saved);
            if (!Array.isArray(ids)) return [];
            return [...new Set(ids.filter(isValidId))];
        } catch (error) {
            // Missing or malformed data is treated as an empty list.
            return [];
        }
    }

    function saveIds(ids) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
        } catch (error) {
            return false;
        }

        window.dispatchEvent(new Event("cineflix:list-updated"));
        return true;
    }

    function getMyListIds() {
        return readIds() || [];
    }

    function addToMyList(id) {
        if (!isValidId(id)) return false;
        const ids = readIds();
        if (ids === null || ids.includes(id)) return false;
        ids.push(id);
        return saveIds(ids);
    }

    function removeFromMyList(id) {
        if (!isValidId(id)) return false;
        const ids = readIds();
        if (ids === null || !ids.includes(id)) return false;
        return saveIds(ids.filter(savedId => savedId !== id));
    }

    function clearMyList() {
        const ids = readIds();
        if (ids === null || ids.length === 0) return false;
        return saveIds([]);
    }

    function isInMyList(id) {
        return isValidId(id) && getMyListIds().includes(id);
    }

    window.CineFlixMyList = {
        getMyListIds,
        addToMyList,
        removeFromMyList,
        clearMyList,
        isInMyList
    };
}());
