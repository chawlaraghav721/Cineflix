# Authentication

The authentication module provides real accounts through the existing Express
application and its shared Mongoose connection. Work is on `feature/backend-auth`.
No additional production server or connection module is introduced.

## API contract

| Method/path | Request | Success |
| --- | --- | --- |
| `POST /api/auth/register` | `{name,email,password}` | `{user:{id,name,email,role}}`, cookie, 201 |
| `POST /api/auth/login` | `{email,password}` | Same user envelope and cookie, 200 |
| `POST /api/auth/logout` | No required body | `{message:"Signed out"}`, clear cookie, 200 |
| `GET /api/auth/me` | Login cookie | User envelope, 200; missing/invalid login, 401 |

All errors use `{error:{code,message}}`. Validation errors return 400, duplicate
email returns 409, missing/invalid login returns 401, rejected origin or admin
access returns 403, oversized JSON returns 413 and throttling returns 429.
Unexpected failures return the shared generic JSON 500 response. No passwords,
password hashes or JWTs are returned in API response bodies or browser storage.

Names are trimmed and must contain 2–80 characters. Email is trimmed, lowercased,
validated and limited to 254 characters. The unique `user_email_unique` database
index protects concurrent registration; startup creates indexes without dropping
data. Extra request fields, including `role` or `userId`, are rejected.

Registration passwords require 12–128 characters. Password whitespace is
significant. Node's asynchronous scrypt uses a random 16-byte salt, N=32768,
r=8, p=3 and a 64-byte derived key. Verification uses timing-safe comparison.
Missing accounts still perform password derivation. Unknown emails return 401
with `USER_NOT_FOUND` and a prompt to create an account; incorrect passwords
return 401 with `INVALID_CREDENTIALS`. The sign-in page displays these errors in
a visible alert and highlights the relevant field. Registration/login share a
20-attempt/15-minute IP limit.
The limiter is process-local; multi-instance deployments need a shared store and
an explicitly reviewed trusted-proxy configuration.

## Configuration and sessions

Configure only the ignored `backend/.env`:

```dotenv
MONGODB_URI=<private shared development URI>
JWT_SECRET=<locally generated random secret of at least 32 bytes>
APP_ORIGIN=http://localhost:3000
PORT=3000
NODE_ENV=development
```

Generate the secret locally using the command in `backend/.env.example`.
Production requires `NODE_ENV=production` and an HTTPS `APP_ORIGIN`. Scheme,
hostname and port must match the browser URL exactly. Paths and credentials are
not accepted in APP_ORIGIN. Configuration is checked before database startup.
Startup failures disconnect the pool and print safe configuration information.

The `cineflix_session` cookie is HttpOnly, SameSite=Strict, Path=/, expires after
one hour and is Secure in production. HS256 JWT verification fixes the algorithm,
issuer and audience and requires valid subject, issue time and expiry. The JWT
subject is the User ObjectId. Every protected request loads the current user and
role from MongoDB, rejecting deleted users and reflecting role changes immediately.

Logout clears the browser cookie with matching flags. It does not revoke a copied
JWT; that token can be replayed until expiry. Password reset, email verification,
refresh tokens, server-side session revocation and OAuth are outside this scope.
The former demo Remember Me option is replaced by the fixed one-hour expiry.

The signed-in account page shows the member's name and email, counts and previews
of saved titles and personal ratings, and links to browse movies, TV shows and
Movie Night. Collections use the existing browser storage and shared catalogue;
they are not stored against the account. Unavailable catalogue IDs and invalid
ratings are excluded from previews. Empty, unavailable-storage and catalogue-error
states provide feedback without modifying saved records.

## Integration interfaces

The shared application parses cookies and sets `app.locals.authConfig`. Feature
routes can import these middleware functions:

```js
const { requireAuth } = require('./middleware/requireAuth');
const { requireAdmin } = require('./middleware/requireAdmin');
const { protectMutation } = require('./middleware/protectMutation');

router.get('/owned-resource', requireAuth, controller.getOwn);
router.post('/owned-resource', requireAuth, protectMutation, controller.createOwn);
router.post('/admin-resource', requireAuth, protectMutation, requireAdmin, controller.create);
```

`requireAuth` sets exactly `req.user = {id,email,role}`, where id is the verified
User ObjectId string. It additionally supplies the safe account DTO as
`req.authenticatedUser` for `/me`. Features must derive ownership from req.user;
IDs or roles supplied by a browser are not authorization. Route factories that
accept middleware arguments can receive these same functions unchanged.

Mutation protection requires exact Origin equality with APP_ORIGIN. When Origin
is absent, a matching Referer origin is accepted. Missing source headers, Origin
`null`, untrusted origins and cross-site Fetch Metadata are rejected. Manual API
clients must send the configured Origin. CORS is not enabled. GET/HEAD/OPTIONS
remain free of state changes.

All registrations create role `user`; no public admin-promotion route exists.
For a designated demo administrator, the database owner must identify a registered
account privately and update only that user's `role` to `admin` using Compass or
an equivalent authorized database operation. Test administrator changes operate
only on test users in the isolated test database. The catalogue POST, PATCH and
DELETE routes apply `requireAuth`, `protectMutation`, and `requireAdmin` in that
order; no public role-promotion endpoint exists.

