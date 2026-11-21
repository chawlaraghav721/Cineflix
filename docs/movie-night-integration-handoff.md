# Member 5 integration handoff — 21 November 2026

## Status and history

Sequential account sessions and multi-device rooms are integrated in the feature
branch with real shared authentication, persistence, frontend controls and polling.
Latest `origin/main` at inspection was `cc8b32a`. Synchronization merge `b4eab69`
preserved all ten original Member 5 commits through `cf0db20` without rebasing.
Only `feature/backend-movie-night` was changed. Nothing was pushed, merged into
main, force-pushed or deployed. The pre-existing `.vscode/` content was preserved.

The handoff file's older v1 same-device scope is extended by the user's explicit
multi-device integration request. Existing shared catalogue/auth interfaces match
the Member 5 dependency interfaces, so no incompatible shared contract was needed.
Feature additions still require team PR review before main accepts them.

## Integration commits

| Commit | Completed work |
| --- | --- |
| `b50ec9e` | Mount sessions using the shared app, Title model, Mongoose connection and cookie/Origin middleware |
| `d7a71b3` | Real MongoDB sequential races across two backend processes and restart persistence |
| `74ac4ae` | Mount rooms, verify unique indexes/collision retry, initialize indexes at startup and limit joins |
| `87c352c` | Account session UI, saved-session restoration, keyboard selection and separate guest flow |
| `ec959c2` | Room create/join/host/participant controls and polling across browser contexts |
| `2cb3de2` | Clear views on cross-tab account changes and serialize manual room refreshes |
| `7a17864` | Keep reusable fixtures out of Node test discovery; optional viewport screenshots |
| `798834c` | Verified account/catalogue retry recovery and accurate mode feedback |

This handoff and updated run documentation are recorded in the final documentation
commit. The synchronization merge is not counted as a feature milestone.

## Files changed during this integration

| Area | Files |
| --- | --- |
| Shared mounting/startup (essential changes only) | `backend/src/app.js`, `backend/src/server.js` |
| Feature composition | New `backend/src/routes/createMovieNightRouter.cjs`; updated `backend/src/routes/movieNightRoutes.cjs` |
| Account frontend | New `js/movie-night-account.js`; updated `js/movie-night.js`, `movie-night.html`, `movies.html`, `css/movie-night.css` |
| Rooms frontend | New `js/movie-night-rooms.js` |
| Shared-app/auth/database tests | New `backend/test/movie-night-integration.test.cjs`, `movie-night-concurrency.test.cjs`, `movie-night-rooms-integration.test.cjs` |
| Browser tests | New `backend/test/movie-night-browser.test.cjs`, `movie-night-rooms-browser.test.cjs` |
| Test-only support | New `backend/test-support/movieNightIntegration.cjs`, `movieNightServerProcess.cjs` |
| Existing client test | Updated `backend/tests/movie-night-api.test.cjs` to reflect intentional script loading |
| Documentation | `docs/movie-night-backend.md`, `docs/movie-night-room-contract.md`, this handoff, `backend/README.md`, root `README.md` |

The original Member 5 services/model/repositories/controllers and independent
tests remain, now exercised with installed dependencies and real MongoDB. M1's
database module, M2's authentication/security modules, other feature modules,
catalogue data and package configuration/lockfile were not modified by integration.

## Verification environment and commands

Windows; Node 22.23.4; project-locked Mongoose **8.24.10**; real isolated MongoDB
**7.0.24**; installed Google Chrome controlled by Playwright. Physical devices were
not available; separate cookie-isolated browser contexts exercised the device flow.

From the root, after `cd backend; npm ci` has installed dependencies:

```powershell
$env:CINEFLIX_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test --test-concurrency=1 --test-reporter=spec
```

Equivalent backend-only discovery: `cd backend; npm test -- --test-concurrency=1`.
Concurrency is limited between test files for predictable resource use; concurrency
tests themselves still run competing requests against two real backend processes.
If a compatible local mongod is already available, set `MONGOMS_SYSTEM_BINARY` to
its executable to avoid the first-run test-binary download. Otherwise the existing
mongodb-memory-server dependency downloads it. No shared Atlas credentials are
needed. Browser checks explicitly skip when no executable is installed/configured.

Optional screenshots: set `CINEFLIX_MOVIE_NIGHT_ARTIFACTS` to a directory outside
the repository before running the room browser test. Screenshots at 320, 390 and
1440 pixels were generated and visually inspected; width checks found no overflow.
No generated artifacts, binary, test data, .env or secrets are committed.

## Verified behavior

