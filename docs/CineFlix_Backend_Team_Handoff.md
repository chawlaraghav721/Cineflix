# CINEFLIX — FULL-STACK BACKEND TEAM HANDOFF

**Version:** 1.0
**Prepared:** 18 November 2026
**Repository:** https://github.com/chawlaraghav721/Cineflix
**Team:** 5 developers; one integrated CineFlix application
**Decision (final):** ONE shared MongoDB Atlas database, ONE shared Express backend codebase, ONE MongoDB connection module per running backend process, and FIVE individual feature branches.

> **READ FIRST — FOR CODEX OR ANY CODING ASSISTANT**
>
> If a teammate provides this file and says **“I am Member 1/2/3/4/5. Do my work”**, use the corresponding role in Section 6 as the assigned scope. First inspect the actual repository and check prerequisites in Section 5. Implement that member's backend model, routes, controllers, frontend integration, and tests as specified here. Keep other members' work intact. Do **not** create five separate backends, databases, or MongoDB connection modules. Do **not** silently change agreed API contracts. If prerequisites are missing, implement independent portions, document blockers, and use test doubles only for tests—not hardcoded user IDs in production. Do not merge to `main`, deploy, expose secrets, or claim a feature is tested unless you actually ran its tests. Finish with files changed, routes added, tests run/results, dependencies still pending, and a short viva-demo script.

---

## 1. Project context and goal

The repository currently contains a **vanilla HTML/CSS/JavaScript frontend** using `data/catalogue.json` (20 movies + 10 shows). Existing features include browsing, search/filter/sort, Details, a demo login, My List, 1–5 star ratings, and same-device Movie Night voting. Browser `localStorage`/`sessionStorage` presently stores demo identity, saved titles, ratings, and votes. Existing JavaScript tests live in `tests/` and run via `node --test`.

**Goal:** Preserve the existing frontend while adding Node.js, Express.js, MongoDB Atlas, and Mongoose. Replace browser-only persistence with real account-backed data where appropriate. All five contributors must own meaningful code and be able to independently demonstrate their module.

**In scope:** Express REST APIs; common database; Mongoose models; user authentication; catalogue data; ratings/reviews; watchlist/personalization; Movie Night sessions; browser integration; validation and tests; small targeted UI changes.

**Out of scope for v1:** Real streaming, payments, React rewrite, Google OAuth, email delivery, remote multiplayer/WebSockets, recommendation AI, and unnecessary microservices.

**Source-of-truth IDs:** Retain the existing stable catalogue IDs (example: `movie-004`). Frontend feature APIs use **`itemId` = catalogue `id`**, never MongoDB's internal title `_id`. All user ownership is derived from verified authentication, never an arbitrary `userId` sent by the browser.

---

## 2. Final architecture (non-negotiable)

```text
Browser (existing HTML/CSS/JavaScript)
  | fetch('/api/...') — SAME ORIGIN; cookies included
  v
ONE Node.js / Express backend
  |-- /api/catalogue and /api/titles         [Member 1]
  |-- /api/auth                              [Member 2]
  |-- /api/ratings                           [Member 3]
  |-- /api/my-list                           [Member 4]
  `-- /api/movie-night                       [Member 5]
        |
        v
ONE shared Mongoose connection module (backend/src/config/db.js)
        |
        v
ONE shared MongoDB Atlas database: cineflix
  |-- titles               [M1]
  |-- users                [M2]
  |-- ratings              [M3]
  |-- watchlists           [M4]
  `-- movienightsessions   [M5]
```

Each developer may run their **own local Express process** (therefore each process has its own connection pool), but every process targets the **same shared development database**. Database credentials are distributed privately and loaded from a local ignored `.env`; never commit or paste the URI. Use unique test users/session records to avoid conflicts. Never run a global `dropDatabase` or destructive reset against the shared database.

**Suggested repository layout** (create under the EXISTING repository; do not replace frontend files):

