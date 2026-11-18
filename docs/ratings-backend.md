# Ratings and reviews

Feature branch: `feature/backend-ratings`. Base commit:
`9edbf990decd5d123b54bed63015e298c04b2687`. API and schema contracts follow the
[shared backend specification](CineFlix_Backend_Team_Handoff.md).

## Status and integration gates

The rating model, repository, service, controllers, route registration,
same-origin client and Details account UI are implemented. The integrated backend
is **not running**: the shared Express app, package configuration, MongoDB
connection, catalogue Title model and seeded database, JWT-cookie authentication,
and Origin/CSRF middleware were unavailable at initial implementation.
No replacement server, database connection, authentication or production test
identity was added. The active frontend retains its existing guest rating flow.

Before enabling account mode, integrate those dependencies, mount the
routes below, create/verify the ratings indexes, and run real account/database
verification. No Atlas connection or database mutation was made during this work.

## API and model

Mount exactly once at `/api/ratings`:

| Method/path | Access | Response |
| --- | --- | --- |
| `GET /:itemId` | Public | `{average: number|null, count: number, reviews: [...]}` |
| `GET /:itemId/me` | Verified cookie | `{rating: {score,reviewText}|null}` |
| `PUT /:itemId/me` | Verified cookie + Origin/CSRF | Saved `{score,reviewText}` directly; HTTP 200 |
| `DELETE /:itemId/me` | Verified cookie + Origin/CSRF | HTTP 204, empty body; idempotent |

All endpoints validate the stable catalogue `itemId` against the catalogue Title model
using `Title.exists({id:itemId})`; absent titles return 404 `TITLE_NOT_FOUND`.
Private ownership comes exclusively from the verified `req.user.id` (User ObjectId
as a string). Presence/type checking inside the service is not authentication.
Mutation bodies cannot contain `user`, `userId`, database operators or extra fields.

`score` must be an actual integer 1–5 (numeric strings are rejected at HTTP/service
boundaries). `reviewText` is optional plain text, capped at 2000 characters before
trimming. Omitting it on an existing rating preserves the review; `""` clears it.
First insertion defaults to an empty review. Ratings use timestamps, immutable
user/item relationships, collection `ratings`, unique `(user,itemId)` and an
`(itemId,updatedAt,_id)` summary index. `.cjs` matches the existing Movie Night backend
module format and works independently of the shared package `type` setting.

Each write uses a user/item filter and validated `findOneAndUpdate` upsert. A race
on the compound unique index retries once as an update without upsert; unrelated
database errors propagate to the shared error middleware. Concurrent edits use
last-write-wins semantics. The database unique index must exist before writes
are enabled; declaring `unique` in Mongoose alone does not establish enforcement.
Automatic index creation is disabled so indexes can be managed during backend integration.
Use `Rating.createIndexes()` deliberately during coordinated integration; avoid
`syncIndexes()`, collection resets or deleting existing data.

A single aggregation pipeline uses `$facet`: `$group` computes average/count from
all matching stored scores; reviews contain the 20 most recently updated nonempty
reviews, ordered by `updatedAt` then `_id`. Count includes score-only ratings.
Average retains database precision (UI displays one decimal), with null for zero
ratings. Reviews contain only `score`, `reviewText`, `createdAt`, `updatedAt`.
No public user IDs, emails, names or internal rating `_id` values are returned.
The review limit and fields fill in the handoff's unspecified `reviews: [...]`;
they add no new endpoints or mandatory request fields.

Expected errors use `{error:{code,message}}`: invalid inputs 400,
missing identity 401, nonexistent title 404. Protection middleware owns 403s.
Unexpected failures go to `next(error)` and require the shared JSON 500 handler.
Responses use `Cache-Control: no-store` so private results are not reused across
accounts. Scores never change catalogue `rating` metadata (its legacy /10 meaning
is preserved).

## Shared application wiring

In the shared Express application, supply the connected `connection`, Mongoose,
Title model, Express router, `requireAuth`, and `protectMutation`:

```js
const { createRatingModel } = require('./models/Rating.cjs');
const { createRatingRepository, createRatingTitleRepository } = require('./repositories/ratingRepository.cjs');
const { createRatingService } = require('./services/ratingService.cjs');
const { createRatingControllers } = require('./controllers/ratingController.cjs');
const { registerRatingRoutes } = require('./routes/ratingRoutes.cjs');

const Rating = createRatingModel({ mongoose, connection });
const ratingService = createRatingService({
  ratingRepository: createRatingRepository({ Rating }),
  titleRepository: createRatingTitleRepository({ Title })
});
app.use('/api/ratings', registerRatingRoutes({
  router: express.Router(),
  controllers: createRatingControllers({ ratingService }),
  requireAuth,
  protectMutation
}));
```

Register JSON parsing before the routes and safe JSON error middleware afterward.
The factory rejects missing authentication/protection; no default bypass exists.
`requireAuth` must verify the HttpOnly signed JWT cookie and attach
`req.user = {id,email,role}`; `protectMutation` implements the team's Origin/CSRF
policy. Ratings never reads cookies/tokens itself or implements another User model.

## Details and watchlist integration

Only the existing `.personal-rating` section, its script tags and ratings-specific
CSS were edited. `js/details.js`, `js/details-integration.js`, navigation and all
watchlist files are unchanged. Preserve the ratings section and the existing
`CineFlixRatings.connectItem(null|item)` calls during watchlist integration.
Coordinate shared Details markup before changing those hooks. Add/remove My List
and trailer regressions pass.