- Real shared cookie registration/login, missing/malformed/expired-cookie rejection,
  foreign ownership denial, exact Origin checks and unchanged catalogue/auth tests.
- Persisted session create/list/get/reset/delete, timestamps, stable title IDs,
  validation failures, completion, server-derived ties and independent app reads.
- Ten competing same-revision votes across two backend processes accepted one;
  last-slot competition never overflowed; six reset/vote races advanced once.
- Real server restart preserved session progress; real browser refresh/restart
  restored account state and completed results.
- Actual partial unique room-code index, duplicate rejection and service collision
  retry; sequential records coexisted without room-code uniqueness conflicts.
- Concurrent capacity-limited joins, idempotent membership, host-only start/reset,
  foreign room denial and authenticated join limiting.
- Independent ballots across two backend processes succeeded while an extra ballot
  for one account was rejected; completion/tallies matched stored records.
- Fresh rounds reject old ballots; API polling omits raw ballots and participant IDs.
- Browser host and participant contexts created, joined, started and voted; totals
  updated, completed results survived restart, and reset was visible after refresh.
- Browser API outages recovered without guest fallback; initial account/cached
  catalogue failures were retried successfully; cross-tab logout cleared room data.
- Guest selection/votes retained their original behavior and storage isolation.
- Existing root frontend, navigation, ratings and My List regressions passed.

Test-only identity/repository simulations remain useful unit coverage, but the
claims above come from the new real MongoDB/HTTP/browser integration checks.
Final root command `node --test --test-concurrency=1 --test-reporter=spec`:
**240 passed, 0 failed, 0 skipped**, including all configured browser tests.
Reusable test support was moved outside discovery so empty helper-file suites
are not included in that count. The final run took approximately 90 seconds.
The earlier 184-test independent-development result remains historical evidence;
it is not substituted for these real integration checks.

Final diff review confirmed that shared app mounting and startup each add only
two lines. Shared dependency/lockfiles, connection, middleware, Title/User models,
authentication UI, catalogue data, ratings and watchlist modules are unchanged
relative to fetched main. All ten original Member 5 commits are ancestors of HEAD.
No .env, credential URI/private-key/JWT literal, MongoDB data/binary, screenshot or
test log is added to Git. The only remaining unrelated untracked path is `.vscode/`.

## Contracts and deployment/review boundaries

See [session API](movie-night-backend.md) and [room contract](movie-night-room-contract.md).
The branch preserves the seven agreed session paths/bodies and shared auth/error
architecture, adding the previously documented revision header and six room routes.
Room mode/schema/indexes, sanitized polling DTO and revision/round preconditions
must be reviewed with the team in PR #22 before main is merged.

No Atlas connection, shared-data mutation, stress test, destructive seeding or
index deployment was performed during verification. The next deliberate normal
server startup will create the verified indexes in its configured database.
Confirm database privileges and any external legacy records with M1 before that
startup; existing records without mode/revision need explicit scoped migration.
There is no need to invent replacement authentication or another shared server.

## Demonstration

### Sequential

1. Start the shared server using the existing private configuration and catalogue.
2. Register/sign in through `login.html`. Open Movie Night and choose three films
   from the keyboard-accessible movie picker.
3. Set four slots, start, cast one vote, refresh and show restored progress.
4. Cast remaining votes to produce a 2-2 tie; show the final stored results.
5. Show saved-session selection, vote-only restart, delete, and an old-revision
   request returning 409 without consuming a new turn.
6. Open Guest demo explicitly and demonstrate that account votes were not imported
   into browser storage and guest votes do not alter saved sessions.

### Rooms

1. Use separate signed-in browser profiles or devices. Host selects With other
   devices, chooses three movies and creates a two-slot room.
2. Host chooses Join as a voter. The second account enters the shared code.
3. Once both slots fill, host starts. Each account votes from its own context.
4. Observe progress/totals and server-derived winners/ties; refresh to restore.
5. Demonstrate duplicate-account/old-round rejection and foreign-account denial.
6. Host restarts the round, retaining the roster. Participants refresh to observe
   it, and host explicitly starts again. Logout clears account state in other tabs.

## Known limitations

One account means one ballot, not proof of one human. There is no anonymous guest
room membership, leave/kick flow, room expiry, room deletion UI or no-show timeout.
The host must fill every configured slot before starting. Completed polling stops;
use Refresh room or refocus the page to observe a later reset. The join limiter is
per process. Blocked tab storage prevents transferring a new account draft between
picker/pages and reports an error; existing URL-based saved state still restores.
Guest demo still needs the shared server for catalogue/account status, as on main.
No physical-device, shared Atlas or production deployment verification is claimed.
