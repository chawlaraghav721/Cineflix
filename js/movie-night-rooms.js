/* Room UI uses the shared account client; no participant identity is sent in bodies. */
(function () {
    "use strict";
    const byId = id => document.getElementById(id);
    function create({ client, movie, card, getDraft, currentOwner, isBusy, task, say, renderSequential, refreshSequential }) {
        let state = null, poller = null, generation = 0;
        const panel = byId("night-room-panel");
        const params = () => new URLSearchParams(location.search);
        const isActive = () => params().get("mode") === "room" || params().has("room");
        function stop() { poller?.stop(); poller = null; }
        function clear() { generation++; stop(); state = null; render(); }
        function roomUrl(id) {
            const url = new URL(location.href); url.searchParams.set("mode", "room");
            url.searchParams.delete("session"); url.searchParams.delete("new");
            if (id) url.searchParams.set("room", id); else url.searchParams.delete("room");
            history.replaceState(null, "", url);
        }
        function update(value) {
            if (!currentOwner() || !isActive()) return;
            if (state?.id === value.id && value.revision < state.revision) return;
            state = value; roomUrl(value.id); renderSequential();
        }
        function report(error) {
            say(error.message + " Account voting has not switched to guest mode.");
            if ([401, 403, 404].includes(error.status)) { state = null; stop(); renderSequential(); }
        }
        function startPolling() {
            stop();
            if (!state || !currentOwner() || !isActive() || document.hidden) return;
            const token = generation;
            poller = window.CineFlixMovieNightApi.createRoomPoller({ client, roomId: state.id,
                onState: value => { if (token === generation && currentOwner()) update(value); },
                onError: error => { if (token === generation && currentOwner()) report(error); } });
            poller.start();
        }
        async function refresh() {
            if (!isActive() || !currentOwner()) return render();
            const id = params().get("room");
            if (!id) return render();
            const token = generation;
            try {
                const value = await client.getRoom(id);
                if (token === generation && currentOwner() && isActive()) { update(value); startPolling(); }
            } catch (error) { if (token === generation && currentOwner()) report(error); }
        }
        function render() {
            const active = isActive(); const ready = currentOwner();
            panel.hidden = !active || !ready;
            byId("night-session-controls").hidden = active;
            byId("night-mode-room").setAttribute("aria-pressed", String(active));
            byId("night-mode-sequential").setAttribute("aria-pressed", String(!active));
            if (!active || !ready) return;
            for (const node of panel.querySelectorAll("button,input")) node.disabled = isBusy();
            byId("night-room-entry").hidden = !!state;
            byId("night-room-state").hidden = !state;
            byId("night-room-selected").replaceChildren(...getDraft().selectedIds.map(id => card(id)));
            byId("night-room-create").disabled = isBusy() || getDraft().selectedIds.length !== 3;
            if (!state) return;
            byId("night-room-code").textContent = state.isHost ? "Room code: " + state.roomCode : "Joined Movie Night room";
            byId("night-room-progress").textContent = state.participantCount + " / " + state.voterCount + " participants — " +
                state.results.tallies.reduce((total, t) => total + t.count, 0) + " / " + state.voterCount + " votes";
            byId("night-room-help").textContent = state.status === "complete" ? "Round complete. Refresh to check for a new round."
                : state.status === "waiting" ? (state.isHost ? "Fill all slots, then start. Join as a voter if you want to participate." : "Waiting for the host to start voting.")
                    : state.hasVoted ? "Your vote is saved. Waiting for the other participants." : "Each participant votes once from their own device.";
            byId("night-room-enroll").hidden = !state.isHost || state.hasJoined || state.status !== "waiting" || state.participantCount >= state.voterCount;
            byId("night-room-start").hidden = !state.isHost || state.status !== "waiting";
            byId("night-room-start").disabled = isBusy() || !state.canStart;
            byId("night-room-reset").hidden = !state.isHost;
            const id = state.id, roundId = state.roundId;
            byId("night-room-options").replaceChildren(...(state.status === "voting" && state.hasJoined && !state.hasVoted
                ? state.selectedIds.map(itemId => card(itemId, () => task(async valid => {
                    const value = await client.voteRoom(id, itemId, roundId); if (valid()) { update(value); startPolling(); }
                }))) : []));
            byId("night-room-winner").textContent = !state.results.complete ? "" : state.results.isTie
                ? "It's a tie between: " + state.results.winners.map(id => movie(id).title).join(", ")
                : "🏆 Winner: " + movie(state.results.winners[0]).title;
            byId("night-room-tally").replaceChildren(...state.results.tallies.map(item => {
                const row = document.createElement("p"); row.className = "night-result-row";
                row.textContent = movie(item.itemId).title + " — " + item.count + " vote(s)"; return row;
            }));
        }
        byId("night-mode-room").addEventListener("click", () => { roomUrl(state?.id); renderSequential(); refresh(); });
        byId("night-mode-sequential").addEventListener("click", () => {
            generation++; stop(); const url = new URL(location.href); url.searchParams.delete("mode"); url.searchParams.delete("room");
            history.replaceState(null, "", url); renderSequential(); refreshSequential();
        });
        byId("night-room-create").addEventListener("click", () => {
            const voterCount = Number(byId("night-room-voters").value);
            task(async valid => {
                if (!Number.isInteger(voterCount) || voterCount < 2 || voterCount > 10) throw new Error("Enter 2 to 10 participant slots.");
                const value = await client.createRoom({ selectedIds: getDraft().selectedIds, voterCount });
                if (valid()) { generation++; update(value); startPolling(); }
            });
        });
        byId("night-room-join").addEventListener("submit", event => {
            event.preventDefault(); const code = byId("night-room-code-input").value;
            task(async valid => { const value = await client.joinRoom(code); if (valid()) { generation++; update(value); startPolling(); } });
        });
        byId("night-room-enroll").addEventListener("click", () => task(async valid => {
            const value = await client.joinRoom(state.roomCode); if (valid()) { update(value); startPolling(); }
        }));
        byId("night-room-start").addEventListener("click", () => task(async valid => {
            const value = await client.startRoom(state.id, state.revision); if (valid()) { update(value); startPolling(); }
        }));
        byId("night-room-reset").addEventListener("click", () => {
            if (!state || !confirm("Clear room votes and start a fresh round with the same participants?")) return;
            task(async valid => { const value = await client.resetRoom(state.id, state.revision); if (valid()) { update(value); startPolling(); } });
        });
        byId("night-room-refresh").addEventListener("click", () => { say(""); refresh(); });
        byId("night-room-new").addEventListener("click", () => { clear(); roomUrl(null); renderSequential(); });
        document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else refresh(); });
        window.addEventListener("pagehide", stop);
        return { isActive, render, refresh, clear, stop };
    }
    window.CineFlixMovieNightRooms = { create };
}());
