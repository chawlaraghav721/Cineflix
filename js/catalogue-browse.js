/* Shared catalogue loading and retry states for Movies and TV Shows. */
(function (root, factory) {
    const catalogueBrowse = factory(root);

    if (typeof module === "object" && module.exports) {
        module.exports = catalogueBrowse;
    }
    if (root) {
        root.CineFlixCatalogueBrowse = catalogueBrowse;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
    "use strict";

    function createLoader(options) {
        const settings = options || {};
        const browserWindow = root.window || root;
        const collectionName = settings.type === "movie" ? "movies" : "shows";
        let loading = false;

        async function load() {
            if (loading) return;
            loading = true;
            settings.controls.forEach(function (control) { control.disabled = true; });
            settings.retryButton.disabled = true;
            settings.retryButton.hidden = true;
            settings.loadingMessage.hidden = false;
            settings.errorMessage.hidden = true;
            settings.resultCount.textContent = "";
            settings.emptyState.hidden = true;
            settings.grid.replaceChildren();
            settings.grid.setAttribute("aria-busy", "true");

            try {
                if (!browserWindow.CineFlixCatalogue ||
                    typeof browserWindow.CineFlixCatalogue.loadCatalogue !== "function") {
                    throw new Error("The CineFlix catalogue loader is unavailable.");
                }

                const catalogue = await browserWindow.CineFlixCatalogue.loadCatalogue();
                if (!catalogue || !Array.isArray(catalogue[collectionName])) {
                    throw new Error("The " + collectionName + " catalogue is invalid.");
                }

                const items = catalogue[collectionName].filter(function (item) {
                    return item && item.type === settings.type;
                });
                settings.onLoaded(items);
                settings.loadingMessage.hidden = true;
                settings.errorMessage.hidden = true;
                settings.retryButton.disabled = true;
                settings.retryButton.hidden = true;
                settings.controls.forEach(function (control) { control.disabled = false; });
            } catch (error) {
                console.error(settings.logPrefix || "CineFlix catalogue could not be loaded:", error);
                settings.loadingMessage.hidden = true;
                settings.errorMessage.textContent = settings.errorText;
                settings.errorMessage.hidden = false;
                settings.resultCount.textContent = settings.unavailableText;
                settings.emptyState.hidden = true;
                settings.grid.replaceChildren();
                settings.grid.setAttribute("aria-busy", "false");
                settings.retryButton.disabled = false;
                settings.retryButton.hidden = false;
                settings.controls.forEach(function (control) { control.disabled = true; });
            } finally {
                loading = false;
            }
        }

        settings.retryButton.addEventListener("click", load);
        return Object.freeze({ load: load });
    }

    return Object.freeze({ createLoader: createLoader });
});
