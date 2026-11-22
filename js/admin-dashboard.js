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
    const editor = document.getElementById("admin-editor");
    const editorTitle = document.getElementById("admin-editor-title");
    const titleForm = document.getElementById("admin-title-form");
    const saveTitleButton = document.getElementById("admin-save-title");
    const formError = document.getElementById("admin-form-error");
    const feedback = document.getElementById("admin-feedback");
    const formFields = {
        type: document.getElementById("title-type"),
        id: document.getElementById("title-id"),
        title: document.getElementById("title-name"),
        genre: document.getElementById("title-genre"),
        poster: document.getElementById("title-poster"),
        description: document.getElementById("title-description"),
        year: document.getElementById("title-year"),
        rating: document.getElementById("title-rating"),
        cast: document.getElementById("title-cast"),
        director: document.getElementById("title-director"),
        duration: document.getElementById("title-duration"),
        trailerUrl: document.getElementById("title-trailer")
    };
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
    let savingTitle = false;
    let autoId = true;

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

    function slugify(value) {
        return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
            .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120).replace(/-+$/g, "");
    }

    function syncGeneratedId() {
        if (!autoId) return;
        const slug = slugify(formFields.title.value.trim());
        formFields.id.value = slug ? formFields.type.value + "-" + slug : "";
    }

    function clearFieldError(field) {
        const control = formFields[field];
        const message = document.getElementById("title-" + (field === "title" ? "name" : field === "trailerUrl" ? "trailer" : field) + "-error");
        if (!control || !message) return;
        control.removeAttribute("aria-invalid");
        message.textContent = "";
    }

    function setFieldError(field, message) {
        const control = formFields[field];
        const errorId = field === "title" ? "name" : field === "trailerUrl" ? "trailer" : field;
        const messageNode = document.getElementById("title-" + errorId + "-error");
        if (control && messageNode) {
            control.setAttribute("aria-invalid", "true");
            messageNode.textContent = message;
        }
    }

    function clearFormErrors() {
        for (const field of Object.keys(formFields)) clearFieldError(field);
        formError.textContent = "";
    }

    function isWebUrl(value) {
        try {
            const parsed = new URL(value);
            return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
        } catch { return false; }
    }

    function validateForm() {
        clearFormErrors();
        const values = Object.fromEntries(Object.entries(formFields).map(([field, input]) => [field, input.value.trim()]));
        let valid = true;
        function invalid(field, message) { setFieldError(field, message); valid = false; }

        if (!["movie", "show"].includes(values.type)) invalid("type", "Choose movie or TV show.");
        if (!values.id) invalid("id", "Enter a stable catalogue ID.");
        else if (!/^(movie|show)-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(values.id) || values.id.length > 128) {
            invalid("id", "Use a stable ID such as movie-example-title.");
        } else if (!values.id.toLowerCase().startsWith(values.type + "-")) {
            invalid("id", "The ID prefix must match the selected type.");
        }
        if (!values.title) invalid("title", "Enter a title.");
        if (!values.genre) invalid("genre", "Enter at least one genre.");
        if (!values.poster) invalid("poster", "Enter a poster URL or a root-relative path.");
        else if (!(values.poster.startsWith("/") && !values.poster.startsWith("//") && !values.poster.includes("\\")) && !isWebUrl(values.poster)) {
            invalid("poster", "Use an HTTP(S) URL or a root-relative path beginning with /.");
        }
        if (values.year && (!/^\d+$/.test(values.year) || Number(values.year) < 1 || Number(values.year) > 3000)) {
            invalid("year", "Enter a whole year from 1 to 3000.");
        }
        if (values.rating && (!Number.isFinite(Number(values.rating)) || Number(values.rating) < 0 || Number(values.rating) > 10)) {
            invalid("rating", "Enter a rating from 0 to 10.");
        }
        const castNames = values.cast.split(/[\n,]/).map(name => name.trim()).filter(Boolean);
        if (castNames.length > 50) invalid("cast", "Add no more than 50 cast names.");
        else if (castNames.some(name => name.length > 120)) invalid("cast", "Each cast name must be 120 characters or fewer.");
        if (values.trailerUrl && !isWebUrl(values.trailerUrl)) invalid("trailerUrl", "Use a valid HTTP(S) trailer URL.");

        if (!valid) {
            const firstInvalid = titleForm.querySelector('[aria-invalid="true"]');
            if (firstInvalid) firstInvalid.focus();
            return null;
        }
        return { values, castNames };
    }

    function createPayload(formData) {
        const { values, castNames } = formData;
        const payload = {
            id: values.id,
            type: values.type,
            title: values.title,
            genre: values.genre,
            poster: values.poster,
            cast: castNames
        };
        if (values.description) payload.description = values.description;
        if (values.year) payload.year = Number(values.year);
        if (values.rating) payload.rating = Number(values.rating);
        if (values.director) payload.director = values.director;
        if (values.duration) payload.duration = values.duration;
        if (values.trailerUrl) payload.trailerUrl = values.trailerUrl;
        return payload;
    }

    function showFeedback(message, state = "success") {
        feedback.textContent = message;
        feedback.dataset.state = state;
        feedback.hidden = false;
        window.clearTimeout(showFeedback.timeout);
        showFeedback.timeout = window.setTimeout(() => { feedback.hidden = true; }, 5000);
    }

    function openCreateForm() {
        clearFormErrors();
        titleForm.reset();
        autoId = true;
        syncGeneratedId();
        formFields.id.readOnly = false;
        editorTitle.textContent = "Add a title";
        saveTitleButton.textContent = "Create title";
        editor.hidden = false;
        editor.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        formFields.title.focus({ preventScroll: true });
    }

    async function createTitle(event) {
        event.preventDefault();
        if (savingTitle) return;
        const validForm = validateForm();
        if (!validForm) return;
        savingTitle = true;
        saveTitleButton.disabled = true;
        document.getElementById("admin-cancel-editor").disabled = true;
        saveTitleButton.textContent = "Creating…";
        try {
            const created = await requestJSON("/api/titles", {
                method: "POST",
                body: JSON.stringify(createPayload(validForm))
            });
            if (!created || typeof created.id !== "string") throw new Error("The created title could not be confirmed.");
            editor.hidden = true;
            titleForm.reset();
            autoId = true;
            syncGeneratedId();
            searchInput.value = "";
            typeFilter.value = "";
            currentPage = 1;
            showFeedback("“" + created.title + "” was added to the catalogue.");
            loadOverview();
            loadCatalogue();
        } catch (error) {
            if (error.code === "DUPLICATE_TITLE_ID") setFieldError("id", "A title with this stable ID already exists.");
            else {
                const field = error.message.match(/^(id|type|title|genre|poster|description|year|rating|cast|director|duration|trailerUrl)\b/i)?.[1];
                if (field && Object.hasOwn(formFields, field)) setFieldError(field, error.message);
                else formError.textContent = error.status >= 500
                    ? "The catalogue service is unavailable. Your title was not confirmed; check the catalogue before trying again."
                    : error.message || "The title could not be created. Check the form and try again.";
            }
        } finally {
            savingTitle = false;
            saveTitleButton.disabled = false;
            document.getElementById("admin-cancel-editor").disabled = false;
            saveTitleButton.textContent = "Create title";
        }
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
    document.getElementById("admin-open-create").addEventListener("click", openCreateForm);
    document.getElementById("admin-cancel-editor").addEventListener("click", () => {
        if (!savingTitle) editor.hidden = true;
    });
    titleForm.addEventListener("submit", createTitle);
    formFields.type.addEventListener("change", syncGeneratedId);
    formFields.title.addEventListener("input", syncGeneratedId);
    formFields.id.addEventListener("input", () => { autoId = false; });
    for (const field of Object.keys(formFields)) {
        formFields[field].addEventListener("input", () => clearFieldError(field));
        formFields[field].addEventListener("change", () => clearFieldError(field));
    }
    window.addEventListener("cineflix:auth-state", () => reconcileAccess(window.CineFlixAuth.getState()));
    document.addEventListener("DOMContentLoaded", async () => {
        if (!window.CineFlixAuth) {
            showDenied({ status: "error", user: null });
            return;
        }
        reconcileAccess(await waitForInitialAuth(window.CineFlixAuth));
    });
}());
