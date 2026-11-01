(function () {
    "use strict";

    const catalogueApi = window.CineFlixCatalogue;
    const hero = document.getElementById("home-featured");
    const title = document.getElementById("featured-title");
    const meta = document.getElementById("featured-meta");
    const description = document.getElementById("featured-description");
    const watch = document.getElementById("featured-watch");
    const details = document.getElementById("featured-details");
    const position = document.getElementById("featured-position");
    const status = document.getElementById("home-status");
    const retry = document.getElementById("home-retry");
    const previous = document.getElementById("featured-previous");
    const next = document.getElementById("featured-next");
    const surprise = document.getElementById("featured-surprise");
    const sections = [
        { grid: document.getElementById("trending-grid"), ids: ["movie-001", "movie-002", "movie-003", "movie-004", "movie-005"] },
        { grid: document.getElementById("popular-grid"), ids: ["movie-006", "movie-007", "movie-008", "movie-009", "movie-010"] }
    ];
    let featuredMovies = [];
    let featuredIndex = 0;

    function detailsUrl(item) {
        return "details.html?id=" + encodeURIComponent(item.id);
    }

    function metadata(item) {
        return [item.year || "Year unavailable", item.duration, item.genre || "Genre unavailable"]
            .filter(Boolean).join(" • ");
    }

    function gridMessage(grid, message) {
        const feedback = document.createElement("p");
        feedback.className = "home-grid-message";
        feedback.textContent = message;
        grid.replaceChildren(feedback);
    }

    function posterFallback(item) {
        const fallback = document.createElement("div");
        fallback.className = "home-poster-fallback";
        fallback.setAttribute("role", "img");
        fallback.setAttribute("aria-label", "Poster unavailable for " + item.title);
        fallback.textContent = "Poster unavailable";
        return fallback;
    }

    function makePoster(item) {
        try {
            if (!item.poster.trim()) return posterFallback(item);
            const url = new URL(item.poster, document.baseURI);
            if (!["http:", "https:"].includes(url.protocol)) return posterFallback(item);
        } catch (error) {
            return posterFallback(item);
        }
        const image = document.createElement("img");
        image.alt = item.title + " poster";
        image.loading = "lazy";
        image.addEventListener("error", () => image.replaceWith(posterFallback(item)), { once: true });
        image.src = item.poster;
        return image;
    }

    function makeCard(item) {
        const card = document.createElement("a");
        card.className = "movie-card";
        card.dataset.id = item.id;
        card.href = detailsUrl(item);
        const info = document.createElement("div");
        info.className = "movie-info";
        const heading = document.createElement("h3");
        heading.textContent = item.title;
        const infoText = document.createElement("p");
        infoText.textContent = metadata(item);
        info.append(heading, infoText);
        card.append(makePoster(item), info);
        return card;
    }

    function renderFeatured() {
        const item = featuredMovies[featuredIndex];
        title.textContent = item.title;
        meta.textContent = metadata(item);
        description.textContent = item.description || "Description unavailable for this movie.";
        details.href = detailsUrl(item);
        details.hidden = false;
        watch.href = detailsUrl(item);
        watch.hidden = false;
        position.textContent = "Featured movie " + (featuredIndex + 1) + " of " + featuredMovies.length + ": " + item.title;
        previous.disabled = next.disabled = featuredMovies.length < 2;
        surprise.disabled = false;
    }

    function moveFeatured(offset) {
        if (!featuredMovies.length) return;
        featuredIndex = (featuredIndex + offset + featuredMovies.length) % featuredMovies.length;
        renderFeatured();
    }

    previous.addEventListener("click", () => moveFeatured(-1));
    next.addEventListener("click", () => moveFeatured(1));
    surprise.addEventListener("click", () => {
        if (!featuredMovies.length) return;
        // Choose a different movie whenever more than one is available.
        moveFeatured(featuredMovies.length > 1 ? 1 + Math.floor(Math.random() * (featuredMovies.length - 1)) : 0);
    });

    async function loadHome() {
        retry.hidden = true;
        status.textContent = "Loading movies…";
        hero.setAttribute("aria-busy", "true");
        title.textContent = "Featured movies";
        meta.textContent = "";
        description.textContent = "Loading featured movies…";
        details.hidden = true;
        watch.hidden = true;
        position.textContent = "";
        featuredMovies = [];
        previous.disabled = next.disabled = surprise.disabled = true;
        for (const section of sections) {
            section.grid.setAttribute("aria-busy", "true");
            gridMessage(section.grid, "Loading movies…");
        }

        try {
            const catalogue = await catalogueApi.loadCatalogue();
            for (const section of sections) {
                const movies = section.ids.map(id => catalogueApi.getItemById(catalogue, id))
                    .filter(item => item && item.type === "movie");
                if (movies.length) section.grid.replaceChildren(...movies.map(makeCard));
                else gridMessage(section.grid, "No movies available in this section.");
            }
            const initial = catalogueApi.getItemById(catalogue, "movie-004");
            featuredMovies = initial && initial.type === "movie"
                ? [initial, ...catalogue.movies.filter(item => item.id !== initial.id)]
                : [...catalogue.movies];
            featuredIndex = 0;
            if (featuredMovies.length) {
                renderFeatured();
                status.textContent = "";
            } else {
                status.textContent = "No movies are available yet. Please check back later.";
                description.textContent = "No featured movies available.";
            }
        } catch (error) {
            status.textContent = "Movies could not be loaded. Check your connection and try again.";
            description.textContent = "Featured movies are currently unavailable.";
            for (const section of sections) gridMessage(section.grid, "Movies are currently unavailable.");
            retry.hidden = false;
        } finally {
            hero.setAttribute("aria-busy", "false");
            for (const section of sections) section.grid.setAttribute("aria-busy", "false");
        }
    }

    retry.addEventListener("click", loadHome);
    loadHome();
}());
