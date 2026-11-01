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
    let catalogue = null;

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
        removeButton.addEventListener("click", function () {
            const buttons = Array.from(grid.querySelectorAll(".mylist-remove"));
            const index = buttons.indexOf(removeButton);
            if (!myList.removeFromMyList(item.id)) {
                errorMessage.textContent = "This title could not be removed. Please try again and check that browser storage is enabled.";
                return;
            }
            // The storage event has rendered the updated cards synchronously.
            const remaining = grid.querySelectorAll(".mylist-remove");
            const nextFocus = remaining[Math.min(index, remaining.length - 1)] || search;
            nextFocus.focus();
        });
        card.append(link, removeButton);
        return card;
    }

    function render() {
        if (!catalogue) return;
        errorMessage.textContent = "";
        if (typeof myList.isStorageAvailable === "function" && !myList.isStorageAvailable()) {
            grid.replaceChildren(addCard);
            clearButton.disabled = true;
            status.textContent = "";
            errorMessage.textContent = "Browser storage is unavailable. Enable browser storage to load your saved titles.";
            return;
        }

        const ids = myList.getMyListIds();
        const items = ids.map(id => catalogueApi.getItemById(catalogue, id)).filter(Boolean);
        const query = search.value.trim().toLowerCase();
        const matches = items.filter(item => item.title.toLowerCase().includes(query));
        grid.replaceChildren(...matches.map(makeCard), addCard);
        clearButton.disabled = ids.length === 0;

        if (ids.length === 0) {
            status.textContent = "Your list is empty. Browse movies and shows to find titles to save.";
        } else if (items.length === 0) {
            status.textContent = "Your saved titles are no longer available in the catalogue. You can clear your list and browse for other titles.";
        } else {
            status.textContent = matches.length === 0
                ? "No saved titles match your search."
                : matches.length + " saved title(s) shown.";
            if (items.length < ids.length) {
                status.textContent += " Some saved titles are no longer available in the catalogue.";
            }
        }
    }

    async function loadMyList() {
        catalogue = null;
        grid.setAttribute("aria-busy", "true");
        search.disabled = true;
        clearButton.disabled = true;
        retryButton.hidden = true;
        status.textContent = "Loading your list…";
        errorMessage.textContent = "";
        try {
            catalogue = await catalogueApi.loadCatalogue();
            search.disabled = false;
            render();
        } catch (error) {
            status.textContent = "";
            errorMessage.textContent = "Your list could not be loaded. Check your connection and try again.";
            retryButton.hidden = false;
        } finally {
            grid.setAttribute("aria-busy", "false");
        }
    }

    search.addEventListener("input", render);
    retryButton.addEventListener("click", loadMyList);
    clearButton.addEventListener("click", function () {
        if (!window.confirm("Clear My List and remove all saved movies and shows?")) return;
        if (!myList.clearMyList()) {
            errorMessage.textContent = "Your list could not be cleared. Please try again and check that browser storage is enabled.";
            return;
        }
        search.focus();
    });
    window.addEventListener("cineflix:list-updated", render);
    window.addEventListener("pageshow", render);
    window.addEventListener("storage", function (event) {
        if (event.key === null || event.key === "cineflixMyList") render();
    });
    loadMyList();
}());
