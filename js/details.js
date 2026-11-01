(function () {
    "use strict";

    const loading = document.getElementById("details-loading");
    const content = document.getElementById("details-content");
    let poster = document.getElementById("details-poster");
    const posterFallback = document.getElementById("details-poster-fallback");
    const title = document.getElementById("details-title");
    const meta = document.getElementById("details-meta");
    const description = document.getElementById("details-description");
    const cast = document.getElementById("details-cast");
    const director = document.getElementById("details-director");
    const errorMessage = document.getElementById("details-error");
    const watchlistButton = document.getElementById("watchlist-button");
    const main = document.querySelector("main.details");

    let currentItem = null;
    let myList = null;

    function getSelectedId() {
        return new URLSearchParams(window.location.search).get("id");
    }

    function showLoading() {
        loading.hidden = false;
        content.hidden = true;
        errorMessage.hidden = true;
        main.setAttribute("aria-busy", "true");
    }

    function showError(message, type) {
        currentItem = null;
        watchlistButton.disabled = true;
        watchlistButton.textContent = "Add to My List";
        loading.hidden = true;
        content.hidden = true;
        errorMessage.replaceChildren();

        const messageText = document.createElement("p");
        messageText.textContent = message || "This title is unavailable. Browse the catalogue to find a movie or TV show.";
        errorMessage.appendChild(messageText);

        const browseLinks = document.createElement("div");
        browseLinks.className = "details-error-links";
        const destinations = type === "movie" ? [{ label: "Browse Movies", href: "movies.html" }]
            : type === "show" || type === "tv" ? [{ label: "Browse TV Shows", href: "shows.html" }]
                : [
                    { label: "Browse Movies", href: "movies.html" },
                    { label: "Browse TV Shows", href: "shows.html" }
                ];

        destinations.forEach(function (destination) {
            const link = document.createElement("a");
            link.setAttribute("href", destination.href);
            link.textContent = destination.label;
            browseLinks.appendChild(link);
        });
        errorMessage.appendChild(browseLinks);
        errorMessage.hidden = false;
        main.setAttribute("aria-busy", "false");
    }

    function optionalText(value) {
        return value === null || value === undefined ? "" : String(value).trim();
    }

    function renderPoster(source, itemTitle) {
        const nextPoster = document.createElement("img");
        nextPoster.id = "details-poster";
        nextPoster.className = "details-poster";
        nextPoster.alt = itemTitle ? itemTitle + " poster" : "Poster unavailable";
        nextPoster.hidden = true;
        poster.replaceWith(nextPoster);
        poster = nextPoster;
        posterFallback.hidden = false;

        const posterSource = optionalText(source);
        if (!posterSource) return;

        let posterUrl;
        try {
            posterUrl = new URL(posterSource, document.baseURI);
        } catch (error) {
            return;
        }
        if ((posterUrl.protocol !== "https:" && posterUrl.protocol !== "http:") || posterUrl.username || posterUrl.password) return;

        nextPoster.onload = function () {
            if (poster !== nextPoster) return;
            nextPoster.onerror = null;
            nextPoster.hidden = false;
            posterFallback.hidden = true;
        };
        nextPoster.onerror = function () {
            if (poster !== nextPoster) return;
            nextPoster.onload = null;
            nextPoster.onerror = null;
            nextPoster.removeAttribute("src");
            nextPoster.hidden = true;
            posterFallback.hidden = false;
        };
        nextPoster.setAttribute("src", posterUrl.href);
    }

    function setMeta(item) {
        const values = [];
        const year = optionalText(item.year);
        const rating = optionalText(item.rating);
        if (year && year.toLowerCase() !== "nan") values.push(year);
        if (optionalText(item.duration)) values.push(optionalText(item.duration));
        if (optionalText(item.genre)) values.push(optionalText(item.genre));
        if (rating && rating.toLowerCase() !== "nan") values.push(rating + "/10");
        meta.textContent = values.join(" • ") || "Information unavailable.";
        meta.hidden = false;
    }

    function refreshWatchlistButton() {
        const connected = isMyListConnected() && currentItem;
        watchlistButton.disabled = !connected;
        if (!connected) {
            watchlistButton.textContent = "Add to My List";
            watchlistButton.setAttribute("aria-label", "Add to My List (unavailable)");
            return;
        }
        const saved = myList.isInMyList(currentItem.id);
        watchlistButton.textContent = saved ? "Remove from My List" : "Add to My List";
        watchlistButton.setAttribute("aria-label", watchlistButton.textContent);
    }

    function isMyListConnected() {
        return myList &&
            typeof myList.getMyListIds === "function" &&
            typeof myList.addToMyList === "function" &&
            typeof myList.removeFromMyList === "function" &&
            typeof myList.isInMyList === "function";
    }

    function render(item) {
        if (!item || typeof item !== "object" || !optionalText(item.id)) {
            currentItem = null;
            refreshWatchlistButton();
            showError("This title is unavailable. Browse the catalogue to find another movie or TV show.");
            return;
        }

        currentItem = item;
        title.textContent = optionalText(item.title) || "Untitled";
        description.textContent = optionalText(item.description) || "Information unavailable.";
        cast.textContent = Array.isArray(item.cast) ? item.cast.map(optionalText).filter(Boolean).join(", ") : optionalText(item.cast);
        cast.textContent = cast.textContent || "Cast information unavailable.";
        director.textContent = optionalText(item.director) || "Information unavailable.";
        setMeta(item);

        renderPoster(item.poster, title.textContent);

        refreshWatchlistButton();

        loading.hidden = true;
        errorMessage.hidden = true;
        content.hidden = false;
        main.setAttribute("aria-busy", "false");
    }

    function connectMyList(api) {
        myList = api || null;
        refreshWatchlistButton();
    }

    watchlistButton.addEventListener("click", function () {
        if (!isMyListConnected() || !currentItem) return;
        const saved = myList.isInMyList(currentItem.id);
        const result = saved ? myList.removeFromMyList(currentItem.id) : myList.addToMyList(currentItem.id);
        if (result !== false) refreshWatchlistButton();
    });

    // Integration API: getSelectedId(), render(item), showLoading(), and showError(message, type?).
    // A catalogue loader can pass its selected object to render(item). Supply the shared
    // watchlist functions as connectMyList({ getMyListIds, addToMyList, removeFromMyList, isInMyList }).
    window.CineFlixDetails = {
        getSelectedId: getSelectedId,
        render: render,
        showLoading: showLoading,
        showError: showError,
        connectMyList: connectMyList
    };

    showLoading();
    if (!getSelectedId()) showError("No title ID was provided. Browse the catalogue to choose a movie or TV show.");
})();