```text
Cineflix/
├── index.html, movies.html, shows.html, details.html, ...  (existing)
├── js/, css/, data/, tests/                             (existing)
└── backend/
    ├── package.json
    ├── .env.example                  # names only; no real secrets
    └── src/
        ├── app.js                   # express setup + route mounting; M1 coordinates
        ├── server.js                # connect + listen; M1
        ├── config/db.js             # ONE shared mongoose.connect; M1
        ├── models/
        │   ├── Title.js             # M1
        │   ├── User.js              # M2
        │   ├── Rating.js            # M3
        │   ├── Watchlist.js         # M4
        │   └── MovieNightSession.js # M5
        ├── controllers/             # each member owns their module
        ├── routes/                  # each member owns their module
        ├── middleware/              # shared auth/error logic, agreed interfaces
        └── scripts/                 # idempotent catalogue seeding; M1
```

Express should serve frontend assets from the repository root so the browser and API share the same origin. **The integrated website is run through Express**, rather than relying on Live Server alone. Keep `.env` ignored; provide `.env.example` placeholders and `backend/README.md` run commands.

---

## 3. Agreed shared contracts — finalize BEFORE parallel coding

### 3.1 API rules

- Prefix everything with `/api` and return JSON from APIs.
- Success response shape is listed per endpoint below. Errors must use `{ "error": { "code": "SOME_CODE", "message": "Human-readable explanation" } }`.
- Use sensible HTTP status codes: `400` invalid input, `401` not logged in, `403` forbidden, `404` missing resource, `409` duplicate/conflict, `500` unexpected server failure.
- Use `itemId` as a string matching `data/catalogue.json` for ALL relationships.
- Frontend sends same-origin cookies using `fetch('/api/...', { credentials: 'same-origin', ... })`; never put credentials or a database URI in frontend code.
- Authentication contract: **HttpOnly, SameSite=Strict cookie containing a signed short-lived JWT**; use `Secure` in HTTPS/production. The browser never reads the token. `requireAuth` middleware verifies the token and attaches `req.user = { id, email, role }`. Default role is `user`, privileged role is `admin`. Include basic Origin/CSRF safeguards for state-changing cookie-authenticated requests; do not enable wide-open credentialed CORS. Sign-out clears the cookie; document that stateless JWTs are not revoked on the server until expiry.
- Use `createdAt`/`updatedAt` via Mongoose timestamps where relevant.
- Do not delete unrelated users' data or accept an unverified `userId` from clients.
- Read and preserve the existing frontend test behavior; update/add tests when intentionally changing from synchronous storage APIs to asynchronous API calls.

### 3.2 API endpoint contract

