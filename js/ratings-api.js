(function (root) {
    "use strict";

    function createRatingsClient(fetcher = root.fetch.bind(root)) {
        async function request(path, method = "GET", body) {
            const response = await fetcher(path, {
                method, credentials: "same-origin", cache: "no-store",
                headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            if (response.status === 204 && response.ok) return null;
            let data;
            try { data = await response.json(); } catch { data = null; }
            if (!response.ok) {
                const error = new Error("Ratings request failed. Please try again.");
                error.status = response.status;
                error.code = data?.error?.code || "REQUEST_FAILED";
                throw error;
            }
            if (!data || typeof data !== "object") throw new Error("Invalid ratings response.");
            return data;
        }
        const endpoint = itemId => "/api/ratings/" + encodeURIComponent(itemId);
        return {
            getUser: async () => {
                try {
                    const data = await request("/api/auth/me");
                    if (typeof data.user?.id !== "string" || !data.user.id) throw new Error("Invalid account response.");
                    return data.user;
                } catch (error) { if (error.status === 401) return null; throw error; }
            },
            getSummary: itemId => request(endpoint(itemId)),
            getOwn: itemId => request(endpoint(itemId) + "/me"),
            putOwn: (itemId, score, reviewText) => request(endpoint(itemId) + "/me", "PUT", { score, reviewText }),
            deleteOwn: itemId => request(endpoint(itemId) + "/me", "DELETE")
        };
    }

    root.CineFlixRatingsApi = { createRatingsClient };
}(window));
