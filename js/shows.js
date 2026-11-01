/* Dynamic TV Shows catalogue, search, genre filter and sorting. */
(function () {
    "use strict";

    document.addEventListener("DOMContentLoaded", initialiseShows);

    async function initialiseShows() {
        const grid = document.getElementById("shows-grid");
        const searchInput = document.getElementById("show-search");
        const genreFilter = document.getElementById("show-genre-filter");
        const sortSelect = document.getElementById("show-sort");
        const loadingMessage = document.getElementById("shows-loading");
        const errorMessage = document.getElementById("shows-error");
        const resultCount = document.getElementById("show-results");
        const emptyState = document.getElementById("shows-empty-state");

        if (!grid || !searchInput || !genreFilter || !sortSelect ||
            !loadingMessage || !errorMessage || !resultCount || !emptyState) {
            return;
        }

        const controls = [searchInput, genreFilter, sortSelect];
        controls.forEach(function (control) { control.disabled = true; });

        function showLoadError() {
            loadingMessage.hidden = true;
            errorMessage.textContent = "TV shows could not be loaded. Please refresh the page and try again.";
            errorMessage.hidden = false;
            resultCount.textContent = "TV show catalogue unavailable.";
            emptyState.hidden = true;
            grid.replaceChildren();
            grid.setAttribute("aria-busy", "false");
        }

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

        try {
            if (!window.CineFlixCatalogue ||
                typeof window.CineFlixCatalogue.loadCatalogue !== "function" ||
                !window.CineFlixBrowseUtils ||
                typeof window.CineFlixBrowseUtils.getVisibleItems !== "function") {
                throw new Error("Required CineFlix browsing scripts are unavailable.");
            }

            const catalogue = await window.CineFlixCatalogue.loadCatalogue();
            if (!catalogue || !Array.isArray(catalogue.shows)) {
                throw new Error("The TV show catalogue is invalid.");
            }

            const shows = catalogue.shows.filter(function (show) {
                return show && show.type === "show";
            });

            populateGenreOptions(shows);
            controls.forEach(function (control) { control.disabled = false; });
            loadingMessage.hidden = true;
            errorMessage.hidden = true;

            searchInput.addEventListener("input", function () {
                renderShows(shows);
            });
            genreFilter.addEventListener("change", function () {
                renderShows(shows);
            });
            sortSelect.addEventListener("change", function () {
                renderShows(shows);
            });

            renderShows(shows);
        } catch (error) {
            console.error("CineFlix TV Shows could not be initialised:", error);
            showLoadError();
        }
    }
}());