| Owner | Method and endpoint | Request | Success response / behavior |
|---|---|---|---|
| M1 | `GET /api/health` | — | `{ "status": "ok" }` (may include DB status) |
| M1 | `GET /api/catalogue` | — | `{ "movies": [title], "shows": [title] }` **same shape as existing JSON** |
| M1 | `GET /api/titles` | Query: `type`, `q`, `genre`, `sort`, `page`, `limit` | `{ "items": [title], "total": 0, "page": 1, "limit": 12 }` |
| M1 | `GET /api/titles/:itemId` | stable item ID | one title object; `404` if not found |
| M1 | `POST /api/titles` | complete title | admin only; created title; `201` |
| M1 | `PATCH /api/titles/:itemId` | changed fields | admin only; updated title |
| M1 | `DELETE /api/titles/:itemId` | — | admin only; `204` |
| M2 | `POST /api/auth/register` | `{name,email,password}` | `{ "user": { "id", "name", "email", "role" } }`, set cookie; `201` |
| M2 | `POST /api/auth/login` | `{email,password}` | `{ "user": { "id", "name", "email", "role" } }`, set cookie |
| M2 | `POST /api/auth/logout` | — | `{ "message": "Signed out" }`, clear cookie |
| M2 | `GET /api/auth/me` | cookie | `{ "user": {...} }`, or `401` |
| M3 | `GET /api/ratings/:itemId` | — | `{ "average": number|null, "count": number, "reviews": [...] }` |
| M3 | `GET /api/ratings/:itemId/me` | cookie | `{ "rating": {"score", "reviewText"} | null }`; login required |
| M3 | `PUT /api/ratings/:itemId/me` | `{score,reviewText?}` | upsert own rating; return saved rating |
| M3 | `DELETE /api/ratings/:itemId/me` | — | delete own rating; `204` |
| M4 | `GET /api/my-list` | cookie | `{ "items": [{ "itemId", "status", "addedAt", "updatedAt" }] }` |
| M4 | `POST /api/my-list` | `{itemId,status?}` | create own entry; `201`; duplicate => `409` |
| M4 | `PATCH /api/my-list/:itemId` | `{status}` | updated own entry |
| M4 | `DELETE /api/my-list/:itemId` | — | remove own entry; `204` |
| M4 | `DELETE /api/my-list` | — | clear **current user's** list; `204` |
| M5 | `POST /api/movie-night/sessions` | `{selectedIds:[3 unique movie IDs],voterCount:2..10}` | created own session; `201` |
| M5 | `GET /api/movie-night/sessions` | cookie | `{ "sessions": [...] }` for current user |
| M5 | `GET /api/movie-night/sessions/:sessionId` | cookie | current user's session state |
| M5 | `POST /api/movie-night/sessions/:sessionId/votes` | `{itemId}` | append exactly one next sequential vote; updated state |
| M5 | `GET /api/movie-night/sessions/:sessionId/results` | cookie | `{ "complete", "tallies", "winners", "isTie" }` |
| M5 | `POST /api/movie-night/sessions/:sessionId/reset` | — | reset current session's votes |
| M5 | `DELETE /api/movie-night/sessions/:sessionId` | — | delete own session; `204` |

**Sort values for M1:** support at minimum `title_asc`, `title_desc`, `year_asc`, `year_desc`. Validate pagination and cap `limit` at a sensible maximum (e.g. 50). A catalogue item has `id`, `type: "movie"|"show"`, `title`, `genre`, `poster`, `description`, with optional existing metadata such as `year`, `rating`, `cast`, `director`, `duration`, `trailerUrl`—preserve existing fields and meanings. For admin writes, reject duplicate `id` values.

**Auth ownership:** `req.user.id` is the authenticated user's MongoDB User `_id` represented as a string; only M2 owns token/cookie verification and the User schema. For public ratings summary, M3 does not need login. All mutation endpoints except admin catalogue writes must require auth and enforce ownership.

### 3.3 Data model contracts

| Collection | Minimum fields | Key validation/index |
|---|---|---|
| `titles` (M1) | `id`, `type`, `title`, `genre`, `poster`, `description`, optional catalogue metadata | unique `id`; `type` movie/show |
| `users` (M2) | `name`, `email`, `passwordHash`, `role`, timestamps | unique normalized `email`; role defaults to `user` |
| `ratings` (M3) | `user` ObjectId ref User, `itemId` string, `score`, `reviewText`, timestamps | unique `(user,itemId)`; integer score 1–5; review length limit |
| `watchlists` (M4) | `user` ObjectId ref User, `itemId`, `status`, `addedAt`, `updatedAt` | unique `(user,itemId)`; status `want-to-watch`, `watching`, `watched` |
| `movienightsessions` (M5) | `hostUser` ObjectId, `selectedIds` [3 movie IDs], `voterCount`, `votes` [item IDs / records], `status`, timestamps | only movie IDs; unique selected IDs; 2–10 votes max; owner-only access |

Movie Night is the **existing same-device sequential voting experience**: voter slots are numbered turns, **not separate authenticated accounts**. The logged-in host owns the session. Prevent duplicate turn submissions/race conditions at the database level (e.g. conditional atomic update); the server decides when voting is complete and computes final tallies/winners. Do not describe this as remote multi-user voting unless built separately.

---

## 4. Work order and cross-member dependencies

