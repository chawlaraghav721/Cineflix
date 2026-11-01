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
    const watchlistStatus = document.getElementById("watchlist-status");
    const trailerButton = document.getElementById("trailer-button");
    const trailerModal = document.getElementById("trailer-modal");
    const closeTrailerButton = document.getElementById("close-trailer");
    const trailerFrame = document.getElementById("trailer-frame");
    const main = document.querySelector("main.details");

    let currentItem = null;
    let myList = null;
    let previouslyFocused = null;

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
        setWatchlistStatus("");
        watchlistButton.disabled = true;
        watchlistButton.textContent = "Add to My List";
        trailerButton.hidden = true;
        trailerButton.disabled = true;
        trailerButton.dataset.trailerUrl = "";
        closeTrailer(false);
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

    function validTrailerUrl(value) {
        if (typeof value !== "string" || !value.trim()) return "";
        try {
            const url = new URL(value);
            if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "";

            const youtubeHost = url.hostname === "youtube.com" || url.hostname === "www.youtube.com";
            const privacyHost = url.hostname === "youtube-nocookie.com" || url.hostname === "www.youtube-nocookie.com";
            const vimeoHost = url.hostname === "player.vimeo.com";
            const validPath = ((youtubeHost || privacyHost) && /^\/embed\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) ||
                (vimeoHost && /^\/video\/[0-9]+\/?$/.test(url.pathname));

            return validPath ? url.href : "";
        } catch (error) {
            return "";
        }
    }

    function refreshWatchlistButton() {
        if (!isMyListConnected() || !currentItem) {
            watchlistButton.disabled = true;
            watchlistButton.textContent = "Add to My List";
            watchlistButton.setAttribute("aria-label", "Add to My List (unavailable)");
            return;
        }

        if (!isMyListStorageAvailable()) {
            watchlistButton.disabled = true;
            watchlistButton.textContent = "My List unavailable";
            watchlistButton.setAttribute("aria-label", "My List unavailable");
            setWatchlistStatus("Browser storage is unavailable. Enable browser storage to use My List.");
            return;
        }

        watchlistButton.disabled = false;
        const saved = myList.isInMyList(currentItem.id);
        watchlistButton.textContent = saved ? "Remove from My List" : "Add to My List";
        watchlistButton.setAttribute("aria-label", watchlistButton.textContent);
    }

    function setWatchlistStatus(message) {
        watchlistStatus.textContent = message;
    }

    function isMyListConnected() {
        return myList &&
            typeof myList.getMyListIds === "function" &&
            typeof myList.addToMyList === "function" &&
            typeof myList.removeFromMyList === "function" &&
            typeof myList.isInMyList === "function";
    }

    function isMyListStorageAvailable() {
        try {
            if (typeof myList.isStorageAvailable === "function") return myList.isStorageAvailable();
            return Boolean(window.localStorage);
        } catch (error) {
            return false;
        }
    }

    function render(item) {
        if (!item || typeof item !== "object" || !optionalText(item.id)) {
            currentItem = null;
            refreshWatchlistButton();
            showError("This title is unavailable. Browse the catalogue to find another movie or TV show.");
            return;
        }

        closeTrailer(false);
        currentItem = item;
        setWatchlistStatus("");
        title.textContent = optionalText(item.title) || "Untitled";
        description.textContent = optionalText(item.description) || "Information unavailable.";
        cast.textContent = Array.isArray(item.cast) ? item.cast.map(optionalText).filter(Boolean).join(", ") : optionalText(item.cast);
        cast.textContent = cast.textContent || "Cast information unavailable.";
        director.textContent = optionalText(item.director) || "Information unavailable.";
        setMeta(item);

        renderPoster(item.poster, title.textContent);

        const trailerUrl = validTrailerUrl(item.trailerUrl);
        trailerButton.hidden = !trailerUrl;
        trailerButton.disabled = !trailerUrl;
        trailerButton.dataset.trailerUrl = trailerUrl;
        refreshWatchlistButton();

        loading.hidden = true;
        errorMessage.hidden = true;
        content.hidden = false;
        main.setAttribute("aria-busy", "false");
    }

    function connectMyList(api) {
        myList = api || null;
        setWatchlistStatus("");
        refreshWatchlistButton();
    }

    function closeTrailer(restoreFocus) {
        trailerModal.hidden = true;
        trailerFrame.removeAttribute("src");
        document.body.classList.remove("trailer-open");
        if (restoreFocus !== false && trailerButton && !trailerButton.hidden && typeof trailerButton.focus === "function") {
            trailerButton.focus();
        } else if (restoreFocus !== false && previouslyFocused && typeof previouslyFocused.focus === "function") {
            previouslyFocused.focus();
        }
    }

    function trapTrailerFocus(event) {
        if (event.key !== "Tab" || trailerModal.hidden) return;

        const focusableElements = Array.from(trailerModal.querySelectorAll(
            'button:not([disabled]), iframe, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(function (element) {
            return !element.hidden && element.getAttribute("aria-hidden") !== "true";
        });
        if (!focusableElements.length) {
            event.preventDefault();
            closeTrailerButton.focus();
            return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const focusIsOutsideModal = !trailerModal.contains(document.activeElement);

        if (event.shiftKey && (document.activeElement === firstElement || focusIsOutsideModal)) {
            event.preventDefault();
            lastElement.focus();
        } else if (!event.shiftKey && (document.activeElement === lastElement || focusIsOutsideModal)) {
            event.preventDefault();
            firstElement.focus();
        }
    }

    trailerButton.addEventListener("click", function () {
        if (trailerButton.hidden || trailerButton.disabled) return;
        const url = validTrailerUrl(trailerButton.dataset.trailerUrl);
        if (!url) return;
        previouslyFocused = document.activeElement;
        trailerFrame.setAttribute("src", url);
        trailerModal.hidden = false;
        document.body.classList.add("trailer-open");
        closeTrailerButton.focus();
    });

    closeTrailerButton.addEventListener("click", closeTrailer);
    trailerModal.addEventListener("click", function (event) {
        if (event.target === trailerModal) closeTrailer();
    });
    document.addEventListener("keydown", function (event) {
        if (trailerModal.hidden) return;
        if (event.key === "Escape") closeTrailer();
        else trapTrailerFocus(event);
    });
    document.addEventListener("focusin", function (event) {
        if (!trailerModal.hidden && !trailerModal.contains(event.target)) closeTrailerButton.focus();
    });

    watchlistButton.addEventListener("click", function () {
        if (!isMyListConnected() || !currentItem) return;

        if (!isMyListStorageAvailable()) {
            refreshWatchlistButton();
            return;
        }

        let wasSaved = false;
        let succeeded = false;
        try {
            wasSaved = myList.isInMyList(currentItem.id);
            succeeded = wasSaved
                ? myList.removeFromMyList(currentItem.id)
                : myList.addToMyList(currentItem.id);
        } catch (error) {
            succeeded = false;
        }

        if (succeeded !== true) {
            if (!isMyListStorageAvailable()) {
                setWatchlistStatus("Browser storage is unavailable. Enable browser storage to use My List.");
            } else {
                setWatchlistStatus(wasSaved
                    ? "Could not remove this title from My List. Please try again."
                    : "Could not add this title to My List. Please try again.");
            }
            refreshWatchlistButton();
            return;
        }

        refreshWatchlistButton();
        setWatchlistStatus(wasSaved
            ? (optionalText(currentItem.title) || "This title") + " was removed from My List."
            : (optionalText(currentItem.title) || "This title") + " was added to My List.");
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
