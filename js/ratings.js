// PERSONAL STAR RATING FEATURE

document.addEventListener("DOMContentLoaded", function () {

    // STEP 1: Select HTML elements

    const stars = document.querySelectorAll(
        ".rating-stars button"
    );

    const ratingMessage = document.getElementById(
        "rating-message"
    );

    const clearButton = document.getElementById(
        "clear-rating"
    );

    const detailsPage = document.querySelector(
        "main.details"
    );

    // STEP 2: Identify the current movie

    const urlParams = new URLSearchParams(
        window.location.search
    );

    const movieId =
        urlParams.get("id") ||
        detailsPage?.dataset.movieId;

    // Stop if the rating section or movie ID is missing

    if (
        !stars.length ||
        !ratingMessage ||
        !clearButton ||
        !movieId
    ) {
        return;
    }

    // STEP 3: Read previously saved ratings

    const storageKey = "cineflixPersonalRatings";

    function getSavedRatings() {

        try {

            const saved = localStorage.getItem(storageKey);

            const ratings = saved ? JSON.parse(saved) : {};

            if (
                ratings &&
                typeof ratings === "object" &&
                !Array.isArray(ratings)
            ) {
                return ratings;
            }

        } catch (error) {

            console.error("Could not read ratings:", error);

        }

        return {};
    }

    // STEP 4: Display the selected rating

    function displayRating(rating) {

        stars.forEach(function (star) {

            const starValue = Number(
                star.dataset.rating
            );

            if (starValue <= rating) {

                star.textContent = "★";

            } else {

                star.textContent = "☆";

            }

            star.setAttribute(
                "aria-pressed",
                String(starValue === rating)
            );

        });

        if (rating > 0) {

            ratingMessage.textContent =
                "Your Rating: " + rating + " out of 5 ⭐";

            clearButton.disabled = false;

        } else {

            ratingMessage.textContent =
                "No rating selected yet.";

            clearButton.disabled = true;

        }

    }

    // STEP 5: Load the movie's saved rating

    const savedRatings = getSavedRatings();

    const previousRating = Number(
        savedRatings[movieId]
    );

    displayRating(previousRating >= 1 && previousRating <= 5
        ? previousRating
        : 0
    );

    // STEP 6: Handle star clicks

    stars.forEach(function (star) {

        star.addEventListener("click", function () {

            const selectedRating = Number(
                star.dataset.rating
            );

            const ratings = getSavedRatings();

            ratings[movieId] = selectedRating;

            try {

                localStorage.setItem(
                    storageKey,
                    JSON.stringify(ratings)
                );

                displayRating(selectedRating);

            } catch (error) {

                console.error("Could not save rating:", error);

                ratingMessage.textContent =
                    "Unable to save your rating.";

            }

        });

    });

    // STEP 7: Clear the selected rating

    clearButton.addEventListener("click", function () {

        const ratings = getSavedRatings();

        delete ratings[movieId];

        try {

            localStorage.setItem(
                storageKey,
                JSON.stringify(ratings)
            );

            displayRating(0);

        } catch (error) {

            console.error("Could not clear rating:", error);

            ratingMessage.textContent =
                "Unable to clear your rating.";

        }

    });

});