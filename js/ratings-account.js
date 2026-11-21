(function () {
    "use strict";
    function createView({ section, stars, ratingMessage, clearButton, guest }) {
        const auth = window.CineFlixAuth;
        const client = window.CineFlixRatingsApi.createRatingsClient();
        const byId = id => document.getElementById(id);
        const panel = byId("ratings-account"), input = byId("rating-review"), save = byId("save-review");
        const summary = byId("ratings-summary"), reviews = byId("ratings-reviews"), retry = byId("retry-ratings");
        const note = byId("ratings-mode-note");
        let itemId = null, generation = 0, score = 0, busy = false, owner = null;
        let mode = "loading", uncertain = false;

        function controls() {
            const enabled = !!itemId && !busy && !uncertain && (mode === "guest" || mode === "account");
            stars.forEach(star => {
                star.disabled = !enabled;
                if (mode !== "guest") star.setAttribute("aria-pressed", String(Number(star.dataset.rating) === score));
            });
            if (mode !== "guest") clearButton.disabled = !enabled || !score;
            panel.hidden = mode !== "account";
            input.disabled = !enabled || mode !== "account";
            save.disabled = !enabled || mode !== "account" || !score;
            section.setAttribute("aria-busy", String(busy));
        }
        function reset() {
            score = 0; owner = null; input.value = ""; uncertain = false;
            clearButton.disabled = true;
            stars.forEach(star => star.setAttribute("aria-pressed", "false"));
        }
        function renderOwn(value) {
            if (value !== null && (!Number.isInteger(value.score) || value.score < 1 || value.score > 5 ||
                typeof value.reviewText !== "string")) throw new Error("Invalid rating response.");
            score = value?.score || 0; input.value = value?.reviewText || "";
        }
        function renderSummary(data) {
            if (!Number.isInteger(data.count) || data.count < 0 || !Array.isArray(data.reviews) ||
                (data.count === 0 ? data.average !== null : !Number.isFinite(data.average) || data.average < 1 || data.average > 5)) {
                throw new Error("Invalid community response.");
            }
            summary.textContent = data.count ? data.average.toFixed(1) + " out of 5 · " + data.count + (data.count === 1 ? " rating" : " ratings")
                : "No community ratings yet. Be the first to rate this title.";
            reviews.replaceChildren();
            if (!data.reviews.length) {
                const empty = document.createElement("li"); empty.textContent = "No written reviews yet."; reviews.appendChild(empty);
            }
            for (const review of data.reviews) {
                if (typeof review.reviewText !== "string") continue;
                const entry = document.createElement("li");
                // User content stays plain text, including HTML and script characters.
                entry.textContent = review.score + "/5 — " + review.reviewText;
                reviews.appendChild(entry);
            }
        }
        async function load() {
            const current = ++generation;
            reset(); busy = false; mode = "loading";
            if (!itemId) { controls(); return; }
            const target = itemId;
            const state = auth.getState();
            if (state.status === "signed-out") {
                mode = "guest"; guest.restore();
                note.textContent = "Guest rating — saved only in this browser. Sign in to save an account rating and write a review. Guest ratings stay separate.";
            } else if (state.status === "signed-in") {
                mode = "account"; owner = state.user.id; busy = true;
                note.textContent = "Saved to your account. Guest ratings stay separate and are never imported.";
                ratingMessage.textContent = "Loading your account rating…";
            } else {
                note.textContent = state.status === "error" ? "Account status unavailable. Refresh ratings to retry." : "Checking your account…";
                ratingMessage.textContent = "";
            }
            controls();
            summary.textContent = "Loading community ratings…"; reviews.replaceChildren();
            const expectedOwner = owner;
            const results = await Promise.allSettled([client.getSummary(target), mode === "account" ? client.getOwn(target, owner) : Promise.resolve(null)]);
            if (current !== generation) return;
            try {
                if (results[0].status === "rejected") throw results[0].reason;
                renderSummary(results[0].value);
            } catch { summary.textContent = "Community ratings could not be loaded. Refresh ratings to retry."; }
            if (expectedOwner) {
                try {
                    if (results[1].status === "rejected") throw results[1].reason;
                    renderOwn(results[1].value.rating);
                    ratingMessage.textContent = score ? "Your Rating: " + score + " out of 5 — saved." : "No account rating yet. Choose a star to save.";
                } catch (error) {
                    reset(); uncertain = true;
                    ratingMessage.textContent = error.status === 401 ? "Your session expired. Sign in again." : "Your account rating could not be loaded. Refresh ratings to retry.";
                    if (error.status === 401 || error.code === "ACCOUNT_CHANGED") void auth.refresh();
                }
            }
            busy = false; controls();
        }
        async function mutate(nextScore, remove = false) {
            if (!itemId || mode !== "account" || !owner || busy || uncertain) return;
            if (!remove && (!Number.isInteger(nextScore) || nextScore < 1 || nextScore > 5 || input.value.length > 2000)) {
                ratingMessage.textContent = "Choose 1–5 stars and a review of at most 2000 characters."; return;
            }
            const current = generation, target = itemId, expectedOwner = owner, text = input.value;
            busy = true; controls();
            ratingMessage.textContent = remove ? "Removing your rating…" : "Saving your rating…";
            try {
                // Detect cookie changes before sending a draft to a different account.
                const account = await client.getUser();
                if (current !== generation) return;
                if (account?.id !== expectedOwner || auth.getState().user?.id !== expectedOwner) { await auth.refresh(); return; }
                const saved = remove ? await client.deleteOwn(target, expectedOwner) : await client.putOwn(target, nextScore, text, expectedOwner);
                if (current !== generation) return;
                renderOwn(remove ? null : saved);
                ratingMessage.textContent = remove ? "Your rating and review were removed." : "Your Rating: " + score + " out of 5 — saved.";
                try {
                    const data = await client.getSummary(target);
                    if (current === generation) renderSummary(data);
                } catch {
                    if (current === generation) { reviews.replaceChildren(); summary.textContent = "Your change was saved. Refresh ratings to reload the community results."; }
                }
            } catch (error) {
                if (current !== generation) return;
                // A lost response may follow a successful write. Require a read before retrying.
                uncertain = true;
                ratingMessage.textContent = error.status === 401 ? "Your session expired. Sign in again."
                    : "Unable to confirm the change. Refresh ratings before trying again.";
                if (error.status === 401 || error.code === "ACCOUNT_CHANGED") { reset(); uncertain = true; void auth.refresh(); }
            } finally { if (current === generation) { busy = false; controls(); } }
        }
        async function refresh() { await auth.refresh(); }
        window.addEventListener("cineflix:auth-state", load);
        window.addEventListener("pageshow", event => { if (event.persisted) void refresh(); });
        retry.addEventListener("click", refresh);
        save.addEventListener("click", () => mutate(score));
        return {
            connectItem(id) { itemId = id; return load(); }, refresh,
            refreshGuest() { if (mode === "guest") guest.restore(); },
            select(value) { if (mode === "guest") guest.select(value); else void mutate(value); },
            clear() { if (mode === "guest") guest.clear(); else void mutate(0, true); }
        };
    }
    window.CineFlixAccountRatings = { createView };
}());
