# Member 4: My List and watchlist personalization

The My List module stores signed-in users' movies and shows in MongoDB. Each saved title has one of three statuses: `want-to-watch` (default), `watching`, or `watched`. My List supports search, status filtering, removal and clearing. Details provides add/remove controls, the navbar shows the saved count, and My Account previews the current account's saved titles.

## Shared integration

This module uses Member 1's Express app, `Title` model and single Mongoose connection, and Member 2's real `requireAuth`, `protectMutation` and browser `CineFlixAuth` service. It creates no connection, token verification, User model or substitute authentication. The router is mounted at `/api/my-list` before static serving and error middleware. Startup creates the watchlist index before listening.

Run the existing integrated backend as described in [backend setup](../backend/README.md). Open the website through Express, not a separate Live Server origin. The catalogue must contain the titles being saved.

## Model and ownership

`backend/src/models/Watchlist.js` defines the `watchlists` collection:

| Field | Meaning |
| --- | --- |
| `user` | Required immutable ObjectId referencing `User`; comes only from `req.user.id` |
| `itemId` | Required immutable string, at most 128 characters, without surrounding whitespace; stable catalogue `Title.id` |
| `status` | Required enum: `want-to-watch`, `watching`, `watched`; defaults to `want-to-watch` |
| `addedAt` | Mongoose creation timestamp |
| `updatedAt` | Mongoose update timestamp |

The unique compound index `{ user: 1, itemId: 1 }`, named `unique_user_watchlist_item`, prevents concurrent duplicate saves while allowing different accounts to save the same title. The index is created non-destructively at startup. No collection reset or index deletion is used.

All reads, updates and deletes include the verified user's ID in the database query. No route accepts an ownership field. POST/PATCH reject unknown body properties, including `user`, `userId`, timestamps and MongoDB operators. Responses expose only the four public entry fields; MongoDB IDs and user IDs are omitted.

## Authentication and request requirements