### Phase 0 — Agree and inspect (everyone; before implementation)

1. Pull the current `main` branch; inspect existing frontend, especially `js/catalogue.js`, `js/login.js`, `js/ratings.js`, `js/my-list-storage.js`, `js/mylist.js`, `js/movie-night.js`, `js/navigation.js`, and `tests/`.
2. Confirm this document's route names, field names, login cookie strategy, ownership rules, and files each member will edit. Report contradictions before implementing a different contract.
3. Each developer creates a personal feature branch from latest `main`. **Do not code directly on `main`.**

### Phase 1 — Foundation: Member 1 (critical prerequisite)

4. Create `backend/`, install dependencies, build Express server and shared `db.js`; serve existing frontend via Express.
5. Add error-handling conventions, `GET /api/health`, title model, and idempotent seeding from `data/catalogue.json` using `id` upserts (NEVER wipe the shared DB).
6. Confirm API reads from actual MongoDB and the old catalogue UI still renders. Publish a small foundation PR; merge after review.

### Phase 2 — Authentication: Member 2 (critical prerequisite for user features)

7. Build User model, secure password hashing, signed cookie login/register/logout/me, `requireAuth`, and admin role check.
8. Test valid login, invalid login, logged-out access, access to other users' data (with a feature endpoint once available), and cookie security. Merge authentication PR.
9. Member 1 can now finish admin-only catalogue POST/PATCH/DELETE (depends on M2 middleware).

### Phase 3 — Feature modules in parallel: Members 3, 4, 5

10. **M3:** Ratings and Reviews, per-user uniqueness, average/rating counts, frontend stars/reviews.
11. **M4:** My List CRUD, status categories, per-user separation, frontend buttons/list/count.
12. **M5:** Movie Night sessions, vote constraints, result calculation, persistence after refresh.
13. Each member writes module tests, uses their branch, and submits an independently reviewable PR. Members may design/write/test module logic early while phases 1–2 progress, but must **not bypass auth** in the final application.

### Phase 4 — Integration and regression (everyone)

14. Member 1 coordinates route mounting in shared `app.js`; Member 2 owns the base authentication/session display; M4 coordinates navbar count changes with M2; M3 and M4 coordinate any shared Details page edits.
15. Merge PRs one by one. Rebase or resolve shared-file conflicts, verify all APIs on the single database, and run old plus new test suites.
16. Run multi-account tests and page-level flows. Update main README only after integrated run instructions are verified.

### Phase 5 — Individual demo and final submission (everyone)

17. Each member personally demonstrates their endpoint(s) using Postman/browser and confirms the MongoDB records that changed.
18. Each member explains their Mongoose schema, route → controller → model request flow, validation/error handling, and one edge case.
19. Group documents known limitations accurately. Do not claim remote voting, streaming, or full production security features that are not implemented.

### Dependency matrix

| Member | Can start independently | Must wait for / integrate with | Shared-file collision risk |
|---|---|---|---|
| M1 | Express scaffold, catalogue seed/GET/search, frontend catalogue adapter | M2 `requireAuth` + admin role for admin-only writes | Owns `backend/src/app.js`, `js/catalogue.js` |
| M2 | User model, auth logic, auth tests | M1 Express scaffold/route mounts; coordinates navigation with M4 | Owns `js/login.js`, likely `js/navigation.js` |
| M3 | Rating model, validation, query logic, isolated tests | M1 title IDs + M2 `requireAuth` for integration; Details overlap with M4 | Owns `js/ratings.js`; coordinate `details.html` |
| M4 | Watchlist model, validation, UI refactor plan, isolated tests | M1 title IDs + M2 `requireAuth`; M2 navigation changes | Owns `js/my-list-storage.js`, `js/mylist.js`; coordinate `js/details-integration.js` / `js/navigation.js` |
| M5 | Movie Night schema, rules, isolated tests | M1 title IDs + M2 `requireAuth` for owner sessions | Owns `js/movie-night.js`, `movie-night.html` |

