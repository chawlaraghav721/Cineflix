# CineFlix backend

The Express app serves the existing frontend and `/api` routes from the same origin. MongoDB access is centralized in `src/config/db.js`; the backend connects once before it starts listening.

## Local setup

1. From the repository root, install backend dependencies:

   ```sh
   cd backend
   npm ci
   ```

2. Copy `.env.example` to `backend/.env`. Set the shared Atlas URI as `MONGODB_URI`, generate a private random `JWT_SECRET` of at least 32 bytes, and set `APP_ORIGIN` to the exact browser origin (default `http://localhost:3000`). Generate a secret locally with `node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('hex'))"`. The `.env` file is ignored by Git; never share its values in source, chat or screenshots. Production requires an HTTPS `APP_ORIGIN` and `NODE_ENV=production`.
3. Use the existing shared `cineflix` database and its populated catalogue. Authentication setup does not require reseeding. The catalogue owner can run `npm run seed` when catalogue initialization or a coordinated seed update is needed; it upserts by stable ID without clearing collections.
4. Start the integrated website and API:

   ```sh
   npm start
   ```

   Open <http://localhost:3000>. `npm run dev` restarts the server when backend source files change.

The server exits before listening if authentication configuration is invalid, `MONGODB_URI` is missing, MongoDB cannot be reached, or the title, user, watchlist, ratings, or Movie Night indexes cannot be created. The unique stable title ID index is awaited during startup using `Title.createIndexes()`; index creation is non-destructive and never removes catalogue data. The startup and duplicate-ID failure cases are covered with isolated MongoDB tests. `GET /api/health` reports the database connection state. Do not put database credentials in frontend files or commit `.env`.

## Catalogue endpoints

| Method and path | Result |
|---|---|
| `GET /api/health` | `{ "status": "ok", "database": "connected" }` when ready |
| `GET /api/catalogue` | `{ "movies": [...], "shows": [...] }`, compatible with the current frontend |
| `GET /api/titles/:itemId` | One title selected by its stable catalogue ID |
| `GET /api/titles?type=&q=&genre=&sort=&page=&limit=` | `{ "items": [...], "total": n, "page": n, "limit": n }` |
| `POST /api/titles` | Admin only; create a movie or show, HTTP 201 |
| `PATCH /api/titles/:itemId` | Admin only; update allowed fields, HTTP 200 |
| `DELETE /api/titles/:itemId` | Admin only; delete one title, HTTP 204 with an empty body |

Sort values are `title_asc`, `title_desc`, `year_asc`, and `year_desc`. Page defaults to 1, limit defaults to 12 and is capped at 50. Query errors and API failures use `{ "error": { "code", "message" } }`.

### Admin title writes

All three write routes run the existing middleware in this order: `requireAuth`,
`protectMutation`, then `requireAdmin`. They use the signed-in account's role from
the database and require an exact trusted `Origin` (or same-origin `Referer` when
Origin is absent). A role or user ID in the request body has no effect.

Create a title with the required fields `id`, `type`, `title`, `genre`, and
`poster`. `id` must be a stable `movie-...` or `show-...` ID whose prefix matches
`type`; it cannot be changed later. `description` is optional and defaults to an
empty string. Optional metadata fields are `year`, `rating`, `cast`, `director`,
`duration`, and `trailerUrl`.

```http
POST /api/titles
Origin: http://localhost:3000
Content-Type: application/json

{
  "id": "movie-031",
  "type": "movie",
  "title": "Example Feature",
  "genre": "Drama / Mystery",
  "poster": "https://images.example.test/example-poster.jpg",
  "description": "A short catalogue summary.",
  "year": 2026,
  "rating": 7.5,
  "cast": ["Example Actor"],
  "director": "Example Director",
  "duration": "1h 45m",
  "trailerUrl": "https://www.youtube.com/embed/example"
}
```

The response is the created public title (without MongoDB `_id` or timestamps).
PATCH accepts a non-empty subset of the same fields except `id`; omitted fields
remain unchanged. For example:

```http
PATCH /api/titles/movie-031
Origin: http://localhost:3000
Content-Type: application/json

{ "description": "Revised summary.", "rating": 8 }
```

Strings are trimmed and length-limited: title 200, genre 100, poster and trailer
URL 2048, description 10000, director 200, and duration 80 characters. Poster
must be an HTTP(S) URL or root-relative path; trailer URL must be HTTP(S) or
empty. `year` is an integer from 1 to 3000, `rating` is a number from 0 to 10,
and `cast` is an array of at most 50 non-empty names, each at most 120 characters.
Unknown fields, dotted names, MongoDB operators, wrong JSON types, invalid URLs,
and missing required create fields return HTTP 400. Duplicate stable IDs return
HTTP 409. Missing titles return HTTP 404. Requests without a valid session return
HTTP 401; signed-in non-admins receive HTTP 403; invalid origins receive HTTP 403. Unexpected
server failures return a generic HTTP 500 error envelope.

