/* Dynamic Movies catalogue, search, genre filter and sorting. */
(function () {
    "use strict";

    document.addEventListener("DOMContentLoaded", initialiseMovies);

    async function initialiseMovies() {
        const grid = document.getElementById("movies-grid");
        const searchInput = document.getElementById("movie-search");
        const genreFilter = document.getElementById("movie-genre-filter");
        const sortSelect = document.getElementById("movie-sort");
        const resetButton = document.getElementById("movie-reset-filters");
        const retryButton = document.getElementById("movies-retry");
        const loadingMessage = document.getElementById("movies-loading");
        const errorMessage = document.getElementById("movies-error");
        const resultCount = document.getElementById("movie-results");
        const emptyState = document.getElementById("movies-empty-state");

        if (!grid || !searchInput || !genreFilter || !sortSelect || !resetButton || !retryButton ||
            !loadingMessage || !errorMessage || !resultCount || !emptyState) {
            return;
        }

        const controls = [searchInput, genreFilter, sortSelect, resetButton];
        controls.forEach(function (control) { control.disabled = true; });

        function populateGenreOptions(movies) {
            genreFilter.replaceChildren();

            const allGenresOption = document.createElement("option");
            allGenresOption.value = "";
            allGenresOption.textContent = "All genres";
            genreFilter.appendChild(allGenresOption);

            window.CineFlixBrowseUtils.getGenres(movies).forEach(function (genre) {
                const option = document.createElement("option");
                option.value = genre;
                option.textContent = genre;
                genreFilter.appendChild(option);
            });
        }

        function createMovieCard(movie) {
            const card = document.createElement("a");
            card.className = "movie-card";
            card.dataset.id = movie.id;
            card.href = "details.html?id=" + encodeURIComponent(movie.id);
            card.setAttribute("aria-label", "View details for " + movie.title);

            const poster = document.createElement("img");
            poster.alt = movie.title + " poster";
            poster.loading = "lazy";
            poster.decoding = "async";

            const posterFallback = document.createElement("div");
            posterFallback.className = "movie-poster-fallback";
            posterFallback.textContent = "Poster unavailable";
            posterFallback.hidden = true;

            if (typeof movie.poster === "string" && movie.poster.trim()) {
                poster.src = movie.poster.trim();
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
            title.textContent = movie.title;

            const metadata = [];
            if (Number.isInteger(movie.year)) {
                metadata.push(String(movie.year));
            }
            if (typeof movie.genre === "string" && movie.genre.trim()) {
                metadata.push(movie.genre.trim());
            }

            const meta = document.createElement("p");
            meta.textContent = metadata.join(" • ");

            info.append(title, meta);
            card.append(poster, posterFallback, info);
            return card;
        }

        function renderMovies(movies) {
            const visibleMovies = window.CineFlixBrowseUtils.getVisibleItems(movies, {
                query: searchInput.value,
                genre: genreFilter.value,
                sortBy: sortSelect.value
            });

            const cards = document.createDocumentFragment();
            visibleMovies.forEach(function (movie) {
                cards.appendChild(createMovieCard(movie));
            });
            grid.replaceChildren(cards);

            resultCount.textContent = "Showing " + visibleMovies.length +
                " of " + movies.length + " movies";
            emptyState.hidden = visibleMovies.length !== 0;
            grid.setAttribute("aria-busy", "false");

            // Member 5 listens for this event to restore Movie Night selection styling.
            document.dispatchEvent(new Event("cineflix:movies-rendered"));
        }

        let controlsBound = false;
        let catalogueMovies = [];
        const loader = window.CineFlixCatalogueBrowse.createLoader({
            type: "movie",
            controls: controls,
            loadingMessage: loadingMessage,
            errorMessage: errorMessage,
            retryButton: retryButton,
            resultCount: resultCount,
            emptyState: emptyState,
            grid: grid,
            errorText: "Movies could not be loaded. Try again.",
            unavailableText: "Movie catalogue unavailable.",
            logPrefix: "CineFlix Movies could not be initialised:",
            onLoaded: function (movies) {
                catalogueMovies = movies;
                populateGenreOptions(catalogueMovies);
                if (!controlsBound) {
                    searchInput.addEventListener("input", function () {
                        renderMovies(catalogueMovies);
                    });
                    genreFilter.addEventListener("change", function () {
                        renderMovies(catalogueMovies);
                    });
                    sortSelect.addEventListener("change", function () {
                        renderMovies(catalogueMovies);
                    });
                    resetButton.addEventListener("click", function () {
                        searchInput.value = "";
                        genreFilter.value = "";
                        sortSelect.value = "default";
                        renderMovies(catalogueMovies);
                    });
                    controlsBound = true;
                }
                renderMovies(catalogueMovies);
            }
        });
        loader.load();
    }
}());