**Important:** M1's foundation and M2's login are *integration gates*, not a reason for M3–M5 to sit idle. They can write models/controllers and test business logic in parallel against agreed interfaces. Do not create fake production authentication to avoid the dependency.

---

## 5. Pull request, test, and coordination rules

**Branches:** `feature/backend-catalogue`, `feature/backend-auth`, `feature/backend-ratings`, `feature/backend-mylist`, `feature/backend-movie-night`. Create them from current `main` after checking whether a branch already exists.

**Commit style:** Small descriptive commits (example: `feat(mylist): add user-scoped watchlist routes`), not one giant group commit. PR description must state: owner, endpoints, MongoDB model, affected frontend pages, screenshots/Postman proof if available, tests run, dependency blockers, and any shared-file changes.

**Existing tests:** From repository root run `node --test`. **New backend tests:** create and document a repeatable command such as `cd backend && npm test` (Member 1 establishes testing scripts). Never run destructive integration tests against the shared Atlas database; use isolated/mock DB test fixtures or disposable non-shared testing infrastructure only if explicitly authorized. For manual demonstrations, each member should use their own designated test account and prefixed records.

**Secrets/security:** `MONGODB_URI`, `JWT_SECRET`, and environment-specific settings live in ignored `.env`. `.env.example` contains only placeholders. Don't log passwords, JWT secrets, tokens, or connection strings. Ensure errors do not leak internals. Never store passwords in plain text. Seed idempotently; never clear whole collections to "start fresh". Rotate credentials if accidentally shared publicly.

**Definition of done for every member:**

1. All owned API endpoints behave per the contract, with appropriate HTTP codes and validation.
2. Mongoose model/indexes are implemented and data persists across server/browser refreshes.
3. User-owned data is protected from other authenticated users (or admin-only writes are protected for M1).
4. Existing relevant frontend flow works via `fetch()` and displays success/loading/error cases.
5. Unit/API tests were run and actual results are reported; existing relevant tests were preserved or deliberately updated.
6. Branch has focused commits and a reviewable PR; no accidental edits to other members' modules.
7. Member can explain the flow, show one normal case, and demonstrate one failed/edge case.

---

## 6. INDIVIDUAL MEMBER ASSIGNMENTS — Coding-assistant execution scopes

### MEMBER 1 — Shared backend foundation, movie catalogue, search, admin management

**Branch:** `feature/backend-catalogue`
**Relative challenge:** 3.5/5; **viva impact:** 4/5 (subjective estimates).

**Own these files/modules:** `backend/package.json`, `backend/src/app.js`, `backend/src/server.js`, `backend/src/config/db.js`, `backend/src/models/Title.js`, `backend/src/controllers/titleController.js`, `backend/src/routes/titleRoutes.js`, `backend/src/scripts/seedCatalogue.js`, `js/catalogue.js` and catalogue browsing adapters, related backend tests. Coordinate edits to shared route mounts.

**Build checklist:**

- [ ] Set up Express, Mongoose, dotenv, scripts, same-origin static frontend hosting, and reusable error middleware.
- [ ] Connect exactly once in `db.js`; validate startup failure, add a health endpoint.
- [ ] Define Title model matching existing catalogue fields with a unique `id` index.
- [ ] Seed all 30 provided items with upsert by `id`, repeatably and without deleting other data.
- [ ] Implement `GET /api/catalogue` in exact legacy `{movies,shows}` shape plus single-title and server-side filtered/paginated query endpoints.
- [ ] Update catalogue frontend `fetch()` from `data/catalogue.json` to `/api/catalogue` while retaining existing page functionality and error states.
- [ ] After Member 2 auth middleware exists, implement admin-only POST/PATCH/DELETE title endpoints; validate data and duplicate IDs.
- [ ] Test successful query, empty result, bad filter/page, missing ID, duplicate ID, and unauthorized/admin writes.
- [ ] Document backend setup, seed/run scripts, and share the frozen route-mount contract with the team.

