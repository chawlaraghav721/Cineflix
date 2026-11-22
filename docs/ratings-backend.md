# Account ratings and reviews

Signed-in viewers save one score and an optional written review per catalogue
title. Details restores that account's data after reload; My Account displays
the same server-backed rated-title collection. Guests keep the existing,
separate browser-only scores. No guest ratings are imported into accounts.

## Request flow

```text
Details / account dashboard
  -> same-origin ratings client
  -> shared Express router + existing authentication/mutation guards
  -> controller -> service -> repository -> Rating model
  -> existing shared Mongoose connection -> ratings collection
```

Routes register HTTP methods and middleware; controllers implement response
contracts; the service validates input, identity and catalogue existence; the
repository builds explicit owner-scoped queries and aggregation pipelines.
There is no new server, User model, authentication system or database connection.

## Persistence and indexes

| Field | Constraint |
| --- | --- |
| `user` | Required, immutable User ObjectId reference derived from `req.user.id` |
| `itemId` | Required immutable stable catalogue ID, up to 128 characters |
| `score` | Required integer from 1 through 5; string/boolean coercion rejected |
| `reviewText` | Optional trimmed text, default empty string, maximum 2000 characters |
| `createdAt`, `updatedAt` | Mongoose timestamps |

`Rating` uses the existing `ratings` collection and shared Mongoose connection.
`unique_user_rating_item` is a unique `{user: 1, itemId: 1}` index. The
`recent_title_reviews` index is `{itemId: 1, updatedAt: -1, _id: -1}`. The unique
index also supports account collection reads by user and catalogue ID.

Normal server startup awaits `Rating.createIndexes()` before listening. Index
creation never drops indexes or records. An incompatible pre-existing duplicate
causes startup to fail rather than accept mutations without uniqueness. Resolve
such data through a coordinated review; never reset the shared database.

PUT uses an atomic owner/title upsert. A matching duplicate-key race retries
once as an update of the same record. Concurrent edits use last-write-wins
semantics; they never create multiple ratings or change another account's row.
Creation time stays unchanged when editing, while modification time advances.
Catalogue metadata such as `Title.rating` is never updated by account ratings.

## API

All endpoints return JSON except successful DELETE, and use `Cache-Control:
no-store`. `itemId` is the stable `Title.id`, never a Title ObjectId. Every
title-scoped operation verifies the title exists in MongoDB.

| Endpoint | Access | Success |
| --- | --- | --- |
| `GET /api/ratings/:itemId` | Public | `200 {average: number|null, count: number, reviews: [...]}` |
| `GET /api/ratings/:itemId/me` | Cookie login | `200 {rating: {score, reviewText}|null}` |
| `PUT /api/ratings/:itemId/me` | Cookie login, trusted Origin/Referer | `{score, reviewText?}` -> `200 {score, reviewText}` |
| `DELETE /api/ratings/:itemId/me` | Cookie login, trusted Origin/Referer | Idempotent `204`, empty body |
| `GET /api/ratings` | Cookie login | `200 {items: [{itemId, score, reviewText, createdAt, updatedAt}]}` |

The final endpoint is an additive private collection read for the existing
dashboard; the four agreed title contracts are preserved. It avoids a separate
request for every catalogue title. Its scope is always the verified account.

A score-only PUT preserves the previous review. `reviewText: ""` clears written
text without deleting the score. DELETE removes both score and review and also
succeeds when that account has no rating for the existing title. PUT rejects
unexpected properties, including ownership fields and MongoDB operators. DELETE
rejects rating fields, and ratings endpoints reject query parameters.

Example PUT body and response:

```json
{"score":5,"reviewText":"A compelling story."}
```

Public summaries aggregate every stored score for the title, including scores
without reviews. Empty titles return `{average: null, count: 0, reviews: []}`.
At most 20 nonempty reviews are returned, sorted by `updatedAt` descending and
then `_id` descending to break ties deterministically. Each public review contains
only score, text and creation/modification timestamps. No user names, emails,
user IDs or internal database IDs are exposed.

Failures follow `{error: {code, message}}`: `400` for invalid input/JSON, `401` for
missing/invalid/expired sessions or deleted accounts, `403` for invalid Origin,
`404` for unknown titles, `409 ACCOUNT_CHANGED` for a stale account guard,
`413` for oversized bodies, and generic `500` for unexpected failures.

## Security and browser state

Private routes reuse `requireAuth`; PUT/DELETE reuse `protectMutation`. Requests
use same-origin credentials and the existing HttpOnly cookie lifecycle. Only
verified `req.user.id` scopes queries. No request-body identity, client average
or arbitrary MongoDB update is accepted.

The browser optionally sends `X-Ratings-Account` with the account associated
with its draft. The server rejects a mismatch with the cookie identity. This
comparison prevents a draft from being written to an account switched between
UI selection and request processing; the header never grants access. Non-browser
API clients may omit it.

The browser client checks the current `CineFlixAuth` identity before requests,
after HTTP responses and after JSON parsing. Details and dashboard invalidate
old asynchronous work on authentication changes and immediately clear private
state while identity is loading. A failed account request never falls back to
guest storage. Missing ratings assets disable controls while Details remains
usable. Reviews use `textContent`, preserving HTML characters as literal text.

