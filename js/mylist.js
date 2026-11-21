(function () {
    "use strict";

    const catalogueApi = window.CineFlixCatalogue;
    const myList = window.CineFlixMyList;
    const grid = document.getElementById("mylist-grid");
    const addCard = document.getElementById("mylist-add");
    const search = document.getElementById("mylist-search");
    const clearButton = document.getElementById("mylist-clear");
    const retryButton = document.getElementById("mylist-retry");
    const status = document.getElementById("mylist-status");
    const errorMessage = document.getElementById("mylist-error");
    const filter = document.getElementById("mylist-filter");
    const session = document.getElementById("mylist-session");
    const labels = { "want-to-watch": "Want to Watch", watching: "Watching", watched: "Watched" };
    let catalogue = null;
    let entries = [];
    let revision = 0;
    let busy = false;

    function posterFallback(item) {
        const fallback = document.createElement("div");
        fallback.className = "mylist-poster-fallback";
        fallback.setAttribute("role", "img");
        fallback.setAttribute("aria-label", "Poster unavailable for " + item.title);
        fallback.textContent = "Poster unavailable";
        return fallback;
    }

    function makePoster(item) {
        try {
            if (!item.poster.trim()) return posterFallback(item);
            const url = new URL(item.poster, document.baseURI);
            if (!["http:", "https:"].includes(url.protocol)) return posterFallback(item);
        } catch (error) {
            return posterFallback(item);
        }

        const image = document.createElement("img");
        image.alt = item.title + " poster";
        image.loading = "lazy";
        image.addEventListener("error", function () {
            image.replaceWith(posterFallback(item));
        }, { once: true });
        image.src = item.poster;
        return image;
    }

    function makeCard(item) {
        const card = document.createElement("article");
        card.className = "movie-card mylist-card";
        card.dataset.id = item.id;

        const link = document.createElement("a");
        link.className = "mylist-details-link";
        link.href = "details.html?id=" + encodeURIComponent(item.id);
        const info = document.createElement("div");
        info.className = "movie-info";
        const title = document.createElement("h3");
        title.textContent = item.title;
        const meta = document.createElement("p");
        meta.textContent = [item.year, item.genre].filter(Boolean).join(" • ");
        info.append(title, meta);
        link.append(makePoster(item), info);

        // The button is a sibling of the link, so removing never opens Details.
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "mylist-remove";
        removeButton.textContent = "Remove";
        removeButton.setAttribute("aria-label", "Remove " + item.title + " from My List");
        removeButton.disabled = busy;
        removeButton.addEventListener("click", () => perform(() => myList.removeFromMyList(item.id)));
        const select = document.createElement("select");
        select.className = "mylist-select mylist-item-status";
        select.setAttribute("aria-label", "Watch status for " + item.title);
        for (const [value, label] of Object.entries(labels)) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            select.append(option);
        }
        select.value = item.watchStatus;
        select.disabled = busy;
        select.addEventListener("change", () => perform(() => myList.updateStatus(item.id, select.value)));
        card.append(link, select, removeButton);
        return card;
    }

    function render() {
        if (!catalogue) return;
        const items = entries.map(entry => {
            const item = catalogueApi.getItemById(catalogue, entry.itemId);
            return item ? { ...item, watchStatus: entry.status } : null;
        }).filter(Boolean);
        const query = search.value.trim().toLowerCase();
        const matches = items.filter(item => item.title.toLowerCase().includes(query) &&
            (filter.value === "all" || item.watchStatus === filter.value));
        grid.replaceChildren(...matches.map(makeCard), addCard);
        clearButton.disabled = busy || entries.length === 0;
        status.textContent = entries.length === 0
            ? "Your list is empty. Browse movies and shows to find titles to save."
            : matches.length === 0 ? "No saved titles match your search or watch status."
                : matches.length + " saved title(s) shown.";
        if (items.length < entries.length) status.textContent += " Some saved titles are no longer available in the catalogue.";
    }

    async function loadMyList() {
        const current = ++revision;
        catalogue = null;
        entries = [];
        grid.replaceChildren(addCard);
        grid.setAttribute("aria-busy", "true");
        search.disabled = true;
        filter.disabled = true;
        const authState = window.CineFlixAuth?.getState();
        session.textContent = authState?.status === "signed-out"
            ? "Guest list: saved only in this browser. Signing in opens a separate account list; guest titles are never merged."
            : authState?.status === "signed-in" ? "Your account list is saved across visits." : "Checking your account…";
        clearButton.disabled = true;
        retryButton.hidden = true;
        status.textContent = "Loading your list?";
        errorMessage.textContent = "";
        try {
            const [loaded, saved] = await Promise.all([catalogueApi.loadCatalogue(), myList.getMyListItems()]);
            if (current !== revision) return;
            catalogue = loaded;
            entries = saved;
            search.disabled = false;
            filter.disabled = false;
            render();
        } catch (error) {
            if (current !== revision) return;
            status.textContent = "";
            errorMessage.textContent = error.message || "Your list could not be loaded. Check your connection and try again.";
            retryButton.hidden = false;
        } finally {
            if (current === revision) grid.setAttribute("aria-busy", "false");
        }
    }

    async function perform(operation) {
        if (busy) return;
        busy = true;
        const current = revision;
        errorMessage.textContent = "";
        render();
        try {
            await operation();
            await loadMyList();
            search.focus();
        } catch (error) {
            if (current === revision) errorMessage.textContent = error.message || "Your list could not be updated. Please try again.";
        } finally {
            busy = false;
            render();
        }
    }
    search.addEventListener("input", render);
    filter.addEventListener("change", render);
    retryButton.addEventListener("click", loadMyList);
    clearButton.addEventListener("click", () => {
        if (busy || !window.confirm("Clear My List and remove all saved movies and shows?")) return;
        perform(() => myList.clearMyList());
    });
    window.addEventListener("cineflix:list-updated", loadMyList);
    window.addEventListener("pageshow", loadMyList);
    loadMyList();
}());
