/* Movie Night voting — frontend-only, same-device demo. */
document.addEventListener("DOMContentLoaded", function () {
    const STORAGE_KEY = "cineflixMovieNightV1";

    // One object contains the complete state of the current voting session.
    function emptyState() {
        return { selected: [], voters: 4, votes: [], started: false };
    }

    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (saved && Array.isArray(saved.selected) &&
                Array.isArray(saved.votes) &&
                Number.isInteger(saved.voters) &&
                saved.voters >= 2 && saved.voters <= 10 &&
                typeof saved.started === "boolean") {
                return saved;
            }
        } catch (error) {
            // Invalid or unavailable browser storage starts a new session.
        }
        return emptyState();
    }

    function saveState(state) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            return true;
        } catch (error) {
            alert("Browser storage is unavailable. Please enable local storage and try again.");
            return false;
        }
    }

    const state = loadState();

    // The existing Movies page becomes a selectable catalogue only in Movie Night mode.
    function setupMovieSelection() {
        const grid = document.querySelector(".movie-grid");
        const section = document.querySelector(".movie-section");
        if (!grid || !section) return;

        document.body.classList.add("movie-night-pick");

        const banner = document.createElement("div");
        banner.className = "night-select-banner";
        const heading = document.createElement("h2");
        heading.textContent = "Choose 3 movies for Movie Night";
        const count = document.createElement("p");
        count.setAttribute("role", "status");
        count.setAttribute("aria-live", "polite");
        const continueButton = document.createElement("button");
        continueButton.type = "button";
        continueButton.className = "night-button";
        continueButton.textContent = "Continue to Movie Night";
        continueButton.addEventListener("click", function () {
            window.location.href = "movie-night.html";
        });
        const back = document.createElement("a");
        back.href = "movie-night.html";
        back.className = "night-button night-button-outline";
        back.textContent = "Back";

        banner.append(heading, count, continueButton, back);
        section.parentNode.insertBefore(banner, section);

        function refreshSelection() {
            count.textContent = state.selected.length + " of 3 movies selected. Click a card to select or remove it.";
            continueButton.disabled = state.selected.length !== 3;
            grid.querySelectorAll(".movie-card").forEach(function (card) {
                const title = card.querySelector("h3")?.textContent.trim();
                const selected = state.selected.some(function (movie) {
                    return movie.title === title;
                });
                card.classList.toggle("night-selected", selected);
                if (title) card.setAttribute("aria-label", (selected ? "Remove " : "Select ") + title);
            });
        }

        if (state.started) {
            count.textContent = "Voting has already started. Reset the session before changing movies.";
            continueButton.disabled = false;
            grid.style.pointerEvents = "none";
            return;
        }

        grid.addEventListener("click", function (event) {
            const card = event.target.closest(".movie-card");
            if (!card || !grid.contains(card)) return;
            event.preventDefault(); // Do not open details while selecting a movie.

            const title = card.querySelector("h3")?.textContent.trim();
            const image = card.querySelector("img");
            if (!title || !image) return;

            const existing = state.selected.findIndex(function (movie) {
                return movie.title === title;
            });

            if (existing !== -1) {
                state.selected.splice(existing, 1);
            } else if (state.selected.length < 3) {
                state.selected.push({
                    title: title,
                    poster: image.getAttribute("src"),
                    meta: card.querySelector(".movie-info p")?.textContent.trim() || ""
                });
            } else {
                count.textContent = "Only 3 movies are allowed. Remove one before selecting another.";
                return;
            }

            if (saveState(state)) refreshSelection();
        });
        refreshSelection();
    }

    // All remaining interactions happen on the dedicated Movie Night page.
    function setupMovieNight() {
        const setup = document.getElementById("night-setup");
        const voting = document.getElementById("night-voting");
        const results = document.getElementById("night-results");
        const selectedContainer = document.getElementById("night-selected-movies");
        const voteContainer = document.getElementById("night-options");
        const votersInput = document.getElementById("night-voters");
        const progress = document.getElementById("night-progress");
        const winner = document.getElementById("night-winner");
        const tally = document.getElementById("night-tally");
        const feedback = document.getElementById("night-feedback");
        const startButton = document.getElementById("night-start");
        const resetButton = document.getElementById("night-reset");

        function makeMovieCard(movie, allowVoting) {
            const card = document.createElement("article");
            card.className = allowVoting ? "night-vote-card" : "night-movie";
            const image = document.createElement("img");
            image.src = movie.poster;
            image.alt = movie.title + " poster";
            const body = document.createElement("div");
            body.className = allowVoting ? "night-vote-body" : "night-movie-text";
            const title = document.createElement("h3");
            title.textContent = movie.title;
            body.appendChild(title);
            if (allowVoting) {
                const button = document.createElement("button");
                button.className = "night-button";
                button.type = "button";
                button.textContent = "Vote for " + movie.title;
                button.addEventListener("click", function () {
                    if (!state.started || state.votes.length >= state.voters) return;
                    state.votes.push(movie.title);
                    if (saveState(state)) render();
                    else state.votes.pop();
                });
                body.appendChild(button);
            } else {
                const meta = document.createElement("p");
                meta.textContent = movie.meta;
                body.appendChild(meta);
            }
            card.append(image, body);
            return card;
        }

        function showResults() {
            const counts = state.selected.map(function (movie) {
                return {
                    title: movie.title,
                    count: state.votes.filter(function (vote) { return vote === movie.title; }).length
                };
            });
            const highest = Math.max(...counts.map(function (item) { return item.count; }));
            const winners = counts.filter(function (item) { return item.count === highest; });
            winner.textContent = winners.length === 1
                ? "🏆 Winner: " + winners[0].title
                : "It's a tie between: " + winners.map(function (item) { return item.title; }).join(", ");

            tally.replaceChildren();
            counts.forEach(function (item) {
                const row = document.createElement("div");
                row.className = "night-result-row";
                const heading = document.createElement("div");
                heading.className = "night-result-heading";
                const name = document.createElement("span");
                name.textContent = item.title;
                const value = document.createElement("span");
                value.textContent = item.count + " vote(s)";
                heading.append(name, value);
                const bar = document.createElement("div");
                bar.className = "night-bar";
                const fill = document.createElement("div");
                fill.className = "night-bar-fill";
                fill.style.width = (item.count / state.voters * 100) + "%";
                bar.appendChild(fill);
                row.append(heading, bar);
                tally.appendChild(row);
            });
        }

        function render() {
            const finished = state.started && state.votes.length >= state.voters;
            setup.hidden = state.started;
            voting.hidden = !state.started || finished;
            results.hidden = !finished;

            if (!state.started) {
                votersInput.value = state.voters;
                startButton.disabled = state.selected.length !== 3;
                selectedContainer.replaceChildren();
                state.selected.forEach(function (movie) {
                    selectedContainer.appendChild(makeMovieCard(movie, false));
                });
                for (let i = state.selected.length; i < 3; i++) {
                    const slot = document.createElement("div");
                    slot.className = "night-empty";
                    slot.textContent = "Movie " + (i + 1) + " not selected";
                    selectedContainer.appendChild(slot);
                }
            } else if (!finished) {
                progress.textContent = "Vote " + (state.votes.length + 1) + " of " + state.voters;
                voteContainer.replaceChildren();
                state.selected.forEach(function (movie) {
                    voteContainer.appendChild(makeMovieCard(movie, true));
                });
            } else {
                showResults();
            }
        }

        startButton.addEventListener("click", function () {
            const voters = Number(votersInput.value);
            if (state.selected.length !== 3 || !Number.isInteger(voters) || voters < 2 || voters > 10) {
                feedback.textContent = "Choose exactly 3 movies and enter 2 to 10 participants.";
                return;
            }
            state.voters = voters;
            state.votes = [];
            state.started = true;
            if (saveState(state)) {
                feedback.textContent = "";
                render();
            } else {
                state.started = false;
            }
        });

        resetButton.addEventListener("click", function () {
            if (!window.confirm("Reset the entire Movie Night and delete all votes?")) return;
            const fresh = emptyState();
            Object.assign(state, fresh);
            if (saveState(state)) {
                feedback.textContent = "Movie Night has been reset.";
                render();
            }
        });

        render();
    }

    if (document.body.dataset.page === "movie-night") {
        setupMovieNight();
    } else if (new URLSearchParams(window.location.search).get("movieNight") === "1") {
        setupMovieSelection();
    }
});