Selecting a star changes the account draft; **Save rating & review** commits it.
Clear Rating removes the saved score and text. A missing write response may
follow a successful database write, so failed writes require a refresh before
another mutation. Requests time out after 15 seconds and are not automatically
replayed. Successful writes send a credential-free change notification to other
tabs; private ratings never enter browser storage.

The account dashboard reads ratings and My List independently. A ratings failure
shows an unavailable count and retry feedback while a healthy watchlist remains
visible. Guest scores cannot supply account counts or badges. Existing watchlist
statuses, navbar counts, catalogue, trailers and Movie Night interfaces remain
unchanged.

## Run and test

Use [the shared backend setup](../backend/README.md): install existing dependencies
with `npm ci` in `backend/`, configure the ignored `.env` privately, then run
`npm start`. No new dependencies or environment variables are required.

PowerShell test commands from the repository root:

```powershell
$env:CINEFLIX_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test --test-concurrency=1
Set-Location backend
npm.cmd test -- --test-concurrency=1
```

Alternatively install Chromium with `npx playwright install chromium` in
`backend/`. Browser tests explicitly skip when neither Chromium nor a configured
executable exists. `npm.cmd`/`npx.cmd` avoids PowerShell execution-policy issues.
The existing `test:browser` script runs authentication only; full runs include
ratings, My List and Movie Night browser tests. Serial files reduce resource
contention while individual database concurrency tests still issue parallel
requests. The first run may download the disposable MongoDB binary.

Ratings tests cover strict schema/payload validation, real indexes and 24
concurrent repository upserts, reconnect persistence, timestamps, deterministic
bounded community reviews, real HTTP/JWT/Origin security, 20 concurrent API
writes and the private dashboard collection. Chrome checks cover save/edit/text
clearing/deletion, safe HTML rendering, guest separation, independent accounts,
backend restart, keyboard controls, mobile viewports, lost successful responses,
read/summary/auth failures, missing assets, dashboard/watchlist independence and
delayed responses during cross-tab logout/account changes.

All test databases use explicit disposable local URIs, never the shared Atlas
URI. See [browser and Postman demonstration](ratings-demo.md). Exact full-suite
results appear below and in the PR; no manual Postman run is claimed by the
automated tests.

## Verification on 22 November 2026

| Executed suite/check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Root `node --test --test-concurrency=1` | 298 | 0 | 0 |
| Backend `npm.cmd test -- --test-concurrency=1` | 192 | 0 | 0 |
| Frontend files `node --test tests/*.test.cjs tests/*.test.js` | 106 | 0 | 0 |
| JavaScript syntax checks | 109 | 0 | 0 |

The root count includes the backend/frontend counts; these totals are not
additive. There are 42 new ratings checks, including real database and browser
coverage. Runs used Node 22.23.4 and installed Chrome through
`CINEFLIX_CHROME_PATH`. Desktop and mobile screenshots were visually inspected.
Whitespace checks and an added-diff secret/forbidden-path scan passed. Existing
authentication, catalogue/search/filter/sort, My List/status/count/dashboard,
navigation, trailer, sequential Movie Night and multi-device room checks passed.

The first full run exposed a legacy guest fixture that omitted the new scripts;
it was migrated to run the actual integrated controls while preserving all
guest assertions. The final complete runs above passed without suppressions or
skips. No shared Atlas data was modified and no deployment was performed.

## Boundaries and historical context

Shared Atlas stress testing, deployment and physical mobile-device testing are
outside this verification. Browser contexts represent independent accounts and
mobile viewport emulation. Automated runs block external poster requests, so
they verify fallback layout rather than third-party image availability. The
existing stateless JWT limitation remains: copied tokens may work until expiry.

The [earlier ratings branch](https://github.com/chawlaraghav721/Cineflix/tree/feature/backend-ratings-reviews)
remains a reference for earlier design and regression scenarios, with its original
authorship intact. None of its commits were merged, cherry-picked or rewritten
for this branch. This implementation targets the current integrated My List,
authentication and dashboard interfaces.

## Changed-file inventory

The feature changes these 36 files relative to current main:

```text
README.md
backend/README.md
backend/src/app.js
backend/src/controllers/ratingController.js
backend/src/models/Rating.js
backend/src/repositories/ratingRepository.js
backend/src/routes/ratingRoutes.js
backend/src/server.js
backend/src/services/ratingService.js
backend/src/services/ratingValidation.js
backend/test-support/ratingsBrowser.cjs
backend/test-support/ratingsDatabase.cjs
backend/test-support/ratingsHttp.cjs
backend/test/auth-browser.test.cjs
backend/test/ratings-api.test.cjs
backend/test/ratings-assets-browser.test.cjs
backend/test/ratings-browser.test.cjs
backend/test/ratings-collection.test.cjs
backend/test/ratings-dashboard-browser.test.cjs
backend/test/ratings-recovery-browser.test.cjs
backend/tests/rating-community.test.cjs
backend/tests/rating-model.test.cjs
backend/tests/rating-repository.test.cjs
backend/tests/rating-service.test.cjs
backend/tests/rating-validation.test.cjs
css/ratings.css
details.html
docs/ratings-backend.md
docs/ratings-demo.md
js/account-dashboard.js
js/ratings-account.js
js/ratings-api.js
js/ratings.js
login.html
tests/personal-ratings.test.cjs
tests/ratings-api-client.test.cjs
```