DELETE removes only the title selected by its stable ID and does not cascade to
ratings, watchlists, or Movie Night sessions. Those user records remain in the
database and may refer to an ID that no longer resolves to a catalogue item, so
an administrator should consider the effect on those references before deleting
a title.

New accounts always have the `user` role. To designate the private demo admin,
the database owner first has the person register and then privately updates only
that exact account's `role` to `admin` using an authorized database administration
tool (for example, MongoDB Compass). Verify the account identity out of band.
There is no public admin-promotion API; never put database credentials in the
Postman collection or request body.

**Postman demonstration:** register or log in as the privately designated admin;
set `Origin` to the configured `APP_ORIGIN` and retain the HttpOnly cookie in the
Postman cookie jar; POST a new `movie-...` or `show-...` item; GET `/api/titles`
and `/api/titles/:itemId` to confirm it; PATCH a description or rating; then
DELETE that stable ID. Repeat a write without the cookie (401), as an ordinary
account (403), with an untrusted Origin (403), and with a duplicate ID (409).

## Accounts

`login.html` provides registration, sign-in, account details and sign-out through the same-origin backend. Registration uses `{name,email,password}` and login uses `{email,password}`. Passwords require 12–128 characters for registration. Demo browser identities are no longer used to establish a login.

| Method and path | Result |
|---|---|
| `POST /api/auth/register` | `{user:{id,name,email,role}}`, signed cookie, HTTP 201 |
| `POST /api/auth/login` | Same user envelope and signed cookie, HTTP 200 |
| `POST /api/auth/logout` | `{message:"Signed out"}`, cleared cookie |
| `GET /api/auth/me` | Current user envelope, or HTTP 401 |

POST requests require an exact matching `Origin` header, or a same-origin `Referer` when Origin is absent. Set `Origin` explicitly in Postman/curl. Cookie flags are HttpOnly, SameSite=Strict, Path=/ and Secure in production; expiry is one hour. Logout clears the browser cookie but copied stateless JWTs remain valid until expiry. Registration/login share a per-process limit of 20 attempts per IP per 15 minutes.

See [authentication integration and verification](../docs/authentication.md) for middleware usage, admin account designation, tests and the completed live Atlas authentication verification record. Signed-in watchlists now use MongoDB-backed `/api/my-list` CRUD with watch-status filters; logged-out visitors retain a separate guest list. See [Member 4's API and integration guide](../docs/my-list-backend.md), [Postman/viva demonstration](../docs/my-list-demo.md), and [verification report](../docs/member4-completion-report.md). Ratings and Movie Night are integrated as described below.

## Ratings and reviews

Details saves account scores and optional reviews through `/api/ratings/:itemId/me`
and displays public summaries at `/api/ratings/:itemId`. The account dashboard
uses the private `GET /api/ratings` collection. Guest scores stay separate.
Startup creates the unique user/title index before serving requests.
See [ratings architecture and contracts](../docs/ratings-backend.md) and the
[browser/Postman demonstration](../docs/ratings-demo.md).

## Movie Night

`/api/movie-night` uses the shared Title model, connection, verified cookie identity
and Origin protection. It provides host-owned saved sequential sessions and
authenticated multi-device rooms with unique codes, fixed membership, one ballot
per account/round and polling. All relationships use stable catalogue IDs.
Sequential votes/resets require `X-Movie-Night-Revision`; participant votes require
`X-Movie-Night-Round`. See [Member 5 technical documentation](../docs/movie-night-backend.md)
for all 13 endpoints, schema/indexes and concurrency details.

The existing Movie Night page offers account sessions and rooms plus an explicit,
separate guest demo. No guest votes are imported into an account. Shared Atlas
was not modified or stress-tested during Movie Night verification; real database
tests ran on disposable local MongoDB. The next deliberate normal server start
creates the verified Movie Night indexes in its configured database. Review the
[integration handoff](../docs/movie-night-integration-handoff.md) before team merge
or startup against shared infrastructure.

## Tests

Run the existing frontend/regression suite from the repository root:

```sh
node --test
```

Run the backend integration suite:

```sh
cd backend
npm test
```

Backend tests use `mongodb-memory-server` and isolated temporary MongoDB instances; they do not connect to or clear Atlas data. The first test run may download a MongoDB test binary.

For real-browser account tests, install Chromium with `npx playwright install chromium`, then run `npm run test:browser`. Alternatively set `CINEFLIX_CHROME_PATH` to an installed Chrome executable. This check is explicitly skipped if no browser executable is available. It uses the real server process and an isolated test database, including a server restart and separate browser accounts.

Movie Night browser checks (from `backend/`):

```sh
node --test --test-concurrency=1 test/movie-night-browser.test.cjs test/movie-night-rooms-browser.test.cjs
```

The complete root `node --test --test-concurrency=1` command includes frontend,
backend, and configured browser suites. Serial file execution reduces resource
contention; the database race tests still use concurrent requests and two real
server processes. `MONGOMS_SYSTEM_BINARY` can point to an existing compatible
mongod executable to avoid downloading the test binary. No Atlas URI is needed.
