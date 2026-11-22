(function () {
    "use strict";
    const notificationKey = "cineflixRatingsChange";
    function failure(message, status, code) { return Object.assign(new Error(message), { status, code }); }
    const validRating = value => value && Number.isInteger(value.score) && value.score >= 1 && value.score <= 5 && typeof value.reviewText === "string";

    function createClient(fetcher = window.fetch.bind(window), auth = window.CineFlixAuth) {
        function check(owner) {
            if (!owner) return;
            const state = auth?.getState();
            if (state?.status !== "signed-in" || state.user?.id !== owner) {
                throw failure("Your account changed. Refresh ratings before trying again.", 409, "ACCOUNT_CHANGED");
            }
        }
        async function request(path, method = "GET", body, owner) {
            check(owner);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
                let response;
                try {
                    response = await fetcher("/api/ratings" + path, { method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
                        headers: { Accept: "application/json", ...(owner ? { "X-Ratings-Account": owner } : {}),
                            ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
                } catch { throw failure("Unable to reach ratings. Check your connection and refresh to retry.", 0, "NETWORK_ERROR"); }
                check(owner);
                if (response.status === 401) {
                    void auth?.refresh();
                    throw failure("Your session expired. Sign in again to manage account ratings.", 401, "AUTH_REQUIRED");
                }
                if (response.status === 204 && response.ok) return null;
                let data;
                try { data = await response.json(); } catch { throw failure("Ratings returned an unreadable response. Refresh to retry.", response.status, "INVALID_RESPONSE"); }
                check(owner);
                if (!response.ok) throw failure(response.status >= 500 ? "Ratings are temporarily unavailable. Refresh to retry."
                    : data?.error?.message || "Your rating could not be updated.", response.status, data?.error?.code || "REQUEST_FAILED");
                if (!data || typeof data !== "object" || Array.isArray(data)) throw failure("Ratings returned an invalid response.", response.status, "INVALID_RESPONSE");
                return data;
            } finally { clearTimeout(timer); }
        }
        function requireOwner(owner) {
            if (!owner) throw failure("Sign in to manage account ratings.", 401, "AUTH_REQUIRED");
            check(owner);
        }
        function announce() {
            window.dispatchEvent(new Event("cineflix:ratings-updated"));
            try { window.localStorage.setItem(notificationKey, Date.now() + ":" + Math.random()); } catch { /* Account persistence does not depend on browser storage. */ }
        }
        const path = itemId => "/" + encodeURIComponent(itemId);
        return {
            async summary(itemId) {
                const data = await request(path(itemId));
                if (!Number.isInteger(data.count) || data.count < 0 || !Array.isArray(data.reviews) ||
                    !data.reviews.every(validRating) || (data.count === 0 ? data.average !== null
                        : !Number.isFinite(data.average) || data.average < 1 || data.average > 5)) throw failure("Community ratings could not be read.", 200, "INVALID_RESPONSE");
                return data;
            },
            async own(itemId, owner) {
                requireOwner(owner);
                const data = await request(path(itemId) + "/me", "GET", undefined, owner);
                if (data.rating !== null && !validRating(data.rating)) throw failure("Your saved rating could not be read.", 200, "INVALID_RESPONSE");
                return data.rating;
            },
            async list(owner) {
                requireOwner(owner);
                const data = await request("", "GET", undefined, owner);
                if (!Array.isArray(data.items) || !data.items.every(item => typeof item.itemId === "string" && validRating(item))) {
                    throw failure("Your ratings collection could not be read.", 200, "INVALID_RESPONSE");
                }
                return data.items;
            },
            async save(itemId, owner, score, reviewText) {
                requireOwner(owner);
                const result = await request(path(itemId) + "/me", "PUT", { score, reviewText }, owner);
                if (!validRating(result)) throw failure("The saved rating could not be confirmed. Refresh before retrying.", 200, "INVALID_RESPONSE");
                announce(); return result;
            },
            async remove(itemId, owner) {
                requireOwner(owner);
                await request(path(itemId) + "/me", "DELETE", undefined, owner);
                announce();
            }
        };
    }
    window.addEventListener("storage", event => {
        if (event.key === null || event.key === notificationKey) window.dispatchEvent(new Event("cineflix:ratings-updated"));
    });
    window.CineFlixRatingsApi = { createClient };
}());