## Browser behavior

The login page provides registration, sign-in, current-account display and logout.
Names and messages render as plain text. `js/navigation.js` exposes
`window.CineFlixAuth` with `login`, `register`, `logout`, `refresh` and `getState`.
Requests use same-origin cookies and no-store caching; no token is exposed to JS.

`cineflix:auth-state` announces account state changes. The existing
`cineflix:session-updated` event tells feature modules to refetch their own account
data. A storage notification containing only a random change marker synchronizes
other tabs; it contains no identity or credentials. Page restoration and focus
refresh account state. Stale responses cannot restore an earlier identity.
Background refreshes defer while login, registration or logout is pending; the
account state is reconciled with `/me` after the mutation settles.
Cookie authentication works even if browser storage is blocked. Legacy demo
identities are ignored and cleaned up after successful sign-in/logout.

Existing watchlist counts and guest data are preserved. The watchlist, ratings and
Movie Night frontend logic are unchanged and remain browser-based until their
respective backend integrations. Authentication never imports guest data into an
account or supplies a hardcoded production user. Shared changes are limited to
auth route/cookie wiring, startup configuration/index readiness, safe error
logging, login markup, navbar account display, dependency configuration and docs.

## Verification

Executed with Node 26.13.0, Express 4.22.3, Mongoose 8.24.10 and installed Google
Chrome: the complete `node --test` run passed **128 tests, 0 failed, 0 skipped**.
The backend `npm test` command passed **26 tests, 0 failed, 0 skipped**. The
separate Movie Night ownership verification passed its real-database test.
JavaScript syntax checks passed for all 46 application/test scripts.

Install dependencies with `cd backend && npm ci`. Run `node --test` from the repo
root, or `npm test` inside backend. Automated tests use temporary MongoDB instances;
they do not connect to Atlas. Existing catalogue and frontend regressions remain
covered; old demo-login tests were deliberately updated for asynchronous accounts.

For browser checks, install Chromium with `npx playwright install chromium` inside
backend and run `npm run test:browser`. To use an existing browser, set
`CINEFLIX_CHROME_PATH` to its executable. Tests are explicitly skipped when no
browser executable is present. Optional `CINEFLIX_AUTH_SCREENSHOTS` sets a local
output directory. Browser tests start the actual `server.js` in another process,
use real cookies and isolated MongoDB, restart the server and verify persisted
accounts, separate profiles, cross-tab logout, wrong passwords, duplicate email,
safe text rendering, shared-page navigation and responsive layouts.
External poster/background requests are blocked in the browser check; it does not
verify third-party image or trailer availability.

An additional cross-feature check uses an unchanged Movie Night checkout:

```sh
MOVIE_NIGHT_SOURCE=/path/to/movie-night/backend/src node backend/scripts/verifyMovieNightAuth.cjs
```

This was executed against draft PR #22 at
`cf0db203dc91b5ae98a0697b4884ed8528ca9728`, extracted outside the repository.
It exercises the real Movie Night schema/repositories/controllers/routes with
real registered users and JWT cookies against isolated MongoDB: a second account
cannot list, read, vote, reset or delete the first account's session, and a
cross-origin mutation fails. No Movie Night source file is changed or activated
in the production app. This does not approve its proposed room/revision contracts.

### Live Atlas verification — 20 November 2026

The actual backend server was tested against the existing shared `cineflix`
database. **All 29 live checks passed**, including:

- Connection, health response and catalogue API reads; all 30 existing titles were visible.
- Registration of two uniquely named temporary accounts, safe response fields,
  salted password hashes, timestamps and the unique email index.
- Current-account reads and account separation; a client-supplied user ID did not
  override the verified cookie identity.
- Rejection of duplicate registration, incorrect passwords, missing cookies,
  tampered/expired JWTs and cross-origin logout.
- Account/session persistence after stopping and restarting the actual server,
  followed by successful login and cookie-clearing logout.

Both temporary accounts were removed using filters restricted to their unique
test email addresses, names and creation time. The catalogue remained at 30
records; it was not reseeded. No other account data or feature records were
modified. Credentials stayed in the ignored local `.env` and were not included
in logs or verification output.

Browser journeys, production cookie flags, administrator-role changes, rate
limiting and Movie Night ownership were verified separately against isolated
MongoDB. Those checks are not a claim of production HTTPS deployment or live
integration of the other feature modules. Live administrator access requires a
designated administrator account; no shared account was promoted during this check.

## Demonstration

1. Create an account, show the safe registration response and inspect its salted
   password hash in the database without exposing credentials.
2. Reload and restart the server; the account remains available.
3. Demonstrate wrong-password and unsigned `/me` requests returning 401.
4. Explain route → controller → service → User model, JWT signing/verification,
   HttpOnly cookies, Origin checks and user/admin authorization.
5. Sign out and show `/me` returning 401. Explain the copied-token expiry limit.

References: [Node crypto](https://nodejs.org/api/crypto.html),
[jsonwebtoken](https://github.com/auth0/node-jsonwebtoken),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[express-rate-limit](https://express-rate-limit.mintlify.app/quickstart/usage).
