(function () {
    "use strict";
    const STATUSES = ["want-to-watch", "watching", "watched"];
    const GUEST_KEY = "cineflixGuestWatchlist";
    let revision = 0;
    let reading = null;
    const pending = new Set();
    const changed = () => window.dispatchEvent(new Event("cineflix:list-updated"));
    const validId = id => typeof id === "string" && id.length > 0 && id.length <= 128 && id === id.trim();
    const sessionError = () => new Error("Your account changed. Please try again.");

    async function context() {
        const auth = window.CineFlixAuth;
        if (!auth) throw new Error("Account service is unavailable. Refresh the page to try again.");
        if (auth.getState().status === "loading") {
            await new Promise(resolve => {
                function ready() {
                    if (auth.getState().status === "loading") return;
                    window.removeEventListener("cineflix:auth-state", ready);
                    resolve();
                }
                window.addEventListener("cineflix:auth-state", ready);
                ready();
            });
        }
        const state = auth.getState();
        if (!["signed-in", "signed-out"].includes(state.status)) throw new Error("Your account could not be checked. Please refresh and try again.");
        return { revision, owner: state.user?.id || "guest" };
    }
    function check(ctx) {
        const state = window.CineFlixAuth.getState();
        if (ctx.revision !== revision || (state.user?.id || "guest") !== ctx.owner || state.status === "loading") throw sessionError();
    }
    function readGuest() {
        let raw;
        try { raw = window.localStorage.getItem(GUEST_KEY) ?? window.localStorage.getItem("cineflixMyList"); }
        catch { throw new Error("Browser storage is unavailable. Enable browser storage to use your guest list."); }
        let data;
        try { data = JSON.parse(raw); } catch { data = []; }
        if (!Array.isArray(data)) return [];
        const seen = new Set();
        return data.map(value => typeof value === "string"
            ? { itemId: value, status: "want-to-watch", addedAt: null, updatedAt: null } : value)
            .filter(value => value && validId(value.itemId) && STATUSES.includes(value.status) && !seen.has(value.itemId) && seen.add(value.itemId))
            .map(value => ({ itemId: value.itemId, status: value.status, addedAt: value.addedAt || null, updatedAt: value.updatedAt || null }));
    }
    function saveGuest(items) {
        try { window.localStorage.setItem(GUEST_KEY, JSON.stringify(items)); }
        catch { throw new Error("Your guest list could not be saved. Check browser storage and try again."); }
    }
    async function request(ctx, path = "", method = "GET", body) {
        check(ctx);
        let res;
        try {
            res = await window.fetch("/api/my-list" + path, { method, credentials: "same-origin", cache: "no-store",
                headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        } catch { throw new Error("Unable to reach My List. Check your connection and try again."); }
        check(ctx);
        if (res.status === 401) {
            window.CineFlixAuth.refresh();
            throw new Error("Your session expired. Sign in again to use your account list.");
        }
        if (res.status === 204) return null;
        let data;
        try { data = await res.json(); } catch { throw new Error("My List returned an unreadable response. Please try again."); }
        check(ctx);
        if (!res.ok) {
            const error = new Error(res.status >= 500 ? "My List is temporarily unavailable. Please try again."
                : data?.error?.message || "Your list could not be updated. Please try again.");
            error.status = res.status;
            throw error;
        }
        return data;
    }
    async function getMyListItems() {
        const ctx = await context();
        check(ctx);
        if (ctx.owner === "guest") return readGuest();
        if (!reading || reading.revision !== ctx.revision) {
            const promise = request(ctx).then(data => {
                if (!Array.isArray(data?.items) || data.items.some(item => !item || !validId(item.itemId) || !STATUSES.includes(item.status))) {
                    throw new Error("My List returned an unreadable response. Please try again.");
                }
                return data.items.map(item => ({ itemId: item.itemId, status: item.status, addedAt: item.addedAt, updatedAt: item.updatedAt }));
            });
            reading = { revision: ctx.revision, promise };
            promise.finally(() => { if (reading?.promise === promise) reading = null; }).catch(() => {});
        }
        const items = await reading.promise;
        check(ctx);
        return items.map(item => ({ ...item }));
    }
    async function mutate(method, id, status) {
        if (id !== undefined && !validId(id)) throw new Error("Choose a valid catalogue title.");
        if (status !== undefined && !STATUSES.includes(status)) throw new Error("Choose a valid watch status.");
        const ctx = await context();
        check(ctx);
        if (pending.has(ctx.revision)) throw new Error("Please wait for your list update to finish.");
        pending.add(ctx.revision);
        try {
            if (ctx.owner === "guest") {
                const items = readGuest();
                const entry = items.find(item => item.itemId === id);
                if (method === "POST") {
                    if (entry) return false;
                    const catalogue = await window.CineFlixCatalogue.loadCatalogue();
                    check(ctx);
                    if (!window.CineFlixCatalogue.getItemById(catalogue, id)) throw new Error("This title is no longer available.");
                    const now = new Date().toISOString();
                    items.push({ itemId: id, status: status || "want-to-watch", addedAt: now, updatedAt: now });
                } else if (method === "PATCH") {
                    if (!entry) throw new Error("This title is not in your list.");
                    entry.status = status; entry.updatedAt = new Date().toISOString();
                } else if (id !== undefined && !entry) return false;
                check(ctx);
                saveGuest(method === "DELETE" ? items.filter(item => id !== undefined && item.itemId !== id) : items);
            } else {
                await request(ctx, id === undefined || method === "POST" ? "" : "/" + encodeURIComponent(id), method,
                    method === "POST" ? { itemId: id, status: status || "want-to-watch" } : method === "PATCH" ? { status } : undefined);
            }
            check(ctx);
            revision++;
            reading = null;
            if (ctx.owner !== "guest") {
                try { window.localStorage.setItem("cineflixWatchlistChange", Date.now() + ":" + Math.random()); }
                catch { /* Account persistence does not require browser storage. */ }
            }
            changed();
            return true;
        } finally { pending.delete(ctx.revision); }
    }
    window.CineFlixMyList = {
        getMyListItems,
        getMyListIds: async () => (await getMyListItems()).map(item => item.itemId),
        isInMyList: async id => validId(id) && (await getMyListItems()).some(item => item.itemId === id),
        addToMyList: async (id, status) => {
            if (!validId(id)) throw new Error("Choose a valid catalogue title.");
            return mutate("POST", id, status);
        },
        updateStatus: async (id, status) => {
            if (!validId(id) || !STATUSES.includes(status)) throw new Error("Choose a valid title and watch status.");
            return mutate("PATCH", id, status);
        },
        removeFromMyList: async id => {
            if (!validId(id)) throw new Error("Choose a valid catalogue title.");
            return mutate("DELETE", id);
        },
        clearMyList: () => mutate("DELETE"),
        STATUSES
    };
    window.addEventListener("cineflix:auth-state", () => { revision++; reading = null; changed(); });
    window.addEventListener("storage", event => {
        if (event.key === null || [GUEST_KEY, "cineflixMyList", "cineflixWatchlistChange"].includes(event.key)) {
            reading = null; changed();
        }
    });
}());
