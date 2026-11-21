/* Account-backed Movie Night UI. Identity always comes from CineFlixAuth. */
(function () {
    "use strict";
    const byId = id => document.getElementById(id);
    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    async function initialize({ isMovieNight }) {
        const auth = window.CineFlixAuth;
        if (!auth || !window.CineFlixMovieNightApi) return false;
        const params = new URLSearchParams(location.search);
        const message = byId("night-mode-message");
        if (params.get("guest") === "1") {
            if (message) message.textContent = "Guest demo — votes stay in this browser and are separate from your account.";
            return false;
        }
        let account = auth.getState();
        if (account.status === "loading") account = await auth.refresh();
        if (account.status === "signed-out" && !params.has("session") && !params.has("room") && params.get("mode") !== "room") {
            if (message) message.textContent = "Guest demo — sign in to save nights to your account or vote across devices.";
            window.addEventListener("cineflix:auth-state", () => {
                if (auth.getState().status === "signed-in") location.reload();
            });
            return false;
        }

        const client = window.CineFlixMovieNightApi.createClient();
        let owner = account.user?.id || null, catalogue, draft = { selectedIds: [], voterCount: 4 };
        let active = null, results = null, busy = false, epoch = 0, needsRefresh = false;
        let render = () => {}, refresh = async () => {}, roomUi = null;
        const feedback = isMovieNight ? byId("night-feedback") : element("p", "", "night-feedback");
        const controls = isMovieNight ? byId("night-account-controls") : null;
        const say = text => { feedback.textContent = text; };
        const currentOwner = () => auth.getState().status === "signed-in" && auth.getState().user?.id === owner;
        const movie = id => catalogue?.movies.find(item => item.id === id) || { id, title: id + " (unavailable)", poster: "" };
        const draftKey = () => "cineflixMovieNightDraft:" + owner;
        function readDraft() {
            draft = { selectedIds: [], voterCount: 4 };
            try {
                const value = JSON.parse(sessionStorage.getItem(draftKey()));
                if (value && Array.isArray(value.selectedIds) && value.selectedIds.length <= 3 &&
                    new Set(value.selectedIds).size === value.selectedIds.length && value.selectedIds.every(id => catalogue.movies.some(m => m.id === id)) &&
                    Number.isInteger(value.voterCount) && value.voterCount >= 2 && value.voterCount <= 10) draft = value;
            } catch { /* A fresh draft is safe; never read the guest vote store. */ }
        }
        function saveDraft(next) {
            try { sessionStorage.setItem(draftKey(), JSON.stringify(next)); draft = next; return true; }
            catch { say("Your selection could not be saved. Enable tab storage and try again."); return false; }
        }
        function setUrl(id) {
            const url = new URL(location.href);
            if (id) { url.searchParams.set("session", id); url.searchParams.delete("new"); }
            else { url.searchParams.delete("session"); url.searchParams.set("new", "1"); }
            history.replaceState(null, "", url);
        }
        function card(id, action) {
            const item = movie(id);
            const node = element("article", undefined, action ? "night-vote-card" : "night-movie");
            const img = element("img"); img.alt = item.title + " poster";
            const fallback = element("div", "Poster unavailable", "night-poster-fallback"); fallback.hidden = true;
            const fail = () => { img.hidden = true; fallback.hidden = false; };
            img.addEventListener("error", fail, { once: true });
            try { const url = new URL(item.poster, document.baseURI); if (!item.poster || !["http:", "https:"].includes(url.protocol)) throw new Error(); img.src = url.href; } catch { fail(); }
            const body = element("div", undefined, action ? "night-vote-body" : "night-movie-text");
            body.append(element("h3", item.title));
            if (action) {
                const button = element("button", "Vote for " + item.title, "night-button"); button.type = "button";
                button.disabled = busy || !currentOwner(); button.addEventListener("click", action); body.append(button);
            } else body.append(element("p", [item.year, item.genre].filter(Boolean).join(" • ")));
            node.append(img, fallback, body); return node;
        }
        function showResults(value) {
            byId("night-winner").textContent = value.isTie ? "It's a tie between: " + value.winners.map(id => movie(id).title).join(", ")
                : "🏆 Winner: " + movie(value.winners[0]).title;
            byId("night-tally").replaceChildren(...value.tallies.map(item => {
                const row = element("div", undefined, "night-result-row");
                row.append(element("span", movie(item.itemId).title), element("span", " — " + item.count + " vote(s)")); return row;
            }));
        }
        async function task(action) {
            if (busy || !currentOwner()) return;
            const token = epoch; busy = true; say(""); render();
            try { await action(() => token === epoch && currentOwner()); }
            catch (error) { if (token === epoch) say(error.message + " Your account data has not been replaced with guest data."); }
            finally {
                if (token === epoch) { busy = false; render(); if (needsRefresh) { needsRefresh = false; await refresh(); } }
            }
        }
        if (!isMovieNight) {
            const grid = document.querySelector(".movie-grid"), section = document.querySelector(".movie-section");
            document.body.classList.add("movie-night-pick");
            const banner = element("div", undefined, "night-select-banner");
            const count = element("p"); count.setAttribute("role", "status"); count.setAttribute("aria-live", "polite");
            const next = element("a", "Continue to Movie Night", "night-button");
            next.href = "movie-night.html?new=1" + (params.get("mode") === "room" ? "&mode=room" : "");
            banner.append(element("h2", "Choose 3 movies for your account"), count, next, feedback);
            section.parentNode.insertBefore(banner, section);
            render = () => {
                const ready = !!catalogue && currentOwner();
                count.textContent = ready ? draft.selectedIds.length + " of 3 movies selected for your account." : "Account or catalogue unavailable. Refresh to retry.";
                next.hidden = !ready || draft.selectedIds.length !== 3;
                grid.querySelectorAll(".movie-card").forEach(node => {
                    const selected = draft.selectedIds.includes(node.dataset.id);
                    node.classList.toggle("night-selected", selected); node.setAttribute("role", "checkbox");
                    node.setAttribute("aria-checked", String(selected)); node.setAttribute("aria-disabled", String(!ready));
                    node.setAttribute("aria-label", (selected ? "Remove " : "Select ") + movie(node.dataset.id).title + " for Movie Night");
                });
            };
            grid.addEventListener("click", event => {
                const node = event.target.closest(".movie-card"); if (!node || !grid.contains(node)) return;
                event.preventDefault(); if (!currentOwner() || !catalogue) return;
                const id = node.dataset.id; if (!catalogue.movies.some(m => m.id === id)) return;
                const selectedIds = draft.selectedIds.includes(id) ? draft.selectedIds.filter(value => value !== id) : [...draft.selectedIds, id];
                if (selectedIds.length > 3) return say("Only 3 movies are allowed. Remove one first.");
                if (saveDraft({ ...draft, selectedIds })) render();
            });
            grid.addEventListener("keydown", event => { if (event.key === " ") { const node = event.target.closest(".movie-card"); if (node) { event.preventDefault(); node.click(); } } });
            grid.addEventListener("auxclick", event => { if (event.target.closest(".movie-card")) event.preventDefault(); });
            document.addEventListener("cineflix:movies-rendered", () => { if (!catalogue && currentOwner()) load(); else render(); });
        } else {
            controls.hidden = false;
            const sessions = byId("night-sessions"), voters = byId("night-voters");
            const start = byId("night-start"), reset = byId("night-reset");
            render = () => {
                const ready = !!catalogue && currentOwner();
                const roomMode = roomUi?.isActive();
                const complete = active?.status === "complete";
                byId("night-setup").hidden = !ready || !!active || roomMode;
                byId("night-voting").hidden = !ready || !active || complete || roomMode;
                byId("night-results").hidden = !ready || !complete || !results || roomMode;
                reset.hidden = !ready || roomMode;
                byId("night-restart").hidden = !active || roomMode;
                for (const node of controls.querySelectorAll("button,select")) node.disabled = busy || !ready;
                byId("night-retry").disabled = busy;
                voters.disabled = busy; start.disabled = busy || !ready || draft.selectedIds.length !== 3;
                reset.disabled = busy; reset.textContent = active ? "Delete session" : "Clear selection";
                if (!active) {
                    byId("night-selected-movies").replaceChildren(...draft.selectedIds.map(id => card(id)));
                } else if (!complete) {
                    byId("night-progress").textContent = "Vote " + (active.votes.length + 1) + " of " + active.voterCount;
                    const id = active._id, revision = active.revision;
                    byId("night-options").replaceChildren(...active.selectedIds.map(itemId => card(itemId, () => task(async valid => {
                        const value = await client.voteSession(id, itemId, revision);
                        const totals = value.status === "complete" ? await client.getSessionResults(id) : null;
                        if (valid()) { active = value; results = totals; }
                    }))));
                } else if (results) showResults(results);
                roomUi?.render();
            };
            refresh = async () => {
                if (busy) { needsRefresh = true; return; }
                await task(async valid => {
                    const list = (await client.listSessions()).sessions;
                    const url = new URL(location.href);
                    const id = url.searchParams.get("session") || (url.searchParams.has("new") ? null : list[0]?._id);
                    const value = id ? await client.getSession(id) : null;
                    const totals = value?.status === "complete" ? await client.getSessionResults(id) : null;
                    if (!valid()) return;
                    active = value; results = totals;
                    sessions.replaceChildren(element("option", "New session")); sessions.firstChild.value = "";
                    for (const entry of list) { const option = element("option", entry.selectedIds.map(id => movie(id).title).join(" / ") + " — " + entry.status); option.value = entry._id; sessions.append(option); }
                    sessions.value = value?._id || "";
                    if (value) setUrl(value._id);
                });
            };
            sessions.addEventListener("change", () => { setUrl(sessions.value || null); refresh(); });
            byId("night-new").addEventListener("click", () => { active = null; results = null; setUrl(null); sessions.value = ""; render(); });
            byId("night-retry").addEventListener("click", () => {
                if (!currentOwner()) auth.refresh(); else if (!catalogue) load(); else if (roomUi?.isActive()) roomUi.refresh(); else refresh();
            });
            voters.addEventListener("change", () => { const count = Number(voters.value); if (Number.isInteger(count) && count >= 2 && count <= 10) saveDraft({ ...draft, voterCount: count }); });
            start.addEventListener("click", () => {
                const voterCount = Number(voters.value);
                task(async valid => {
                if (!Number.isInteger(voterCount) || voterCount < 2 || voterCount > 10) throw new Error("Enter 2 to 10 participants.");
                const value = await client.createSession({ selectedIds: draft.selectedIds, voterCount });
                if (valid()) { active = value; results = null; setUrl(value._id); needsRefresh = true; }
                });
            });
            byId("night-restart").addEventListener("click", () => {
                if (active && confirm("Clear votes and restart this session with the same movies?")) task(async valid => {
                    const value = await client.resetSession(active._id, active.revision); if (valid()) { active = value; results = null; }
                });
            });
            reset.addEventListener("click", () => {
                if (!confirm(active ? "Delete this saved session?" : "Clear your movie selection?")) return;
                task(async valid => { if (active) await client.deleteSession(active._id);
                    if (valid()) { active = null; results = null; saveDraft({ selectedIds: [], voterCount: 4 }); setUrl(null); needsRefresh = true; } });
            });
        }
        async function load() {
            if (!currentOwner()) return render();
            const token = epoch;
            try {
                const value = await window.CineFlixCatalogue.loadCatalogue();
                if (token !== epoch || !currentOwner()) return;
                catalogue = value; readDraft();
                if (isMovieNight && document.activeElement !== byId("night-voters") && !active) byId("night-voters").value = draft.voterCount;
                if (message) message.textContent = "Saved to your account — one-device sequential voting.";
                if (isMovieNight && window.CineFlixMovieNightRooms && !roomUi) roomUi = window.CineFlixMovieNightRooms.create({ client, movie, card,
                    getDraft: () => draft, currentOwner, isBusy: () => busy, task, say, renderSequential: () => render(), refreshSequential: () => refresh() });
                if (roomUi?.isActive()) await roomUi.refresh(); else await refresh();
                render();
            } catch (error) { if (token === epoch) { say(error.message + " Refresh the page to retry. Guest votes have not been changed."); render(); } }
        }
        window.addEventListener("cineflix:auth-state", () => {
            const state = auth.getState();
            if (state.status === "loading") { roomUi?.stop(); render(); return; }
            const nextOwner = state.status === "signed-in" ? state.user.id : null;
            if (nextOwner !== owner) {
                epoch++; owner = nextOwner; active = null; results = null; catalogue = null; busy = false; roomUi?.clear();
                if (message) message.textContent = owner ? "Loading your saved nights…" : "Signed out or account unavailable. Sign in or explicitly choose Guest demo.";
                if (isMovieNight) {
                    for (const id of ["night-selected-movies", "night-options", "night-tally", "night-winner"]) byId(id).replaceChildren();
                    byId("night-sessions").replaceChildren();
                }
            }
            if (owner) { if (busy) needsRefresh = true; else load(); } else { render(); say("Sign in to continue, or choose Guest demo."); }
        });
        if (!owner) {
            const text = account.status === "signed-out" ? "Sign in to open this Movie Night, or explicitly choose Guest demo."
                : "Account status could not be verified. Retry account loading; guest mode has not been selected.";
            if (message) message.textContent = text;
            say(text); render();
        }
        else await load();
        return true;
    }
    window.CineFlixMovieNightAccount = { initialize };
}());
