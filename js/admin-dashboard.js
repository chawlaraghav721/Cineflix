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
    const countFields = {
        all: document.getElementById("admin-total-count"),
        movie: document.getElementById("admin-movie-count"),
        show: document.getElementById("admin-show-count")
    };
    let hasAdminAccess = false;
    let overviewRevision = 0;

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
            if (firstAccess) loadOverview();
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
    window.addEventListener("cineflix:auth-state", () => reconcileAccess(window.CineFlixAuth.getState()));
    document.addEventListener("DOMContentLoaded", async () => {
        if (!window.CineFlixAuth) {
            showDenied({ status: "error", user: null });
            return;
        }
        reconcileAccess(await waitForInitialAuth(window.CineFlixAuth));
    });
}());