**Demo to professor:** Add one catalogue title with authorized Postman API, see it in MongoDB, browse/search it, edit it, then show delete authorization. Explain `app.js` → router → controller → Mongoose → MongoDB.

**Do not:** Create user auth code, ratings, watchlist or voting logic yourself; do not move/rename all existing frontend files just for aesthetic refactoring.

### MEMBER 2 — User authentication and account management

**Branch:** `feature/backend-auth`
**Relative challenge:** 4.5/5; **viva impact:** 4.5/5.

**Own these files/modules:** `backend/src/models/User.js`, auth routes/controller, `backend/src/middleware/requireAuth.js` (and `requireAdmin`), `js/login.js`, necessary registration/login HTML and small navigation auth changes, tests. Route registration into M1's `app.js` via coordinated integration.

**Build checklist:**

- [ ] Define User schema (`name`, normalized unique `email`, `passwordHash`, default `role: user`).
- [ ] Register with server-side validation and password hashing; never return the hash.
- [ ] Login by verifying a hash; generic error for wrong email/password; prevent duplicate emails.
- [ ] Create HttpOnly SameSite=Strict signed-JWT cookie with secure production behavior; use a non-default `JWT_SECRET` from `.env`.
- [ ] Implement `POST /api/auth/logout` and `GET /api/auth/me`.
- [ ] Implement `requireAuth` with `req.user.id`, `email`, `role` and `requireAdmin` (403 for non-admin).
- [ ] Integrate registration/login form, session display, logout and logged-in navigation.
- [ ] Test missing inputs, invalid email, duplicate registration, invalid login, no-cookie API request, tampered/expired cookie, role checks.
- [ ] Clearly document how any admin test account is designated; never provide a public "make me admin" endpoint.

**Demo:** Register, log in, show protected `/me`, show invalid login/unauthorized API rejection, log out. Explain hashing vs encryption, middleware and authorization.

**Do not:** Let frontend-provided user IDs dictate authorization or store JWTs in localStorage. Coordinate navbar edits with M4.

### MEMBER 3 — Personal ratings, written reviews, and average score

**Branch:** `feature/backend-ratings`
**Relative challenge:** 3/5; **viva impact:** 3.5/5.

**Own these files/modules:** `backend/src/models/Rating.js`, ratings route/controller, `js/ratings.js`, minimal review UI for Details, rating tests. Coordinate common Details markup with M4.

**Build checklist:**

- [ ] Define rating schema tied to `req.user.id` and catalogue `itemId` (unique compound index).
- [ ] Validate title exists and `score` is an integer 1–5; add optional `reviewText` with reasonable length limit.
- [ ] Implement public rating summary and authenticated my-rating fetch.
- [ ] Implement `PUT` upsert and `DELETE` only for the current user's rating.
- [ ] Compute average/count from stored rating scores (aggregation or equivalent database query); avoid trusting client averages.
- [ ] Update existing Details-page stars, add compact review form/display, handle loading and failures.
- [ ] Test upsert instead of duplicates, invalid score, nonexistent title, unauthorized mutation, cross-user isolation, average calculation.

**Demo:** Rate as User A, edit rating, rate as User B, demonstrate calculated average, delete own rating. Explain compound unique index and `$group` / aggregation.

**Do not:** Store ratings as the sole source of truth in browser localStorage after login, or change unrelated watchlist code.

### MEMBER 4 — My List watchlist, status management, personalization

**Branch:** `feature/backend-mylist`
**Relative challenge:** 3.5/5; **viva impact:** 4.5/5.

**Own these files/modules:** `backend/src/models/Watchlist.js`, my-list routes/controller, `js/my-list-storage.js`, `js/mylist.js`, coordinated Details/My List button updates and navbar count integration, tests.

**Build checklist:**