All five endpoints require the existing HttpOnly, SameSite=Strict signed JWT cookie. Unauthenticated requests return `401`. Cookies are Secure under the shared production configuration. Mutations also require `Origin` to exactly match `APP_ORIGIN`, or a same-origin Referer when Origin is absent. Cross-site mutation requests return `403`. Set Origin manually in Postman. Logout and expiry follow [Member 2's authentication contract](authentication.md), including the stateless token expiry limitation.

Browser requests use `fetch()` with `credentials: 'same-origin'` and `cache: 'no-store'`. The auth middleware also marks protected responses `Cache-Control: no-store`.

## API contract

| Method | Route | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/my-list` | None | `200`, `{ "items": [entry] }` |
| POST | `/api/my-list` | `{ "itemId": "movie-004", "status": "want-to-watch" }`; status optional | `201`, entry |
| PATCH | `/api/my-list/:itemId` | `{ "status": "watched" }` | `200`, updated entry |
| DELETE | `/api/my-list/:itemId` | None | `204`, empty body |
| DELETE | `/api/my-list` | None | `204`, empty body; safe to repeat |

An entry looks like:

```json
{
  "itemId": "movie-004",
  "status": "watched",
  "addedAt": "2026-11-22T10:00:00.000Z",
  "updatedAt": "2026-11-22T10:05:00.000Z"
}
```

The timestamps above are illustrative. GET sorts by most recently added, then item ID, and returns `{ "items": [] }` for an empty list.

Example read response:

```json
{
  "items": [
    {
      "itemId": "movie-004",
      "status": "want-to-watch",
      "addedAt": "2026-11-22T10:00:00.000Z",
      "updatedAt": "2026-11-22T10:00:00.000Z"
    }
  ]
}
```

Example duplicate response, HTTP `409`:

```json
{ "error": { "code": "ALREADY_SAVED", "message": "This title is already in your list." } }
```

Other errors use the same `{error:{code,message}}` shape:

| HTTP | Examples |
| --- | --- |
| 400 | `INVALID_INPUT`, `INVALID_ITEM_ID`, shared `INVALID_JSON` |
| 401 | `AUTH_REQUIRED` |
| 403 | `INVALID_ORIGIN` |
| 404 | `TITLE_NOT_FOUND`, `ENTRY_NOT_FOUND` |
| 409 | `ALREADY_SAVED` |
| 413 | Shared `PAYLOAD_TOO_LARGE` |
| 500 | Shared `INTERNAL_ERROR`, without database internals |

POST and PATCH check the real `Title` collection. PATCH never upserts an unsaved entry. DELETE of an unsaved/unknown ID returns `404`; a stored entry can still be removed if its catalogue title has since been deleted. A clear operation affects only the current user, including any stale saved IDs.

## Browser and guest behavior

All `CineFlixMyList` methods that read or mutate a list are asynchronous. Callers must await `getMyListItems()`, `getMyListIds()`, `isInMyList(id)`, `addToMyList(id, status?)`, `updateStatus(id, status)`, `removeFromMyList(id)` and `clearMyList()`.

Signed-out visitors have an explicit browser-only guest list under `cineflixGuestWatchlist`. Legacy `cineflixMyList` arrays are read only as a guest fallback, deduplicated and assigned the default status. The first guest write saves the new structured format and leaves the legacy key intact. Clearing the new guest list does not revive the legacy list. Browser storage failures are reported and do not overwrite existing data.

Signed-in visitors always use the API. Guest lists are never imported or merged into accounts, and account lists are never stored in localStorage. Session-loading and auth-error states never fall back to guest data. A `401` requests a session refresh and shows an expiry message. Ratings retain their separate existing behavior.

An auth revision invalidates in-flight reads and mutations when login/logout or account switching occurs. Page revisions discard outdated renders. Concurrent reads share an in-flight request; controls and the shared client reject overlapping mutations. A successful mutation invalidates old reads and sends an identity-free cross-tab notification. Guest storage events and session notifications refresh the relevant views. Page restoration refreshes the saved data.

`cineflix:list-updated` triggers a fresh list load after mutations or session invalidation. `cineflix:list-refreshed` lets the navbar retry after a page recovers from a failed read; it does not trigger a page reload loop.

## Testing

From the repository root:

```sh
node --test
node --test tests/my-list-storage.test.cjs tests/mylist.test.cjs tests/navigation.test.cjs tests/personal-ratings.test.cjs
node --test backend/tests/my-list-*.test.cjs
```

For backend tests:

```sh
cd backend
npm ci
npm test
```

Real-browser tests use Playwright. Install its Chromium (`npx playwright install chromium` from backend), or set `CINEFLIX_CHROME_PATH` to an installed Chrome executable, then run:

```sh
node --test backend/test/my-list-browser.test.cjs
```

The last command assumes repository-root working directory. Optionally set `CINEFLIX_MYLIST_SCREENSHOTS` to a local output directory. The browser test verifies normal and failed requests, all status filters, search, Details add/remove, duplicate-click protection, dashboard/navbar updates, separate guest/accounts, cross-tab changes, clear ownership, browser refresh, actual server restart and widths 1440/768/390/320. Without a browser executable the browser tests explicitly skip.

All database tests pass an explicit disposable MongoDB URI from `mongodb-memory-server`. They never target the shared Atlas URI or wipe shared data. The first run can download a local MongoDB binary. See [completion report](member4-completion-report.md) for actual executed results and [Postman/viva guide](my-list-demo.md) for demonstration steps.

## Coordination and remaining dependencies

The prerequisites were available on fetched main `4c3d4f6` and are integrated. Shared changes are limited to router registration in `app.js`, watchlist index creation in `server.js`, watchlist-only Details/navbar behavior, the account saved-title preview, and adapting account browser tests away from guest storage. `db.js`, User/auth implementation, `js/login.js`, `js/ratings.js`, and `js/movie-night.js` are unchanged.

No implementation blocker remains. Normal runtime still needs the team's configured database, populated catalogue and valid shared auth configuration. Shared Atlas was deliberately not used for verification; index creation and multi-account behavior were verified on disposable local MongoDB. Review/deployment/merging remain with the team; this work does not merge main or deploy.
