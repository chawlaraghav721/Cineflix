/* Dormant API helpers. No requests or UI changes until explicitly instantiated. */
(function (root, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.CineFlixMovieNightApi = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    class MovieNightApiError extends Error {
        constructor(code, message, status = 0) { super(message); this.name = "MovieNightApiError"; this.code = code; this.status = status; }
    }
    function idPath(id) {
        if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) throw new TypeError("A session or room ID is required.");
        return encodeURIComponent(id);
    }
    function revisionHeaders(revision) {
        if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new TypeError("An incrementable revision is required.");
        return { "X-Movie-Night-Revision": String(revision) };
    }
    function roundHeaders(roundId) {
        if (typeof roundId !== "string" || !roundId || roundId !== roundId.trim() || roundId.length > 64) throw new TypeError("A round ID is required.");
        return { "X-Movie-Night-Round": roundId };
    }
    function createClient({ fetchImpl = globalThis.fetch } = {}) {
        if (typeof fetchImpl !== "function") throw new TypeError("Fetch is required.");
        async function request(path, method = "GET", body, headers = {}, options = {}) {
            let response;
            try {
                response = await fetchImpl("/api/movie-night" + path, { method, credentials: "same-origin", cache: "no-store",
                    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: options.signal });
            } catch (error) {
                if (options.signal?.aborted || error.name === "AbortError") throw error;
                throw new MovieNightApiError("NETWORK_ERROR", "Unable to reach Movie Night. Check your connection and reload its state.");
            }
            if (response.status === 204 && response.ok) return undefined;
            let data;
            try { data = await response.json(); }
            catch { throw new MovieNightApiError("INVALID_RESPONSE", "Movie Night returned an invalid JSON response.", response.status); }
            if (!response.ok) {
                const error = data?.error;
                throw new MovieNightApiError(typeof error?.code === "string" ? error.code : "HTTP_ERROR",
                    typeof error?.message === "string" ? error.message : "Movie Night could not complete this request.", response.status);
            }
            return data;
        }
        const configuration = value => ({ selectedIds: value.selectedIds, voterCount: value.voterCount });
        return {
            createSession: (value, options) => request("/sessions", "POST", configuration(value), {}, options),
            listSessions: options => request("/sessions", "GET", undefined, {}, options),
            getSession: (id, options) => request("/sessions/" + idPath(id), "GET", undefined, {}, options),
            voteSession: (id, itemId, revision, options) => request("/sessions/" + idPath(id) + "/votes", "POST", { itemId }, revisionHeaders(revision), options),
            getSessionResults: (id, options) => request("/sessions/" + idPath(id) + "/results", "GET", undefined, {}, options),
            resetSession: (id, revision, options) => request("/sessions/" + idPath(id) + "/reset", "POST", undefined, revisionHeaders(revision), options),
            deleteSession: (id, options) => request("/sessions/" + idPath(id), "DELETE", undefined, {}, options),
            createRoom: (value, options) => request("/rooms", "POST", configuration(value), {}, options),
            joinRoom: (roomCode, options) => request("/rooms/join", "POST", { roomCode }, {}, options),
            getRoom: (id, options) => request("/rooms/" + idPath(id), "GET", undefined, {}, options),
            startRoom: (id, revision, options) => request("/rooms/" + idPath(id) + "/start", "POST", undefined, revisionHeaders(revision), options),
            resetRoom: (id, revision, options) => request("/rooms/" + idPath(id) + "/reset", "POST", undefined, revisionHeaders(revision), options),
            voteRoom: (id, itemId, roundId, options) => request("/rooms/" + idPath(id) + "/votes/me", "PUT", { itemId }, roundHeaders(roundId), options)
        };
    }

    function createRoomPoller({ client, roomId, onState, onError, intervalMs = 2500, maxIntervalMs = 15000,
        setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
        idPath(roomId);
        if (typeof client?.getRoom !== "function" || typeof onState !== "function" || typeof onError !== "function" ||
            !Number.isSafeInteger(intervalMs) || intervalMs < 1 || !Number.isSafeInteger(maxIntervalMs) || maxIntervalMs < intervalMs) throw new TypeError("Valid polling dependencies and intervals are required.");
        let current = null;
        function stop() {
            const cycle = current; current = null;
            if (cycle) { if (cycle.timer !== null) clearTimer(cycle.timer); cycle.controller?.abort(); }
        }
        async function tick(cycle) {
            if (current !== cycle) return;
            cycle.controller = new AbortController();
            try {
                const state = await client.getRoom(roomId, { signal: cycle.controller.signal });
                if (current !== cycle) return;
                if (!state || state.id !== roomId || !Number.isSafeInteger(state.revision) || state.revision < 0) throw new MovieNightApiError("INVALID_RESPONSE", "Movie Night returned invalid room state.");
                cycle.delay = intervalMs;
                if (state.revision >= cycle.lastRevision) {
                    cycle.lastRevision = state.revision;
                    onState(state);
                    if (state.status === "complete" && current === cycle) stop();
                }
            } catch (error) {
                if (current !== cycle) return;
                const terminal = error.code === "INVALID_RESPONSE" || (error.status >= 400 && error.status < 500 && error.status !== 429);
                try { onError(error); } catch { stop(); return; }
                if (terminal && current === cycle) stop();
                else cycle.delay = Math.min(cycle.delay * 2, maxIntervalMs);
            } finally {
                cycle.controller = null;
                if (current === cycle) cycle.timer = setTimer(() => { cycle.timer = null; return tick(cycle); }, cycle.delay);
            }
        }
        return {
            start() {
                if (current) return Promise.resolve();
                current = { timer: null, controller: null, lastRevision: -1, delay: intervalMs };
                return tick(current);
            },
            stop,
            isRunning: () => current !== null
        };
    }
    return { createClient, createRoomPoller, MovieNightApiError };
}));
