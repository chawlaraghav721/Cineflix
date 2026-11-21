# CineFlix backend

The Express app serves the existing frontend and `/api` routes from the same origin. MongoDB access is centralized in `src/config/db.js`; the backend connects once before it starts listening.

## Local setup

1. From the repository root, install backend dependencies:

   ```sh
   cd backend
   npm install
   ```

2. Copy `.env.example` to `backend/.env`. Set the shared Atlas URI as `MONGODB_URI`, generate a private random `JWT_SECRET` of at least 32 bytes, and set `APP_ORIGIN` to the exact browser origin (default `http://localhost:3000`). Generate a secret locally with `node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('hex'))"`. The `.env` file is ignored by Git; never share its values in source, chat or screenshots. Production requires an HTTPS `APP_ORIGIN` and `NODE_ENV=production`.
3. Use the existing shared `cineflix` database and its populated catalogue. Authentication setup does not require reseeding. The catalogue owner can run `npm run seed` when catalogue initialization or a coordinated seed update is needed; it upserts by stable ID without clearing collections.
4. Start the integrated website and API:

   ```sh
   npm start
   ```

   Open <http://localhost:3000>. `npm run dev` restarts the server when backend source files change.

The server exits before listening if authentication configuration is invalid, `MONGODB_URI` is missing, MongoDB cannot be reached, or the user/watchlist/Movie Night indexes cannot be created. Indexes are created non-destructively on the existing connection; the feature index definitions were verified first on isolated MongoDB. `GET /api/health` reports the database connection state. Do not put database credentials in frontend files or commit `.env`.

## Catalogue endpoints

| Method and path | Result |
|---|---|
| `GET /api/health` | `{ "status": "ok", "database": "connected" }` when ready |
| `GET /api/catalogue` | `{ "movies": [...], "shows": [...] }`, compatible with the current frontend |
| `GET /api/titles/:itemId` | One title selected by its stable catalogue ID |
| `GET /api/titles?type=&q=&genre=&sort=&page=&limit=` | `{ "items": [...], "total": n, "page": n, "limit": n }` |

Sort values are `title_asc`, `title_desc`, `year_asc`, and `year_desc`. Page defaults to 1, limit defaults to 12 and is capped at 50. Query errors and API failures use `{ "error": { "code", "message" } }`.

Admin title creation, update, and deletion remain outside this authentication change and are not mounted. The real `requireAuth`, `requireAdmin` and `protectMutation` middleware are now available for the catalogue routes to use during their own integration.

## Accounts

`login.html` provides registration, sign-in, account details and sign-out through the same-origin backend. Registration uses `{name,email,password}` and login uses `{email,password}`. Passwords require 12–128 characters for registration. Demo browser identities are no longer used to establish a login.

| Method and path | Result |
|---|---|
| `POST /api/auth/register` | `{user:{id,name,email,role}}`, signed cookie, HTTP 201 |
| `POST /api/auth/login` | Same user envelope and signed cookie, HTTP 200 |
| `POST /api/auth/logout` | `{message:"Signed out"}`, cleared cookie |
| `GET /api/auth/me` | Current user envelope, or HTTP 401 |

POST requests require an exact matching `Origin` header, or a same-origin `Referer` when Origin is absent. Set `Origin` explicitly in Postman/curl. Cookie flags are HttpOnly, SameSite=Strict, Path=/ and Secure in production; expiry is one hour. Logout clears the browser cookie but copied stateless JWTs remain valid until expiry. Registration/login share a per-process limit of 20 attempts per IP per 15 minutes.

See [authentication integration and verification](../docs/authentication.md) for middleware usage, admin account designation, tests and the completed live Atlas authentication verification record. Signed-in watchlists now use MongoDB-backed `/api/my-list` CRUD with watch-status filters; logged-out visitors retain a separate guest list. See [Member 4's API and integration guide](../docs/my-list-backend.md), [Postman/viva demonstration](../docs/my-list-demo.md), and [verification report](../docs/member4-completion-report.md). Personal ratings retain their existing behavior. Movie Night is integrated as described below.

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

Backend tests use `mongodb-memory-server` and an isolated temporary MongoDB instance; they do not connect to or clear Atlas data. The first test run may download a MongoDB test binary.

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
