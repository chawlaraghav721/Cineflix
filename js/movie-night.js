/* Movie Night voting — frontend-only, same-device demo. */
document.addEventListener("DOMContentLoaded", async function () {
    "use strict";

    const isMovieNight = document.body.dataset.page === "movie-night";
    const isSelection = new URLSearchParams(window.location.search).get("movieNight") === "1";
    if (!isMovieNight && !isSelection) return;

    const STORAGE_KEY = "cineflixMovieNightV1";
    const catalogueApi = window.CineFlixCatalogue;
    let catalogue = null;
    let loadFailed = false;
    let storageReadable = true;
    let state = emptyState();
    let notice = "";
    let refreshView = function () {};
    let showFeedback = function () {};

    // One object contains the complete state of the current voting session.
    function emptyState() {
        return { selected: [], voters: 4, votes: [], started: false };
    }

    function loadState() {
        let stored;
        try {
            stored = localStorage.getItem(STORAGE_KEY);
        } catch (error) {
            storageReadable = false;
            notice = "The saved session could not be read. Enable browser storage and refresh the page before making changes.";
            return emptyState();
        }
        try {
            const saved = JSON.parse(stored);
            if (saved === null) return emptyState();
            if (!saved || !Array.isArray(saved.selected) || !Array.isArray(saved.votes) ||
                !Number.isInteger(saved.voters) || saved.voters < 2 || saved.voters > 10 ||
                typeof saved.started !== "boolean") {
                notice = "The saved Movie Night session was invalid. Please choose your movies again.";
                return emptyState();
            }

            // Older sessions stored movie objects and title-based votes.
            // Resolve them here; the next successful action saves only IDs.
            const selected = [];
            for (const entry of saved.selected) {
                let movie = null;
                if (typeof entry === "string") {
                    movie = getMovie(entry);
                    if (!movie) {
                        const matches = catalogue.movies.filter(item => item.title === entry);
                        if (matches.length === 1) movie = matches[0];
                    }
                } else if (entry && typeof entry.id === "string") {
                    movie = getMovie(entry.id);
                } else if (entry && typeof entry.title === "string") {
                    const matches = catalogue.movies.filter(item => item.title === entry.title);
                    if (matches.length === 1) movie = matches[0];
                }
                if (movie && !selected.includes(movie.id) && selected.length < 3) selected.push(movie.id);
            }

            const votes = saved.votes.map(function (vote) {
                if (typeof vote !== "string") return null;
                if (selected.includes(vote)) return vote;
                const matches = selected.filter(id => getMovie(id).title === vote);
                return matches.length === 1 ? matches[0] : null;
            });
            const invalidSelection = selected.length !== saved.selected.length;
            const invalidVotes = votes.includes(null) || votes.length > saved.voters ||
                (!saved.started && votes.length > 0);
            const started = saved.started && selected.length === 3 && !invalidSelection && !invalidVotes;
            if (invalidSelection || invalidVotes || (saved.started && !started)) {
                notice = "Some saved movies or votes are no longer valid. Voting was cleared; please check your selection before starting again.";
            }
            return { selected: selected, voters: saved.voters, votes: started ? votes : [], started: started };
        } catch (error) {
            notice = "The saved Movie Night data was invalid. Please choose your movies again.";
        }
        return emptyState();
    }

    function getMovie(id) {
        const item = catalogueApi.getItemById(catalogue, id);
        return item && item.type === "movie" ? item : null;
    }

    function saveState(nextState) {
        try {
            if (!storageReadable) throw new Error("The saved session could not be read.");
            localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
            state = nextState;
            showFeedback("");
            return true;
        } catch (error) {
            showFeedback("Browser storage is unavailable. Your change was not saved. Please enable local storage and try again.");
            return false;
        }
    }

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
        const feedback = document.createElement("p");
        feedback.className = "night-feedback";
        feedback.setAttribute("role", "status");
        showFeedback = message => { feedback.textContent = message; };
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

        banner.append(heading, count, continueButton, back, feedback);
        section.parentNode.insertBefore(banner, section);

        function refreshSelection() {
            count.textContent = !catalogue ? (loadFailed ? "Movie selection is unavailable." : "Loading movie selection…")
                : state.started ? "Voting has already started. Reset the session before changing movies."
                    : state.selected.length + " of 3 movies selected. Use Enter or Space to select or remove a movie.";
            continueButton.disabled = !catalogue || state.selected.length !== 3;
            grid.querySelectorAll(".movie-card").forEach(function (card) {
                const title = card.querySelector("h3")?.textContent.trim();
                const selected = state.selected.includes(card.dataset.id);
                card.classList.toggle("night-selected", selected);
                card.setAttribute("role", "checkbox");
                card.setAttribute("aria-checked", String(selected));
                card.setAttribute("aria-disabled", String(!catalogue || state.started));
                if (title) {
                    const meta = card.querySelector(".movie-info p")?.textContent.trim();
                    const movieLabel = title + (meta ? ", " + meta : "");
                    card.setAttribute("aria-label", (selected ? "Remove " : "Select ") + movieLabel + " " +
                        (selected ? "from" : "for") + " Movie Night");
                }
            });
        }

        grid.addEventListener("click", function (event) {
            const card = event.target.closest(".movie-card");
            if (!card || !grid.contains(card)) return;
            event.preventDefault(); // Do not open details while selecting a movie.
            if (!catalogue || state.started) return;
            const movie = getMovie(card.dataset.id);
            if (!movie) return;
            const selected = state.selected.slice();
            const existing = selected.indexOf(movie.id);

            if (existing !== -1) {
                selected.splice(existing, 1);
            } else if (selected.length < 3) {
                selected.push(movie.id);
            } else {
                count.textContent = "Only 3 movies are allowed. Remove one before selecting another.";
                return;
            }

            if (saveState({ ...state, selected: selected })) refreshSelection();
        });
        grid.addEventListener("keydown", function (event) {
            const card = event.target.closest(".movie-card");
            if ((event.key === " " || event.key === "Spacebar") && card && grid.contains(card)) {
                event.preventDefault();
                card.click();
            }
        });
        grid.addEventListener("auxclick", function (event) {
            if (event.target.closest(".movie-card")) event.preventDefault();
        });
        document.addEventListener("cineflix:movies-rendered", refreshSelection);
        refreshView = refreshSelection;
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
        showFeedback = message => { feedback.textContent = message; };

        function makeMovieCard(movie, allowVoting) {
            const card = document.createElement("article");
            card.className = allowVoting ? "night-vote-card" : "night-movie";
            const image = document.createElement("img");
            image.alt = movie.title + " poster";
            const fallback = document.createElement("div");
            fallback.className = "night-poster-fallback";
            fallback.textContent = "Poster unavailable";
            fallback.setAttribute("role", "img");
            fallback.setAttribute("aria-label", "Poster unavailable for " + movie.title);
            fallback.hidden = true;
            image.addEventListener("error", function () {
                image.hidden = true;
                fallback.hidden = false;
            }, { once: true });
            try {
                const url = new URL(movie.poster, document.baseURI);
                if (!movie.poster.trim() || !["http:", "https:"].includes(url.protocol)) throw new Error("Invalid poster");
                image.src = url.href;
            } catch (error) {
                image.hidden = true;
                fallback.hidden = false;
            }
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
                const turnVotes = state.votes;
                button.addEventListener("click", function () {
                    if (!state.started || state.votes !== turnVotes || state.votes.length >= state.voters) return;
                    if (saveState({ ...state, votes: [...state.votes, movie.id] })) render();
                });
                body.appendChild(button);
            } else {
                const meta = document.createElement("p");
                meta.textContent = [movie.year, movie.genre].filter(Boolean).join(" • ");
                body.appendChild(meta);
            }
            card.append(image, fallback, body);
            return card;
        }

        function showResults() {
            const counts = state.selected.map(function (id) {
                return {
                    title: getMovie(id).title,
                    count: state.votes.filter(function (vote) { return vote === id; }).length
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
                startButton.disabled = !catalogue || state.selected.length !== 3;
                selectedContainer.replaceChildren();
                state.selected.forEach(function (id) {
                    selectedContainer.appendChild(makeMovieCard(getMovie(id), false));
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
                state.selected.forEach(function (id) {
                    voteContainer.appendChild(makeMovieCard(getMovie(id), true));
                });
            } else {
                showResults();
            }
        }

        startButton.addEventListener("click", function () {
            const voters = Number(votersInput.value);
            if (!catalogue || state.selected.length !== 3 || !Number.isInteger(voters) || voters < 2 || voters > 10) {
                feedback.textContent = "Choose exactly 3 movies and enter 2 to 10 participants.";
                return;
            }
            if (saveState({ ...state, voters: voters, votes: [], started: true })) {
                feedback.textContent = "";
                render();
            }
        });

        resetButton.addEventListener("click", function () {
            if (!window.confirm("Reset the entire Movie Night and delete all votes?")) return;
            if (saveState(emptyState())) {
                feedback.textContent = "Movie Night has been reset.";
                render();
            }
        });

        refreshView = render;
        render();
    }

    if (isMovieNight) {
        setupMovieNight();
    } else {
        setupMovieSelection();
    }
    showFeedback("Loading movie catalogue…");
    try {
        catalogue = await catalogueApi.loadCatalogue();
        state = loadState();
        refreshView();
        showFeedback(notice);
    } catch (error) {
        loadFailed = true;
        catalogue = null;
        refreshView();
        showFeedback("Movie Night could not load the catalogue. Please refresh the page to try again. Your saved session has not been changed.");
    }
});
