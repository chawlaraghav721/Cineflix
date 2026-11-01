/* Dynamic TV Shows catalogue, search, genre filter and sorting. */
(function () {
    "use strict";

    document.addEventListener("DOMContentLoaded", initialiseShows);

    async function initialiseShows() {
        const grid = document.getElementById("shows-grid");
        const searchInput = document.getElementById("show-search");
        const genreFilter = document.getElementById("show-genre-filter");
        const sortSelect = document.getElementById("show-sort");
        const resetButton = document.getElementById("show-reset-filters");
        const retryButton = document.getElementById("shows-retry");
        const loadingMessage = document.getElementById("shows-loading");
        const errorMessage = document.getElementById("shows-error");
        const resultCount = document.getElementById("show-results");
        const emptyState = document.getElementById("shows-empty-state");

        if (!grid || !searchInput || !genreFilter || !sortSelect || !resetButton || !retryButton ||
            !loadingMessage || !errorMessage || !resultCount || !emptyState) {
            return;
        }

        const controls = [searchInput, genreFilter, sortSelect, resetButton];
        controls.forEach(function (control) { control.disabled = true; });

        function populateGenreOptions(shows) {
            genreFilter.replaceChildren();

            const allGenresOption = document.createElement("option");
            allGenresOption.value = "";
            allGenresOption.textContent = "All genres";
            genreFilter.appendChild(allGenresOption);

            window.CineFlixBrowseUtils.getGenres(shows).forEach(function (genre) {
                const option = document.createElement("option");
                option.value = genre;
                option.textContent = genre;
                genreFilter.appendChild(option);
            });
        }

        function createShowCard(show) {
            const card = document.createElement("a");
            card.className = "movie-card";
            card.dataset.id = show.id;
            card.href = "details.html?id=" + encodeURIComponent(show.id);
            card.setAttribute("aria-label", "View details for " + show.title);

            const poster = document.createElement("img");
            poster.alt = show.title + " poster";
            poster.loading = "lazy";
            poster.decoding = "async";

            const posterFallback = document.createElement("div");
            posterFallback.className = "movie-poster-fallback";
            posterFallback.textContent = "Poster unavailable";
            posterFallback.hidden = true;

            if (typeof show.poster === "string" && show.poster.trim()) {
                poster.src = show.poster.trim();
                poster.addEventListener("error", function () {
                    poster.hidden = true;
                    posterFallback.hidden = false;
                }, { once: true });
            } else {
                poster.hidden = true;
                posterFallback.hidden = false;
            }

            const info = document.createElement("div");
            info.className = "movie-info";

            const title = document.createElement("h3");
            title.textContent = show.title;

            const metadata = [];
            if (Number.isInteger(show.year)) {
                metadata.push(String(show.year));
            }
            if (typeof show.genre === "string" && show.genre.trim()) {
                metadata.push(show.genre.trim());
            }

            const meta = document.createElement("p");
            meta.textContent = metadata.join(" • ");

            info.append(title, meta);
            card.append(poster, posterFallback, info);
            return card;
        }

        function renderShows(shows) {
            const visibleShows = window.CineFlixBrowseUtils.getVisibleItems(shows, {
                query: searchInput.value,
                genre: genreFilter.value,
                sortBy: sortSelect.value
            });

            const cards = document.createDocumentFragment();
            visibleShows.forEach(function (show) {
                cards.appendChild(createShowCard(show));
            });
            grid.replaceChildren(cards);

            resultCount.textContent = "Showing " + visibleShows.length +
                " of " + shows.length + " TV shows";
            emptyState.hidden = visibleShows.length !== 0;
            grid.setAttribute("aria-busy", "false");
        }

        let controlsBound = false;
        let catalogueShows = [];
        const loader = window.CineFlixCatalogueBrowse.createLoader({
            type: "show",
            controls: controls,
            loadingMessage: loadingMessage,
            errorMessage: errorMessage,
            retryButton: retryButton,
            resultCount: resultCount,
            emptyState: emptyState,
            grid: grid,
            errorText: "TV shows could not be loaded. Try again.",
            unavailableText: "TV show catalogue unavailable.",
            logPrefix: "CineFlix TV Shows could not be initialised:",
            onLoaded: function (shows) {
                catalogueShows = shows;
                populateGenreOptions(catalogueShows);
                if (!controlsBound) {
                    searchInput.addEventListener("input", function () {
                        renderShows(catalogueShows);
                    });
                    genreFilter.addEventListener("change", function () {
                        renderShows(catalogueShows);
                    });
                    sortSelect.addEventListener("change", function () {
                        renderShows(catalogueShows);
                    });
                    resetButton.addEventListener("click", function () {
                        searchInput.value = "";
                        genreFilter.value = "";
                        sortSelect.value = "default";
                        renderShows(catalogueShows);
                    });
                    controlsBound = true;
                }
                renderShows(catalogueShows);
            }
        });
        loader.load();
    }
}());