- [ ] Define Watchlist schema keyed by authenticated `user` + catalogue `itemId`, with compound uniqueness.
- [ ] Implement current-user `GET`, `POST`, `PATCH`, `DELETE /:itemId`, and `DELETE /` (clear own list) routes.
- [ ] Support statuses `want-to-watch` (default), `watching`, and `watched`.
- [ ] Reject nonexistent title IDs; return `409` for duplicate adds; enforce user isolation.
- [ ] Make My List page load from MongoDB-backed API for signed-in users, with status filters and friendly empty/loading/error states.
- [ ] Update Details add/remove button and saved-item navbar counter; handle login/logout changes.
- [ ] **Important existing-code consideration:** original `CineFlixMyList` storage functions are synchronous. Backend `fetch()` is async. Refactor call sites/tests correctly; do NOT pretend server operations are synchronous or treat an unresolved Promise as a boolean.
- [ ] Define explicit logged-out behavior (e.g. preserve guest-only localStorage with no implicit account merge), and prevent guest/user data leaking across sessions.
- [ ] Test two users' different lists, status edits, duplicate add, delete, clear, refresh persistence, and API-error handling.

**Demo:** Login A → save 3 titles → mark one Watched → refresh → login B (different list) → return to A; show MongoDB records. Explain ownership, REST methods, uniqueness and async `fetch()`.

**Do not:** Implement another auth system or use `userId` from request body to decide record ownership. Coordinate `js/navigation.js` changes with M2.

### MEMBER 5 — Movie Night persistent sessions and voting rules

**Branch:** `feature/backend-movie-night`
**Relative challenge:** 5/5; **viva impact:** 5/5.

**Own these files/modules:** `backend/src/models/MovieNightSession.js`, movie-night route/controller, `js/movie-night.js`, `movie-night.html` as needed, tests.

**Build checklist:**

- [ ] Design session model owned by authenticated host; validate exactly 3 distinct **movie** IDs (not shows) and `voterCount` 2–10.
- [ ] Implement create/list/get/delete session endpoints, scoped to host.
- [ ] Implement vote endpoint that accepts only a selected `itemId`, records next sequential voter slot, and rejects extra votes.
- [ ] Prevent duplicate/concurrent submissions with server-side/atomic safeguards; do not rely solely on button disabling.
- [ ] Compute vote totals, winner(s), and tie state; mark completion only after all configured votes.
- [ ] Implement reset for own session; restore saved session state after refresh.
- [ ] Adapt existing same-device Movie Night UI to backend APIs and preserve selected-movie/vote experience.
- [ ] Test invalid number of movies, duplicate selected IDs, shows instead of movies, unauthorized access, invalid vote, excess vote, ties, refresh restoration, concurrent voting attempts.

**Demo:** Host creates session, picks exactly 3 movies, records 4 votes, refreshes, observes stored progress and final tie/winner. Explain state transitions, atomic validation and user ownership.

**Do not:** Present the feature as live remote multiplayer; the initial product has one logged-in host and sequential local participant slots.

---

## 7. Exact message each member can give Codex

Copy this document into the current CineFlix repository (recommended path: `docs/CineFlix_Backend_Team_Handoff.md`) and use one of these messages in Codex:

```text
I am Member 1 of the CineFlix backend team. Read docs/CineFlix_Backend_Team_Handoff.md fully. Inspect the existing repository and implement ONLY Member 1's assigned tasks in the specified work order. Follow all shared API/schema contracts, preserve the frontend and tests, and report completed work, tests, and blockers. Do not merge into main or deploy.
```

Replace `Member 1` with **Member 2, 3, 4, or 5** as appropriate. If the handoff MD is attached rather than in the repo, say "Read the attached CineFlix_Backend_Team_Handoff.md" instead.

**If a dependency is not ready:** Codex should not replace it with fake production logic. It should complete independent model/controller/tests, clearly describe the missing prerequisite, and leave integration points ready. Once that prerequisite's PR is merged, continue from latest `main`.

**Important:** This is the agreed IMPLEMENTATION PLAN, not a claim that these backend modules already exist or have been tested. Each member must verify actual completion before reporting it to the professor.
