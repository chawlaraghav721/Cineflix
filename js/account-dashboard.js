(function () {
    "use strict";

    const panel = document.getElementById("account-panel");
    if (!panel) return;
    const grid = document.getElementById("account-library-grid");
    const status = document.getElementById("account-library-status");
    const retry = document.getElementById("account-library-retry");
    const savedTab = document.getElementById("account-saved-tab");
    const ratedTab = document.getElementById("account-rated-tab");
    let view = "saved";
    let revision = 0;

    async function savedIds() {
        const storage = window.CineFlixMyList;
        if (!storage) return null;
        try { return await storage.getMyListIds(); } catch { return null; }
    }

    function titleCard(item, rating) {
        const card = document.createElement("a");
        card.className = "account-title-card";
        card.href = "details.html?id=" + encodeURIComponent(item.id);
        const art = document.createElement("div");
        art.className = "account-title-art";
        const fallback = document.createElement("span");
        fallback.className = "account-title-fallback";
        fallback.textContent = item.title;
        art.appendChild(fallback);
        try {
            const url = new URL(item.poster, document.baseURI);
            if (item.poster.trim() && ["http:", "https:"].includes(url.protocol)) {
                const image = document.createElement("img");
                image.alt = item.title + " poster";
                image.loading = "lazy";
                image.addEventListener("load", () => { fallback.hidden = true; }, { once: true });
                image.addEventListener("error", () => { image.remove(); fallback.hidden = false; }, { once: true });
                image.src = url.href;
                art.appendChild(image);
            }
        } catch { /* Keep the title fallback when a poster URL is invalid. */ }
        if (rating) {
            const badge = document.createElement("span");
            badge.className = "account-title-rating";
            badge.textContent = "★ " + rating + " / 5";
            badge.setAttribute("aria-label", "Your rating: " + rating + " out of 5");
            art.appendChild(badge);
        }
        const name = document.createElement("h3");
        name.textContent = item.title;
        const meta = document.createElement("p");
        meta.textContent = [item.year, item.type === "show" ? "TV Show" : "Movie"].filter(Boolean).join(" · ");
        card.append(art, name, meta);
        return card;
    }

    async function render() {
        const current = ++revision;
        const user = window.CineFlixAuth?.getState().user;
        document.getElementById("profile-name").textContent = user?.name || "";
        document.getElementById("profile-email").textContent = user?.email || "";
        document.getElementById("profile-avatar").textContent = user
            ? user.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] || "").join("").toUpperCase() : "";
        document.getElementById("account-list-count").textContent = "—";
        document.getElementById("account-rating-count").textContent = "—";
        grid.replaceChildren();
        retry.hidden = true;
        if (!user) { status.textContent = ""; grid.setAttribute("aria-busy", "false"); return; }
        savedTab.setAttribute("aria-pressed", String(view === "saved"));
        ratedTab.setAttribute("aria-pressed", String(view === "rated"));
        document.getElementById("account-library-title").textContent = view === "saved" ? "On your watchlist" : "Your take on the titles";
        status.textContent = "Loading your collection…";
        grid.setAttribute("aria-busy", "true");
        try {
            const catalogue = await window.CineFlixCatalogue.loadCatalogue();
            if (current !== revision) return;
            const items = window.CineFlixCatalogue.getAllItems(catalogue);
            const results = await Promise.allSettled([savedIds(),
                Promise.resolve().then(() => window.CineFlixRatingsApi.createClient().list(user.id))]);
            if (current !== revision) return;
            const ids = results[0].status === "fulfilled" ? results[0].value : null;
            if (ids !== null) window.dispatchEvent(new Event("cineflix:list-refreshed"));
            const ratings = results[1].status === "fulfilled"
                ? Object.fromEntries(results[1].value.map(item => [item.itemId, item.score])) : null;
            const saved = ids === null ? [] : ids.map(id => items.find(item => item.id === id)).filter(Boolean);
            const rated = ratings === null ? [] : items.filter(item => Object.hasOwn(ratings, item.id));
            document.getElementById("account-list-count").textContent = ids === null ? "—" : String(saved.length);
            document.getElementById("account-rating-count").textContent = ratings === null ? "—" : String(rated.length);
            if ((view === "saved" && ids === null) || (view === "rated" && ratings === null)) {
                status.textContent = view === "saved" ? "Your saved titles could not be loaded. Check your connection and try again."
                    : "Your account ratings could not be loaded. Check your connection and try again.";
                retry.hidden = false;
                return;
            }
            const collection = view === "saved" ? saved : rated;
            const preview = view === "saved" ? collection.slice(0, 5) : collection;
            for (const item of preview) grid.appendChild(titleCard(item, ratings?.[item.id]));
            status.textContent = !collection.length
                ? view === "saved" ? "Your next favourites belong here. Explore movies and add a title to My List to start your collection."
                    : "Every opinion starts with a story. Open a movie or show and leave your first rating."
                : view === "saved" && collection.length > 5 ? "Showing 5 of " + collection.length + " saved titles. Open My List to see them all." : "";
            if (view === "saved" && ratings === null) {
                status.textContent += " Your saved titles are available, but ratings could not be loaded. Try again to refresh ratings.";
                retry.hidden = false;
            }
        } catch {
            if (current !== revision) return;
            status.textContent = "We couldn't load your collection. Check your connection and try again.";
            retry.hidden = false;
        } finally {
            if (current === revision) grid.setAttribute("aria-busy", "false");
        }
    }

    savedTab.addEventListener("click", () => { view = "saved"; render(); });
    ratedTab.addEventListener("click", () => { view = "rated"; render(); });
    document.getElementById("account-ratings-link").addEventListener("click", () => { view = "rated"; render(); });
    retry.addEventListener("click", render);
    window.addEventListener("cineflix:auth-state", render);
    window.addEventListener("cineflix:list-updated", render);
    window.addEventListener("cineflix:ratings-updated", render);
    window.addEventListener("storage", event => {
        if (event.key === null || event.key === "cineflixMyList") render();
    });
    window.addEventListener("pageshow", render);
    document.addEventListener("DOMContentLoaded", render);
}());
