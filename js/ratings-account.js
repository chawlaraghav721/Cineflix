(function () {
    "use strict";

    function createAccountRatingView({ client, section, stars, ratingMessage, clearButton }) {
        const summary = document.getElementById("ratings-summary");
        const reviews = document.getElementById("ratings-reviews");
        const accountPanel = document.getElementById("ratings-account");
        const reviewInput = document.getElementById("rating-review");
        const saveButton = document.getElementById("save-review");
        const retryButton = document.getElementById("retry-ratings");
        const modeNote = document.getElementById("ratings-mode-note");
        let itemId = null;
        let generation = 0;
        let user = null;
        let score = 0;
        let busy = false;

        function controls() {
            stars.forEach(star => {
                star.disabled = !itemId || !user || busy;
                star.setAttribute("aria-pressed", String(Number(star.dataset.rating) === score));
            });
            clearButton.disabled = !user || !score || busy;
            reviewInput.disabled = !user || busy;
            saveButton.disabled = !user || !score || busy;
            section.setAttribute("aria-busy", String(busy));
        }

        function resetPersonal() {
            user = null;
            score = 0;
            reviewInput.value = "";
            controls();
        }

        function savedRating(value) {
            if (!value || !Number.isInteger(value.score) || value.score < 1 || value.score > 5 ||
                typeof value.reviewText !== "string") throw new Error("Invalid saved rating.");
            score = value.score;
            reviewInput.value = value.reviewText;
        }

        function renderSummary(data) {
            if (!Number.isInteger(data.count) || data.count < 0 || !Array.isArray(data.reviews) ||
                (data.count === 0 ? data.average !== null :
                    typeof data.average !== "number" || data.average < 1 || data.average > 5)) {
                throw new Error("Invalid rating summary.");
            }
            summary.textContent = data.count === 0 ? "No community ratings yet."
                : data.average.toFixed(1) + " out of 5 · " + data.count + (data.count === 1 ? " rating" : " ratings");
            reviews.replaceChildren();
            data.reviews.forEach(review => {
                if (typeof review.reviewText !== "string") return;
                const entry = document.createElement("li");
                // Reviews are untrusted plain text. Do not use innerHTML.
                entry.textContent = review.score + "/5 — " + review.reviewText;
                reviews.appendChild(entry);
            });
        }

        async function refresh() {
            const current = ++generation;
            resetPersonal();
            reviews.replaceChildren();
            if (!itemId) { busy = false; controls(); return; }
            busy = true;
            controls();
            ratingMessage.textContent = "Loading your account rating…";
            summary.textContent = "Loading community ratings…";
            const target = itemId;
            const results = await Promise.allSettled([client.getSummary(target), client.getUser()]);
            if (current !== generation) return;
            try {
                if (results[0].status === "rejected") throw results[0].reason;
                renderSummary(results[0].value);
            } catch { summary.textContent = "Community ratings could not be loaded. Use Refresh ratings to retry."; }
            try {
                if (results[1].status === "rejected") throw results[1].reason;
                const account = results[1].value;
                if (!account) {
                    ratingMessage.textContent = "Sign in to rate or review this title.";
                } else {
                    const own = await client.getOwn(target);
                    if (current !== generation) return;
                    if (own.rating !== null) savedRating(own.rating);
                    user = account;
                    ratingMessage.textContent = score ? "Your Rating: " + score + " out of 5 ⭐" : "No account rating selected yet.";
                }
            } catch {
                if (current !== generation) return;
                resetPersonal();
                ratingMessage.textContent = "Unable to load your account rating. Use Refresh ratings to retry.";
            } finally {
                if (current === generation) { busy = false; controls(); }
            }
        }

        async function mutate(nextScore, remove = false) {
            if (!itemId || !user || busy) return;
            const target = itemId;
            const current = generation;
            const expectedUser = user.id;
            const reviewText = reviewInput.value;
            if (!remove && reviewText.length > 2000) {
                ratingMessage.textContent = "Review must contain at most 2000 characters.";
                return;
            }
            busy = true;
            controls();
            ratingMessage.textContent = remove ? "Clearing your rating…" : "Saving your rating…";
            try {
                // Recheck cookies rather than using browser demo identity. If a
                // session changes, never automatically replay the write.
                const account = await client.getUser();
                if (current !== generation) return;
                if (!account || account.id !== expectedUser) { await refresh(); return; }
                const saved = remove ? await client.deleteOwn(target) : await client.putOwn(target, nextScore, reviewText);
                if (current !== generation) return;
                if (remove) { score = 0; reviewInput.value = ""; }
                else savedRating(saved);
                ratingMessage.textContent = remove ? "Your rating was cleared." : "Your Rating: " + score + " out of 5 ⭐ — saved.";
                try {
                    const data = await client.getSummary(target);
                    if (current === generation) renderSummary(data);
                } catch {
                    if (current === generation) {
                        reviews.replaceChildren();
                        summary.textContent = "Your change was saved. Community ratings could not be refreshed.";
                    }
                }
            } catch (error) {
                if (current !== generation) return;
                if (error.status === 401) {
                    resetPersonal();
                    ratingMessage.textContent = "Your session expired. Sign in and refresh ratings.";
                } else {
                    ratingMessage.textContent = "Unable to confirm the change. Refresh ratings before trying again.";
                }
            } finally {
                if (current === generation) { busy = false; controls(); }
            }
        }

        stars.forEach(star => star.addEventListener("click", () => mutate(Number(star.dataset.rating))));
        saveButton.addEventListener("click", () => mutate(score));
        clearButton.addEventListener("click", () => mutate(0, true));
        retryButton.addEventListener("click", refresh);
        window.addEventListener("cineflix:session-updated", refresh);
        window.addEventListener("focus", refresh);
        modeNote.textContent = "Account ratings are shared across your devices. Guest ratings are kept separate.";
        accountPanel.hidden = false;
        return {
            connectItem(item) {
                itemId = item?.id || null;
                section.hidden = !itemId;
                return refresh();
            },
            refresh
        };
    }

    window.CineFlixAccountRatings = { createAccountRatingView };
}());
