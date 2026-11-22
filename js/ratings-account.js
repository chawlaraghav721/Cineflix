(function () {
    "use strict";
    function create({ section, stars, ratingMessage, clearButton, guest }) {
        const api = window.CineFlixRatingsApi.createClient();
        const auth = window.CineFlixAuth;
        const get = id => document.getElementById(id);
        const editor = get("rating-editor"), review = get("rating-review"), save = get("save-rating");
        const note = get("rating-mode"), summary = get("rating-summary"), reviews = get("community-reviews");
        let itemId = null, owner = null, score = 0, savedScore = 0, epoch = 0;
        let mode = "loading", busy = false, ready = false;

        function controls() {
            editor.hidden = mode !== "account";
            const enabled = !!itemId && ready && !busy;
            stars.forEach(button => {
                button.disabled = !enabled;
                if (mode !== "guest") button.setAttribute("aria-pressed", String(Number(button.dataset.rating) === score));
            });
            if (mode !== "guest") clearButton.disabled = !enabled || savedScore === 0;
            review.disabled = !enabled || mode !== "account";
            save.disabled = !enabled || !score || mode !== "account";
            section.setAttribute("aria-busy", String(busy));
        }
        function resetPrivate() {
            owner = null; score = 0; savedScore = 0; review.value = ""; ready = false;
            clearButton.disabled = true;
            stars.forEach(button => button.setAttribute("aria-pressed", "false"));
        }
        function displaySaved(rating) {
            score = rating?.score || 0; savedScore = score; review.value = rating?.reviewText || "";
            ratingMessage.textContent = score ? "Your saved rating: " + score + " out of 5." : "No account rating yet. Choose a star and save.";
        }
        function displayCommunity(data) {
            summary.textContent = data.count ? data.average.toFixed(1) + " out of 5 · " + data.count + (data.count === 1 ? " rating" : " ratings")
                : "No community ratings yet. Be the first to share your opinion.";
            reviews.replaceChildren();
            if (!data.reviews.length) {
                const empty = document.createElement("li"); empty.textContent = "No written reviews yet."; reviews.appendChild(empty);
            }
            for (const rating of data.reviews) {
                const entry = document.createElement("li");
                entry.textContent = rating.score + "/5 — " + rating.reviewText;
                reviews.appendChild(entry);
            }
        }
        async function load() {
            const current = ++epoch;
            resetPrivate(); busy = false; mode = "loading";
            if (!itemId) { controls(); return; }
            const target = itemId, state = auth.getState();
            if (state.status === "signed-out") {
                mode = "guest"; ready = true; guest.restore();
                note.textContent = "Guest rating — saved in this browser only. Sign in for account ratings and written reviews. Guest scores are never imported.";
            } else if (state.status === "signed-in") {
                mode = "account"; owner = state.user.id; busy = true;
                note.textContent = "Account rating — saved across devices, separate from your guest scores.";
                ratingMessage.textContent = "Loading your saved rating…";
            } else {
                note.textContent = state.status === "error" ? "Your account could not be checked. Use Refresh ratings to retry." : "Checking your account…";
                ratingMessage.textContent = "";
            }
            controls(); summary.textContent = "Loading community ratings…"; reviews.replaceChildren();
            const results = await Promise.allSettled([api.summary(target), owner ? api.own(target, owner) : Promise.resolve(null)]);
            if (current !== epoch) return;
            if (results[0].status === "fulfilled") displayCommunity(results[0].value);
            else summary.textContent = "Community ratings could not be loaded. Use Refresh ratings to retry.";
            if (mode === "account") {
                if (results[1].status === "fulfilled") { displaySaved(results[1].value); ready = true; }
                else {
                    ratingMessage.textContent = results[1].reason.message;
                    if (results[1].reason.code === "ACCOUNT_CHANGED") void auth.refresh();
                }
            }
            busy = false; controls();
        }
        async function write(remove = false) {
            if (mode !== "account" || !ready || busy || !owner || !itemId) return;
            if (!remove && (!score || review.value.length > 2000)) {
                ratingMessage.textContent = "Choose 1–5 stars and a review of at most 2000 characters."; return;
            }
            const current = epoch, target = itemId, expected = owner;
            busy = true; controls();
            ratingMessage.textContent = remove ? "Removing your rating…" : "Saving your rating and review…";
            try {
                const rating = remove ? await api.remove(target, expected) : await api.save(target, expected, score, review.value);
                if (current !== epoch) return;
                displaySaved(remove ? null : rating);
                ratingMessage.textContent = remove ? "Your rating and review were removed." : "Your rating and review were saved.";
                try {
                    const data = await api.summary(target);
                    if (current === epoch) displayCommunity(data);
                } catch {
                    if (current === epoch) { reviews.replaceChildren(); summary.textContent = "Your change was saved. Refresh ratings to reload community results."; }
                }
            } catch (error) {
                if (current !== epoch) return;
                ready = false; // A lost response may follow a successful write; read before retrying.
                ratingMessage.textContent = error.message + " Refresh ratings before another change.";
                if (error.code === "ACCOUNT_CHANGED") void auth.refresh();
            } finally { if (current === epoch) { busy = false; controls(); } }
        }
        save.addEventListener("click", () => write());
        get("refresh-ratings").addEventListener("click", () => auth.refresh());
        window.addEventListener("cineflix:auth-state", load);
        window.addEventListener("cineflix:ratings-updated", () => { if (!busy) void load(); });
        return {
            connect(id) { itemId = id; return load(); }, reload: load,
            restoreGuest() { if (mode === "guest") guest.restore(); },
            select(value) {
                if (!ready || busy || !Number.isInteger(value) || value < 1 || value > 5) return;
                if (mode === "guest") return guest.select(value);
                score = value; controls(); ratingMessage.textContent = value + " out of 5 selected. Save to update your account rating.";
            },
            remove() { if (mode === "guest") guest.remove(); else void write(true); }
        };
    }
    window.CineFlixRatingsUi = { create };
}());
