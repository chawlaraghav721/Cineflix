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

    function savedIds() {
        const storage = window.CineFlixMyList;
        if (!storage || !storage.isStorageAvailable()) return null;
        return storage.getMyListIds();
    }

    function savedRatings() {
        try {
            const ratings = JSON.parse(window.localStorage.getItem("cineflixPersonalRatings") || "{}");
            if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return {};
            const valid = Object.fromEntries(Object.entries(ratings).filter(([, value]) => Number.isInteger(value) && value >= 1 && value <= 5));
            // Match the existing Details page's legacy rating migration without writing storage.
            if (valid["the-last-run"] && !valid["movie-004"]) valid["movie-004"] = valid["the-last-run"];
            return valid;
        } catch (error) {
            // Bad JSON is an empty collection; blocked storage must be reported as unavailable.
            return error instanceof SyntaxError ? {} : null;
        }
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
            badge.setAttribute("aria-label", "Guest rating on this device: " + rating + " out of 5");
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
        document.getElementById("account-library-title").textContent = view === "saved" ? "On your watchlist" : "Guest ratings on this device";
        status.textContent = "Loading your collection…";
        grid.setAttribute("aria-busy", "true");
        try {
            const catalogue = await window.CineFlixCatalogue.loadCatalogue();
            if (current !== revision) return;
            const items = window.CineFlixCatalogue.getAllItems(catalogue);
            const ids = savedIds();
            const ratings = savedRatings();
            const saved = ids === null ? [] : ids.map(id => items.find(item => item.id === id)).filter(Boolean);
            const rated = ratings === null ? [] : items.filter(item => Object.hasOwn(ratings, item.id));
            document.getElementById("account-list-count").textContent = ids === null ? "—" : String(saved.length);
            document.getElementById("account-rating-count").textContent = ratings === null ? "—" : String(rated.length);
            if ((view === "saved" && ids === null) || (view === "rated" && ratings === null)) {
                status.textContent = "Your collection is unavailable. Enable browser storage and try again.";
                retry.hidden = false;
                return;
            }
            const collection = view === "saved" ? saved : rated;
            const preview = view === "saved" ? collection.slice(0, 5) : collection;
            for (const item of preview) grid.appendChild(titleCard(item, ratings?.[item.id]));
            status.textContent = !collection.length
                ? view === "saved" ? "Your next favourites belong here. Explore movies and add a title to My List to start your collection."
                    : "No guest ratings on this device. Signed-in ratings and reviews are saved separately to your account on each title's Details page."
                : view === "saved" && collection.length > 5 ? "Showing 5 of " + collection.length + " saved titles. Open My List to see them all." : "";
        } catch {
            if (current !== revision) return;
            status.textContent = "We couldn't load your collection. Your saved titles and ratings are still on this device.";
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
    window.addEventListener("storage", event => {
        if (event.key === null || ["cineflixMyList", "cineflixPersonalRatings"].includes(event.key)) render();
    });
    window.addEventListener("pageshow", render);
    document.addEventListener("DOMContentLoaded", render);
}());
