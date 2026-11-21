(function () {
    "use strict";

    const section = document.querySelector(".personal-rating");
    const stars = document.querySelectorAll(".rating-stars button");
    const ratingMessage = document.getElementById("rating-message");
    const clearButton = document.getElementById("clear-rating");
    const storageKey = "cineflixPersonalRatings";
    let itemId = null;
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

    function restoreGuestRating() {
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

    function restoreRating() {
        return accountView ? accountView.refresh() : restoreGuestRating();
    }

    // Called only after Details resolves the item through the shared catalogue.
    function connectItem(item) {
        itemId = item && typeof item.id === "string" && item.id.trim() &&
            (item.type === "movie" || item.type === "show") ? item.id : null;
        section.hidden = !itemId;
        if (accountView) return accountView.connectItem(itemId);
        displayRating(0);
        restoreRating();
    }

    function saveGuestRating(selectedRating) {
        if (!itemId || !isValidRating(selectedRating)) return;
        try {
            const ratings = getSavedRatings();
            ratings[itemId] = selectedRating;
            localStorage.setItem(storageKey, JSON.stringify(ratings));
            displayRating(selectedRating);
        } catch (error) {
            ratingMessage.textContent = "Unable to save your rating. Check that browser storage is enabled and try again.";
        }
    }

    function clearGuestRating() {
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
    }

    stars.forEach(function (star) {
        star.addEventListener("click", function () {
            const selected = Number(star.dataset.rating);
            if (accountView) accountView.select(selected);
            else saveGuestRating(selected);
        });
    });
    clearButton.addEventListener("click", function () {
        if (accountView) accountView.clear();
        else clearGuestRating();
    });

    window.addEventListener("storage", function (event) {
        if (event.key === storageKey || event.key === null) {
            if (accountView) accountView.refreshGuest();
            else restoreGuestRating();
        }
    });
    window.addEventListener("pageshow", restoreRating);
    window.CineFlixRatings = { connectItem: connectItem };
    if (window.CineFlixAuth && window.CineFlixRatingsApi && window.CineFlixAccountRatings) {
        accountView = window.CineFlixAccountRatings.createView({ section, stars, ratingMessage, clearButton,
            guest: { restore: restoreGuestRating, select: saveGuestRating, clear: clearGuestRating } });
    }
    connectItem(null);
}());