Account mode is ready behind the explicit integration gate. After real APIs/auth
pass integration, change `data-ratings-mode="guest"` to
`data-ratings-mode="account"` in Details. Alternatively, call
`window.CineFlixRatings.enableAccountMode()` after the scripts load. The DOM
attribute avoids reading guest data during page startup. There is deliberately
no account-to-guest fallback or automatic feature detection on API failure.

Account mode uses `/api/auth/me`, the public summary and current-user rating.
Stars autosave score plus the current review; Save review edits text after choosing
a score. Loading disables writes; errors preserve drafts/confirmed selection;
Refresh ratings reconciles ambiguous network results. Review text is inserted
with `textContent`. Public summaries remain available while signed out; personal
controls require a verified account response. Guest storage is never read, merged
or written in account mode, even when requests fail.

The authentication UI must dispatch the existing `cineflix:session-updated` event after
login/logout/account changes, including cross-tab notifications. Account mode
clears personal fields immediately on that event, refetches on page restoration
and window focus, and ignores stale title/account responses. It also checks the
current account immediately before a mutation and does not replay writes after
session changes or errors. Cookie changes in another tab while the window stays
focused require the authentication session-event bridge; ratings does not invent
a second session store.

## Movie Night compatibility

Compatibility was checked against `feature/backend-movie-night`, draft
[PR #22](https://github.com/chawlaraghav721/Cineflix/pull/22), commit
`cf0db203dc91b5ae98a0697b4884ed8528ca9728`, including its model, repositories,
route/controller interfaces and integration documentation.

Shared interfaces align: explicit injected Mongoose/shared connection, stable
catalogue IDs, verified string `req.user.id`, factory-supplied `requireAuth` and
`protectMutation`, same-origin cookies, explicit mounting and safe shared errors.
Ratings uses its own collection and route namespace; it does not depend on or
modify Movie Night sessions, votes, selected IDs, revision headers or room polling.
Movie Night revision headers and room extensions remain proposed interfaces;
ratings neither requires nor activates them. Movie Night files are unchanged.

An in-memory Git merge-tree check found no file conflicts with that exact draft
head. A combined tree was extracted to a temporary directory and all **212 tests
passed, 0 failed, 0 skipped**, including ratings, Movie Night and the original frontend suite.
The existing catalogue test needs historical `git show`, so the temporary run
received read-only access to this repository's Git history. This was a compatibility
simulation; neither feature branch nor main was merged or modified by it.

## Verification and limitations

Baseline on main: **96 passed** with `node --test`. Current repeatable commands:

```sh
node --test
node --test backend/tests/ratings-*.test.cjs
```

Dependency configuration belongs to the shared backend; no separate package
manifest is added. The default
suite yields **121 passed, 0 failed, 3 skipped** without dependencies and labels
unavailable Mongoose, Express and optional browser checks. For full validation, dependencies
were installed outside the repository with these versions:

```sh
ratings_deps=$(mktemp -d)
npm install --prefix "$ratings_deps" --no-package-lock --no-audit --no-fund --ignore-scripts mongoose@9.12.2 express@5.1.0 playwright@1.65.1
export CINEFLIX_MONGOOSE_PATH="$ratings_deps/node_modules/mongoose"
export CINEFLIX_EXPRESS_PATH="$ratings_deps/node_modules/express"
export CINEFLIX_PLAYWRIGHT_PATH="$ratings_deps/node_modules/playwright"
# Set the installed Chrome executable; omit to use Playwright's installed Chromium.
export CINEFLIX_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
node --test
```

Executed with Node 26.13.0, Mongoose 9.12.2, Express 5.1.0, Playwright 1.65.1 and
installed Google Chrome. Full suite: **124 passed, 0 failed, 0 skipped** (96 original
tests and 28 new ratings tests). Browser test serves the actual Details page on
loopback, activates account mode only in a test interception, and uses fixture
API responses. It covers guest preservation, save/review/edit/delete, reload,
separate accounts, average display, failed writes, logout, hostile review text,
and overflow at 1440/390/320px, with no uncaught page errors. Poster/trailer network
requests are blocked in that test and their external availability is not asserted.

HTTP tests execute real Express over loopback with explicit test-only identity,
Origin and repository fixtures. Model tests use real disconnected Mongoose
validation/query casting/timestamps; query tests inspect aggregation and ownership
filters. These prove module behavior, not actual MongoDB persistence, index
enforcement/races, JWT verification, CSRF security or a live integrated website.
No real database was contacted. Recheck with the shared backend dependency versions.

Primary references consulted: [Mongoose validation](https://mongoosejs.com/docs/validation.html),
[findOneAndUpdate](https://mongoosejs.com/docs/tutorials/findoneandupdate.html),
[MongoDB unique indexes](https://www.mongodb.com/docs/manual/core/index-unique/).

## Manual verification after integration

After the integration gates pass:

1. Sign in as your designated User A, open `details.html?id=movie-004`, choose 5
   and write a review. Show PUT and the `ratings` document in Compass.
2. Edit to 4; show there is still one document for A/title. Refresh to prove storage.
3. Sign in as User B in another browser profile, choose 2. Public average is 3.0
   from two scores; each profile's `/me` endpoint returns only its own rating.
4. Delete B's rating; A's survives and average becomes 4.0. Submit score 6 to
   demonstrate 400, and send a private request without a cookie to show 401.
5. Explain route → real auth/protection → controller → service → repository →
   Mongoose/MongoDB, the unique compound index, and `$group` average/count.

Until the shared backend and authentication are integrated, test results establish
module behavior only. Verify database persistence and authentication separately
before describing the feature as operational. No merge to main or deployment
has been performed.
