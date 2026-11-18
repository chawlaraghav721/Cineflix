(function () {
    "use strict";

    const section = document.querySelector(".personal-rating");
    const stars = document.querySelectorAll(".rating-stars button");
    const ratingMessage = document.getElementById("rating-message");
    const clearButton = document.getElementById("clear-rating");
    const storageKey = "cineflixPersonalRatings";
    let itemId = null;
    let currentItem = null;
    let accountView = null;

    if (!section || !stars.length || !ratingMessage || !clearButton) return;

    function isValidRating(rating) {
        return Number.isInteger(rating) && rating >= 1 && rating <= 5;
    }

    function getSavedRatings() {
        // Let storage access failures reach the caller rather than overwriting
        // existing ratings with an empty object after a failed read.
        const saved = localStorage.getItem(storageKey);
        let ratings;
        try {
            ratings = saved ? JSON.parse(saved) : {};
        } catch (error) {
            return {};
        }
        return ratings && typeof ratings === "object" && !Array.isArray(ratings)
            ? ratings : {};
    }

    function displayRating(rating) {
        stars.forEach(function (star) {
            const starValue = Number(star.dataset.rating);
            star.setAttribute("aria-pressed", String(starValue === rating));
            star.disabled = !itemId;
        });
        ratingMessage.textContent = rating > 0
            ? "Your Rating: " + rating + " out of 5 ⭐"
            : "No rating selected yet.";
        clearButton.disabled = !itemId || rating === 0;
    }

    function restoreRating() {
        if (accountView) return accountView.refresh();
        if (!itemId) return;
        try {
            const ratings = getSavedRatings();
            // Preserve ratings saved by the original static Details page.
            if (itemId === "movie-004" &&
                !Object.hasOwn(ratings, itemId) &&
                Object.hasOwn(ratings, "the-last-run") &&
                isValidRating(ratings["the-last-run"])) {
                ratings[itemId] = ratings["the-last-run"];
                delete ratings["the-last-run"];
                localStorage.setItem(storageKey, JSON.stringify(ratings));
            }
            const rating = Object.hasOwn(ratings, itemId) ? ratings[itemId] : 0;
            displayRating(isValidRating(rating) ? rating : 0);
        } catch (error) {
            displayRating(0);
            ratingMessage.textContent = "Unable to load your rating. Check that browser storage is enabled and try again.";
        }
    }

    // Called only after Details resolves the item through the shared catalogue.
    function connectItem(item) {
        itemId = item && typeof item.id === "string" && item.id.trim() &&
            (item.type === "movie" || item.type === "show") ? item.id : null;
        currentItem = itemId ? item : null;
        if (accountView) return accountView.connectItem(currentItem);
        section.hidden = !itemId;
        displayRating(0);
        restoreRating();
    }

    stars.forEach(function (star) {
        star.addEventListener("click", function () {
            if (accountView) return;
            const selectedRating = Number(star.dataset.rating);
            if (!itemId || !isValidRating(selectedRating)) return;
            try {
                const ratings = getSavedRatings();
                ratings[itemId] = selectedRating;
                localStorage.setItem(storageKey, JSON.stringify(ratings));
                displayRating(selectedRating);
            } catch (error) {
                ratingMessage.textContent = "Unable to save your rating. Check that browser storage is enabled and try again.";
            }
        });
    });

    clearButton.addEventListener("click", function () {
        if (accountView) return;
        if (!itemId) return;
        try {
            const ratings = getSavedRatings();
            delete ratings[itemId];
            // Clearing the canonical title must not revive its legacy rating.
            if (itemId === "movie-004") delete ratings["the-last-run"];
            localStorage.setItem(storageKey, JSON.stringify(ratings));
            displayRating(0);
        } catch (error) {
            ratingMessage.textContent = "Unable to clear your rating. Check that browser storage is enabled and try again.";
        }
    });

    window.addEventListener("storage", function (event) {
        if (accountView) return; // Account data never comes from browser storage.
        if (event.key === storageKey || event.key === null) restoreRating();
    });
    window.addEventListener("pageshow", restoreRating);
    function enableAccountMode() {
        if (!accountView) {
            const client = window.CineFlixRatingsApi.createRatingsClient();
            accountView = window.CineFlixAccountRatings.createAccountRatingView({
                client, section, stars, ratingMessage, clearButton
            });
        }
        return accountView.connectItem(currentItem);
    }
    window.CineFlixRatings = { connectItem, enableAccountMode };
    connectItem(null);
    // M1 switches this attribute only after the real API/auth gates pass.
    if (section.dataset.ratingsMode === "account") enableAccountMode();
}());
