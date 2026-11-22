(function () {
    "use strict";

    const accessCheck = document.getElementById("admin-access-check");
    if (!accessCheck) return;

    const denied = document.getElementById("admin-access-denied");
    const deniedTitle = document.getElementById("admin-denied-title");
    const deniedCopy = document.getElementById("admin-denied-copy");
    const signInLink = document.getElementById("admin-signin-link");
    const retryAccess = document.getElementById("admin-retry-access");
    const consolePanel = document.getElementById("admin-console");
    const overviewStatus = document.getElementById("admin-overview-status");
    const retryOverview = document.getElementById("admin-retry-overview");
    const searchInput = document.getElementById("admin-search");
    const typeFilter = document.getElementById("admin-type-filter");
    const sortSelect = document.getElementById("admin-sort");
    const refreshCatalogue = document.getElementById("admin-refresh-catalogue");
    const resultCount = document.getElementById("admin-result-count");
    const catalogueStatus = document.getElementById("admin-catalogue-status");
    const tableScroll = document.querySelector(".admin-table-scroll");
    const catalogueTable = document.getElementById("admin-catalogue-table");
    const catalogueRows = document.getElementById("admin-catalogue-rows");
    const pagination = document.getElementById("admin-pagination");
    const previousPage = document.getElementById("admin-page-previous");
    const nextPage = document.getElementById("admin-page-next");
    const pageIndicator = document.getElementById("admin-page-indicator");
    const pageSize = 12;
    const countFields = {
        all: document.getElementById("admin-total-count"),
        movie: document.getElementById("admin-movie-count"),
        show: document.getElementById("admin-show-count")
    };
    let hasAdminAccess = false;
    let overviewRevision = 0;
    let catalogueRevision = 0;
    let currentPage = 1;
    let searchTimer;

    async function requestJSON(url, options = {}) {
        let response;
        try {
            response = await window.fetch(url, {
                credentials: "same-origin",
                cache: "no-store",
                headers: { Accept: "application/json", ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...options
            });
        } catch {
            const error = new Error("CineFlix could not be reached. Check your connection and try again.");
            error.code = "NETWORK_ERROR";
            throw error;
        }
        let data = null;
        if (response.status !== 204) {
            try { data = await response.json(); } catch { data = null; }
        }
        if (!response.ok) {
            const error = new Error(data?.error?.message || "The request could not be completed.");
            error.status = response.status;
            error.code = data?.error?.code;
            throw error;
        }
        return data;
    }

    function showDenied(state) {
        hasAdminAccess = false;
        consolePanel.hidden = true;
        accessCheck.hidden = true;
        denied.hidden = false;
        retryAccess.hidden = true;
        signInLink.hidden = false;

        if (state.status === "error") {
            deniedTitle.textContent = "We couldn’t verify access";
            deniedCopy.textContent = "The account service is unavailable. Try again when your connection is restored.";
            signInLink.hidden = true;
            retryAccess.hidden = false;
            return;
        }
        if (state.user) {
            deniedTitle.textContent = "Admin access required";
            deniedCopy.textContent = "This account does not have the administrator role. Ask a CineFlix database owner to verify your access.";
            signInLink.textContent = "Open My Account";
            return;
        }
        deniedTitle.textContent = "Sign in to continue";
        deniedCopy.textContent = "The catalogue dashboard is available to administrator accounts.";
        signInLink.textContent = "Go to sign in";
        signInLink.href = "login.html";
    }

    function reconcileAccess(state) {
        if (!state || state.status === "loading") return;
        if (state.status === "signed-in" && state.user?.role === "admin") {
            const firstAccess = !hasAdminAccess;
            hasAdminAccess = true;
            accessCheck.hidden = true;
            denied.hidden = true;
            consolePanel.hidden = false;
            document.getElementById("admin-current-name").textContent = state.user.name;
            if (firstAccess) {
                loadOverview();
                loadCatalogue();
            }
            return;
        }
        showDenied(state);
    }

    async function loadOverview() {
        if (!hasAdminAccess) return;
        const current = ++overviewRevision;
        retryOverview.hidden = true;
        overviewStatus.textContent = "Refreshing catalogue totals…";
        for (const field of Object.values(countFields)) field.textContent = "—";
        try {
            const [all, movies, shows] = await Promise.all([
                requestJSON("/api/titles?limit=1"),
                requestJSON("/api/titles?type=movie&limit=1"),
                requestJSON("/api/titles?type=show&limit=1")
            ]);
            if (current !== overviewRevision || !hasAdminAccess) return;
            countFields.all.textContent = String(all.total);
            countFields.movie.textContent = String(movies.total);
            countFields.show.textContent = String(shows.total);
            overviewStatus.textContent = "";
        } catch {
            if (current !== overviewRevision || !hasAdminAccess) return;
            overviewStatus.textContent = "Catalogue totals could not be loaded. Your catalogue remains safe.";
            retryOverview.hidden = false;
        }
    }

    function titleCell(item) {
        const cell = document.createElement("td");
        cell.dataset.label = "Title";
        const title = document.createElement("div");
        title.className = "admin-title-cell";
        const fallback = document.createElement("span");
        fallback.className = "admin-title-poster-fallback";
        fallback.setAttribute("aria-hidden", "true");
        fallback.textContent = item.type === "show" ? "▣" : "▰";
        title.appendChild(fallback);

        try {
            const poster = new URL(item.poster, window.location.origin);
            if (["http:", "https:"].includes(poster.protocol) && !poster.username && !poster.password) {
                const image = document.createElement("img");
                image.className = "admin-title-poster";
                image.alt = item.title + " poster";
                image.loading = "lazy";
                image.addEventListener("error", () => image.replaceWith(fallback), { once: true });
                image.src = poster.href;
                fallback.replaceWith(image);
            }
        } catch { /* Keep a labelled fallback for malformed stored image URLs. */ }

        const text = document.createElement("div");
        const name = document.createElement("p");
        name.className = "admin-title-name";
        name.textContent = item.title;
        const meta = document.createElement("p");
        meta.className = "admin-title-subtitle";
        meta.textContent = item.type === "show" ? "TV show" : "Movie";
        text.append(name, meta);
        title.appendChild(text);
        cell.appendChild(title);
        return cell;
    }

    function textCell(value, className, label) {
        const cell = document.createElement("td");
        cell.dataset.label = label;
        if (className) cell.className = className;
        cell.textContent = value;
        return cell;
    }

    function titleRow(item) {
        const row = document.createElement("tr");
        row.dataset.itemId = item.id;
        row.appendChild(titleCell(item));
        row.appendChild(textCell(item.id, "admin-stable-id", "Stable ID"));
        const type = document.createElement("td");
        type.dataset.label = "Type";
        const badge = document.createElement("span");
        badge.className = "admin-type-badge";
        badge.dataset.type = item.type;
        badge.textContent = item.type === "show" ? "TV show" : "Movie";
        type.appendChild(badge);
        row.appendChild(type);
        row.appendChild(textCell(Number.isInteger(item.year) ? String(item.year) : "—", "", "Year"));
        const rating = typeof item.rating === "number" && Number.isFinite(item.rating) ? "★ " + item.rating.toFixed(1) : "—";
        row.appendChild(textCell(rating, "admin-rating", "Rating"));
        return row;
    }

    async function loadCatalogue() {
        if (!hasAdminAccess) return;
        const current = ++catalogueRevision;
        const params = new URLSearchParams({ page: String(currentPage), limit: String(pageSize), sort: sortSelect.value });
        const query = searchInput.value.trim();
        if (query) params.set("q", query);
        if (typeFilter.value) params.set("type", typeFilter.value);
        catalogueTable.setAttribute("aria-busy", "true");
        tableScroll.hidden = false;
        pagination.hidden = true;
        catalogueRows.replaceChildren();
        catalogueStatus.textContent = "Loading titles…";
        resultCount.textContent = "Loading titles…";

        try {
            const data = await requestJSON("/api/titles?" + params.toString());
            if (current !== catalogueRevision || !hasAdminAccess) return;
            if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total)) throw new Error("Catalogue response is unavailable.");
            const pages = Math.max(1, Math.ceil(data.total / pageSize));
            if (currentPage > pages && data.total > 0) {
                currentPage = pages;
                return loadCatalogue();
            }
            resultCount.textContent = data.total + (data.total === 1 ? " title" : " titles");
            if (!data.items.length) {
                tableScroll.hidden = true;
                catalogueStatus.textContent = query || typeFilter.value
                    ? "No titles match these filters. Try a different search or type."
                    : "The catalogue is empty. Add a title to get started.";
                return;
            }
            catalogueStatus.textContent = "";
            catalogueRows.replaceChildren(...data.items.map(titleRow));
            pagination.hidden = pages <= 1;
            previousPage.disabled = currentPage <= 1;
            nextPage.disabled = currentPage >= pages;
            pageIndicator.textContent = "Page " + currentPage + " of " + pages;
        } catch (error) {
            if (current !== catalogueRevision || !hasAdminAccess) return;
            tableScroll.hidden = true;
            resultCount.textContent = "Catalogue unavailable";
            catalogueStatus.textContent = error.status >= 500
                ? "The catalogue service is unavailable. Try refreshing in a moment."
                : "Titles could not be loaded. Check your connection and try again.";
        } finally {
            if (current === catalogueRevision) catalogueTable.setAttribute("aria-busy", "false");
        }
    }

    function applyFilter() {
        currentPage = 1;
        loadCatalogue();
    }

    function waitForInitialAuth(auth) {
        const current = auth.getState();
        if (current.status !== "loading") return Promise.resolve(current);
        return new Promise(resolve => {
            function onAuthState() {
                const state = auth.getState();
                if (state.status === "loading") return;
                window.removeEventListener("cineflix:auth-state", onAuthState);
                resolve(state);
            }
            window.addEventListener("cineflix:auth-state", onAuthState);
        });
    }

    retryAccess.addEventListener("click", async () => {
        retryAccess.disabled = true;
        try { reconcileAccess(await window.CineFlixAuth.refresh()); }
        finally { retryAccess.disabled = false; }
    });
    retryOverview.addEventListener("click", loadOverview);
    searchInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(applyFilter, 180);
    });
    typeFilter.addEventListener("change", applyFilter);
    sortSelect.addEventListener("change", applyFilter);
    refreshCatalogue.addEventListener("click", () => {
        loadOverview();
        loadCatalogue();
    });
    previousPage.addEventListener("click", () => { if (currentPage > 1) { currentPage--; loadCatalogue(); } });
    nextPage.addEventListener("click", () => { currentPage++; loadCatalogue(); });
    window.addEventListener("cineflix:auth-state", () => reconcileAccess(window.CineFlixAuth.getState()));
    document.addEventListener("DOMContentLoaded", async () => {
        if (!window.CineFlixAuth) {
            showDenied({ status: "error", user: null });
            return;
        }
        reconcileAccess(await waitForInitialAuth(window.CineFlixAuth));
    });
}());
