# Member 4 completion report

Completed 22 November 2026 on `feature/backend-mylist`, based on fetched `origin/main` at `4c3d4f6`. The initial worktree was clean. The previous `fix/catalogue-metadata-completion` branch was preserved. No commits were made on main, no merge or deployment was performed, and no push was requested or performed.

## Delivered features

- Mongoose Watchlist model with authenticated User ownership, stable catalogue `itemId`, all three statuses, default `want-to-watch`, creation/update timestamps and a database-enforced compound unique index.
- All five authenticated REST endpoints, catalogue existence validation, strict POST/PATCH bodies, duplicate `409`, shared JSON errors, Origin protection and user-scoped database operations.
- Same-origin asynchronous frontend client and refactored My List, Details, navbar count and account preview. Status controls, all four filters, search, loading/empty/error/retry states and responsive styling are included.
- Separate persistent guest lists without account merging, safe legacy guest reads, login/logout and account switching, stale-response rejection, duplicate-submission protection and cross-tab refresh.
- Automated schema/API/client/browser regression tests, a tested Postman collection, API documentation and professor demonstration material.

## Five routes

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/my-list` | `200`, `{items:[{itemId,status,addedAt,updatedAt}]}` for the current user |
| POST | `/api/my-list` | `201`, created entry; duplicate `409` |
| PATCH | `/api/my-list/:itemId` | `200`, updated own status |
| DELETE | `/api/my-list/:itemId` | `204`, remove one own entry |
| DELETE | `/api/my-list` | `204`, clear only the current user's list |

All require the shared verified-cookie middleware. Mutations also use the shared Origin safeguard. Ownership always comes from `req.user.id`. See [full API examples and schema](my-list-backend.md).

## Actual verification

Final commands ran successfully with `CINEFLIX_CHROME_PATH` set to the installed Google Chrome executable. Counts overlap: the root command includes backend tests.

| Verification | Actual result |
| --- | --- |
| Root `node --test` | 256 passed, 0 failed, 0 skipped; exit 0 |
| `cd backend` then `npm test` | 154 passed, 0 failed, 0 skipped; exit 0 |
| Focused model/API/validation command | 10 passed, 0 failed |
| Focused My List real-browser flow | 1 passed, including server restart and two accounts |
| Updated authentication real-browser regression | 1 passed |
| Local Postman CLI 1.91.0 collection run with `--no-report-events` | 14 requests and 19 assertions passed; 0 failures |
| `npm ci --ignore-scripts` | Installed existing locked dependencies; audit reported 0 vulnerabilities at execution |
| `git diff --check` | Passed |

Tests cover schema validation, actual unique-index enforcement and concurrent duplicate adds, all five endpoints, invalid IDs/statuses/bodies, unauthorized requests, CSRF rejection, cross-user read/update/delete/clear isolation, empty lists, browser and server restart persistence, API failure recovery, guest storage failure handling, account/session races, Details add/remove, double-click prevention, navbar count and account preview, status filtering and search.

All database tests and the Postman run used disposable local MongoDB. Shared Atlas was untouched. Playwright exercised real cookie authentication and the actual shared server process. Browser screenshots were generated under the local temporary directory and visually inspected at mobile width; automated overflow checks passed at 320, 390, 768 and 1440 pixels. Remote poster requests were deliberately blocked during browser tests so the existing poster fallback could be exercised.

The baseline root suite before implementation passed 243 tests with 3 browser skips (246 total); final verification used installed Chrome and had no skips. A browser test exposed a navbar recovery defect after a simulated API outage; it was fixed with a regression test and the full suites then passed.

## Requirement review and dependencies

Every Member 4 build checklist item in [the supplied team handoff](CineFlix_Backend_Team_Handoff.md) is implemented and verified. Member 1's foundation/catalogue and Member 2's auth prerequisites already existed on main, so the feature integrates their actual implementations. There is no additional database connection or production auth replacement.

The only shared backend edits register the router in `app.js` and ensure the watchlist index before listening in `server.js`. Frontend shared edits are limited to watchlist behavior in Details/navbar/account preview and matching regression fixtures. The team's main README, database connection, User model, login implementation, ratings implementation, catalogue implementation and Movie Night implementation were preserved.

No implementation blocker remains. Ordinary runtime still requires the team's valid ignored backend environment, populated catalogue and database access. A live Atlas demonstration was not attempted; startup index creation and all account flows were verified locally. Guest lists remain local and never merge into accounts. Personal ratings keep their existing separate behavior, owned by Member 3. Integration into main and deployment remain team follow-up actions.

## Suggested pull request

**Title:** `feat(mylist): persist account watchlists with status management`

**Description:** Member 4 adds authenticated watchlist CRUD and status management using the shared Express app, Title model, MongoDB connection and cookie authentication. A unique `(user,itemId)` index prevents duplicate saves; every database operation is scoped to the verified account. My List, Details, navbar and account previews now await the same-origin API and handle loading, errors, session changes and a separate guest list.

Routes: GET/POST/DELETE `/api/my-list` and PATCH/DELETE `/api/my-list/:itemId`. Shared integration changes are limited to app mounting, startup index creation and watchlist-only UI/test adapters. Validation: root Node suite 256/256, backend suite 154/154, real-browser account/refresh/restart/mobile flows and Postman 14 requests/19 assertions. All database verification used disposable local MongoDB; Atlas was not modified. No dependency blocker remains. Screenshots were reviewed locally, and the Postman collection and demo guide are included.

## Simple Postman demonstration

Import [the included collection](postman/CineFlix-MyList.postman_collection.json), set `baseUrl` to the exact `APP_ORIGIN` and run it in order with cookies enabled. It registers a dedicated account, saves `movie-004`, rejects a duplicate, marks it watched, reads it, saves a show, rejects invalid inputs, removes one title, clears the account list and verifies `401` after logout. Every request sends Origin. For manual multi-account proof, use separate cookie jars for A and B and show that clearing A leaves B unchanged. See [the full guide](my-list-demo.md) for CLI and browser demonstration steps.

## Ten easy viva answers

1. **What is My List?** A per-account collection of saved movies and shows with watch status.
2. **Where is it stored?** Signed-in lists are in MongoDB; the separate guest list stays in browser storage.
3. **Which ID identifies a title?** The stable catalogue string ID, such as `movie-004`.
4. **How is the owner determined?** Verified middleware supplies `req.user.id`; the browser cannot choose the owner.
5. **How are other accounts protected?** Every database query includes the current user's ID, and request ownership fields are rejected.
6. **Why a compound unique index?** It prevents duplicate user/title pairs even during concurrent requests.
7. **Which REST methods are used?** GET reads, POST creates, PATCH updates status and DELETE removes one entry or clears the current user's list.
8. **Why async/await?** API responses arrive later; awaiting them avoids treating Promises as saved/not-saved values.
9. **What happens on failures?** The UI reports errors, offers retry and preserves account/guest separation without pretending a failed write succeeded.
10. **How was persistence tested?** Real-browser refresh and actual server restart retained the same disposable database and restored saved titles/statuses.

## Files and commit history

The inventory and complete commit-message list below describe this feature branch relative to its main base. The final documentation commit is included by message. Final worktree status: clean; no uncommitted changes. No dependency lockfile changes or generated test artifacts are included.

### Created files

- `backend/src/controllers/myListController.js`
- `backend/src/models/Watchlist.js`
- `backend/src/routes/myListRoutes.js`
- `backend/src/services/watchlistValidation.js`
- `backend/test/my-list-browser.test.cjs`
- `backend/tests/my-list-api.test.cjs`
- `backend/tests/my-list-model.test.cjs`
- `backend/tests/my-list-validation.test.cjs`
- `docs/CineFlix_Backend_Team_Handoff.md`
- `docs/my-list-backend.md`
- `docs/my-list-demo.md`
- `docs/postman/CineFlix-MyList.postman_collection.json`
- `docs/member4-completion-report.md`

### Modified files

- `backend/README.md`
- `backend/src/app.js`
- `backend/src/server.js`
- `backend/test/auth-browser.test.cjs`
- `css/style.css`
- `js/account-dashboard.js`
- `js/details.js`
- `js/my-list-storage.js`
- `js/mylist.js`
- `js/navigation.js`
- `mylist.html`
- `tests/my-list-storage.test.cjs`
- `tests/mylist.test.cjs`
- `tests/navigation.test.cjs`
- `tests/personal-ratings.test.cjs`

### Commits

Total feature-branch commits: **27**.

1. `feat(mylist): define user-owned watchlist schema and unique index`
2. `feat(mylist): validate catalogue IDs statuses and allowed request fields`
3. `feat(mylist): mount authenticated current-user list endpoint`
4. `feat(mylist): add catalogue-validated titles with duplicate conflict handling`
5. `feat(mylist): update saved status atomically within authenticated ownership`
6. `feat(mylist): remove individual saved titles without crossing user boundaries`
7. `feat(mylist): clear authenticated watchlists with idempotent deletion`
8. `fix(mylist): ensure unique indexes before startup and verify concurrent adds`
9. `test(mylist): cover authentication CSRF and sanitized API failures`
10. `feat(mylist): add async API client and isolated persistent guest lists`
11. `fix(mylist): discard stale account responses and synchronize tabs after writes`
12. `test(mylist): verify API recovery and fail-closed session handling`
13. `feat(mylist): load account watchlists asynchronously with retry and empty states`
14. `feat(mylist): add watch-status controls filters and explicit guest messaging`
15. `feat(mylist): await Details add-remove actions and recover failed requests`
16. `feat(mylist): refresh navbar counts asynchronously with stale-response protection`
17. `feat(mylist): load account dashboard saved titles from authenticated API`
18. `fix(mylist): reject missing item arguments before destructive client operations`
19. `fix(mylist): correct loading labels in watchlist and Details views`
20. `fix(mylist): refresh unavailable navbar counts after successful page retries`
21. `test(mylist): migrate account browser regressions to authenticated saved titles`
22. `test(mylist): exercise real browser persistence isolation filters and failure recovery`
23. `test(mylist): verify duplicate-click protection and successful status retries`
24. `test(mylist): add verified Postman collection for watchlist CRUD and errors`
25. `docs(mylist): document API ownership integration testing and viva demonstration`
26. `docs(mylist): record complete verification files and feature commit history`
27. `docs(mylist): normalize handoff whitespace for clean patch checks`
