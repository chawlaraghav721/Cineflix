# Ratings and reviews

The Details page saves signed-in ratings and written reviews in MongoDB. Guest
ratings remain in `cineflixPersonalRatings` in the browser and are never imported
into an account. Catalogue metadata such as `Title.rating` remains independent of
community scores.

## Architecture and persistence

`app.js` mounts `createRatingRouter.cjs` at `/api/ratings`. The router composes the
existing `requireAuth` and `protectMutation` middleware with the ratings
controller, service, repository and Mongoose model. `Rating.cjs` registers the
`Rating` model on the same connection used by `config/db.js`, User and Title;
there is no additional server, connection or persistence store.

The `ratings` collection stores an immutable User ObjectId reference, immutable
stable catalogue `itemId`, integer `score` from 1 through 5, optional trimmed
`reviewText` (maximum 2000 characters), and `createdAt`/`updatedAt` timestamps.
The API validates types before Mongoose casting, rejects extra PUT fields and
checks catalogue existence using `Title.id`. A score-only PUT preserves an
existing review; sending `reviewText: ""` clears it.

Indexes:

- `rating_user_item_unique`: unique `{user: 1, itemId: 1}` prevents duplicate
  ratings, including concurrent first writes. Upserts retry a matching unique-key
  collision once as an update scoped to the same user and title.
- `{itemId: 1, updatedAt: -1, _id: -1}` supports title lookups and recent reviews.

Startup calls `ensureRatingIndexes()` after the shared connection is ready and
before listening. Index creation is additive: it never drops indexes or data.
If incompatible pre-existing duplicates prevent the unique index from being
created, startup fails rather than serving without duplicate protection. Do not
reset the shared database to resolve such a failure.

## API contracts

All paths below are relative to `/api/ratings`.

| Method/path | Access | Success |
| --- | --- | --- |
| `GET /:itemId` | Public | `200 {average: number|null, count: number, reviews: [...]}` |
| `GET /:itemId/me` | Cookie login | `200 {rating: {score, reviewText}|null}` |
| `PUT /:itemId/me` | Cookie login, trusted Origin | Body `{score, reviewText?}`; `200 {score, reviewText}` |
| `DELETE /:itemId/me` | Cookie login, trusted Origin | No rating fields; `204` with no body, including repeated deletion |

The public summary uses one MongoDB aggregation with a totals/reviews facet.
Average and count include every stored score. Up to 20 nonempty reviews are
returned, ordered by `updatedAt` descending and then `_id` descending for ties.
Reviews contain only `score`, `reviewText`, `createdAt` and `updatedAt`; they never
contain user IDs, names, email addresses or database IDs. Empty summaries return
`{average: null, count: 0, reviews: []}`. Responses use `Cache-Control: no-store`.

Errors use the shared `{error: {code, message}}` shape: `400` for invalid input or
JSON, `401` for absent/invalid/expired sessions or deleted accounts, `403` for an
untrusted Origin, `404` for missing titles, `409 ACCOUNT_CHANGED` for the optional
account guard below, `413` for oversized bodies, and a generic `500` for unexpected
failures. No stack trace or connection details are returned.

The browser sends an optional `X-Ratings-Owner` header on private requests, using
the identity associated with its current draft. The server compares it with
`req.user.id` and rejects mismatches. This prevents a stale draft from being
written to a newly switched cookie account. The header never grants access or
defines ownership; API clients may omit it, and all database operations still
use the verified cookie identity exclusively.

## Frontend and compatibility

`ratings-api.js` implements same-origin requests. `ratings-account.js` consumes
`CineFlixAuth.getState()`/`refresh()` and `cineflix:auth-state` events. It clears
private drafts immediately while identity is loading or changes, and discards
outdated asynchronous responses. A failed account lookup disables account
controls instead of treating an unverified session as a guest.

Selecting a star saves the account score with the current review. The optional
review editor supports a separate Save review button. Clear Rating removes both
score and review. Loading states, saved/removed feedback, anonymous community
reviews and empty states fit the existing Details design. A failed or lost write
response requires Refresh ratings before another mutation, since the server may
have saved the original request. Reviews are rendered exclusively with
`textContent`.

`ratings.js` preserves the existing guest storage and legacy-title migration.
Shared production edits are limited to ratings scripts/styles, Details markup
and script order, and the two backend mounting/startup hooks. Authentication,
catalogue, My List, navigation, trailers and both Movie Night modes retain their
existing interfaces.

## Reproduction and verification

Install the existing dependencies with `cd backend && npm ci`. Configure the
normal application using [backend setup](../backend/README.md); no new environment
variables are needed. Tests use explicit disposable MongoDB URIs and never load
the team's Atlas URI. The first run may download a MongoDB binary.

From the repository root (PowerShell), using an installed Chrome:

```powershell
$env:CINEFLIX_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test --test-concurrency=1
```

Alternatively install Playwright Chromium from `backend/` with
`npx playwright install chromium`; browser tests explicitly skip if no executable
exists. Use `npm.cmd`/`npx.cmd` on Windows if PowerShell blocks the npm scripts.
The full backend suite also runs with `cd backend` then `npm test`. The existing
`test:browser` script covers authentication only; the full test command includes
ratings and Movie Night browser suites too.

Ratings-only checks from `backend/`:

```sh
node --test tests/ratings-model.test.cjs tests/ratings-service.test.cjs tests/ratings-repository.test.cjs test/ratings-integration.test.cjs test/ratings-browser.test.cjs
```

Verification on 21 November 2026 used Node 22.23.4, the installed Chrome browser,
and disposable MongoDB 7.0.24. Checks include real JWT cookies and Origin guards,
all four endpoints, two independent accounts, malformed input, expired sessions,
deleted users, forged ownership, stale-account guards, database-error redaction,
20 concurrent first writes, the actual unique index, accurate aggregates and
deterministic bounded reviews. Browser checks exercise guest/account separation,
save/edit/delete, literal HTML rendering, reload and backend restart persistence,
read/write failures and retries, delayed private responses during cross-tab
logout/account switching, and 1440/390/320-pixel layouts without horizontal
overflow. Desktop and mobile screenshots were visually inspected; screenshots
are local temporary QA artifacts, not committed application data.

The complete root run (`node --test --test-concurrency=1` with Chrome configured)
passed **273 tests, 0 failures, 0 skips**: 102 existing frontend tests and 171
backend tests, including 28 new ratings checks. The earlier standalone backend
run passed 169 tests before two final security/error-handling checks were added;
the complete root run includes both additions. All 91 application/test JavaScript
files passed `node --check`, and the diff passed the whitespace check.

No shared Atlas records were modified for ratings verification. Physical mobile devices and
production deployment were not tested. Browser isolation uses separate browser
contexts, and mobile checks emulate viewport sizes. The existing stateless JWT
logout limitation remains: copied tokens are usable until expiry.

## Demonstration

1. Start the integrated server and open `details.html?id=movie-004` as a guest;
   select a star and confirm the browser-only mode note.
2. Sign in and return to Details. The guest rating is not imported. Select five
   stars, write a review, save, reload and inspect the persisted `ratings` record.
3. Open a separate browser profile, register/sign in as another account and rate
   the same title with one star. Refresh the first page to see an average of 3.
4. Edit and then clear the first account's rating. The other account's record
   remains. Send an invalid score or omit the cookie in an API request to show
   server-side validation and authentication.
