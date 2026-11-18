# Member 5 integration handoff

## Delivery status

Independent Member 5 implementation is complete for sequential voting, session
model preparation, injected-model repositories, room lifecycle/membership/voting,
HTTP controllers, explicit feature route wiring, and dormant browser API/polling
helpers. This is not an integrated running website backend. Nothing is mounted,
no database is connected, and the existing same-device browser flow is unchanged.
Only `feature/backend-movie-night` was used. Nothing was pushed, merged or deployed.

## File inventory

Paths are relative to the repository root. No other member's source files changed.

| Files | Purpose |
| --- | --- |
| `backend/src/services/movieNightRules.cjs` (modified) | Strict configuration/vote/revision rules and result calculation |
| `backend/src/services/movieNightSessionService.cjs` (modified) | Host-scoped sessions, sequential votes, CAS reset, results and mutation postconditions |
| `backend/src/services/movieNightRoomRules.cjs` (new) | Secure code generation, code/round/room invariants and private polling projection |
| `backend/src/services/movieNightRoomService.cjs` (new) | Room creation, bounded collision retry, membership, host lifecycle and participant ballots |
| `backend/src/models/MovieNightSession.cjs` (new) | Injected Mongoose/connection factory, shared collection, document validators and proposed indexes |
| `backend/src/repositories/movieNightRepository.cjs` (new) | Sequential and catalogue query adapters; ObjectId/DTO normalization |
| `backend/src/repositories/movieNightRoomRepository.cjs` (new) | Scoped room queries, atomic-operation filters, completion update pipeline |
| `backend/src/controllers/movieNightController.cjs` (new) | Session/room handler factory, JSON errors, status codes and strict headers |
| `backend/src/routes/movieNightRoutes.cjs` (new) | Feature-only route registration requiring supplied auth/protection |
| `js/movie-night-api.js` (new) | Dormant same-origin client and serial room poller |
| `backend/tests/helpers/sessionFixture.cjs`, `backend/tests/helpers/roomFixture.cjs` (new) | Test-only identities/repositories; never imported by production modules |
| `backend/tests/movie-night-session-service.test.cjs` (modified) | Updated lifecycle/ownership coverage for mandatory revisions |
| `backend/tests/movie-night-voting-service.test.cjs` (new) | Sequential races, stale/duplicate/reset safeguards and failures |
| `backend/tests/movie-night-model.test.cjs` (new) | Pure invariants and optional real Mongoose document/query-casting tests without MongoDB |
| `backend/tests/movie-night-repository.test.cjs`, `backend/tests/movie-night-room-repository.test.cjs` (new) | Generated MongoDB filter/update assertions |
| `backend/tests/movie-night-rooms.test.cjs` (new) | Membership/lifecycle/race/privacy/code and participant-voting coverage |
| `backend/tests/movie-night-http.test.cjs` (new) | Controller and route registration fixtures |
| `backend/tests/movie-night-api.test.cjs` (new) | Client, browser-global loading, errors, polling, backoff, abort/restart |
| `docs/movie-night-backend.md` (modified) | Module usage and independent-development boundaries |
| `docs/movie-night-room-contract.md` (new) | Proposed room endpoints, lifecycle, schema and response permissions |
| `docs/movie-night-integration-handoff.md` (new) | This delivery and verification record |

The earlier `backend/tests/movie-night-rules.test.cjs` remains unchanged and passes.
All original HTML, catalogue data, frontend logic, and root `tests/` remain unchanged.
The pre-existing untracked `.vscode/` directory was not staged or modified.

## Executed verification

Environment: Windows, Node 22.23.4, Mongoose 9.12.2 installed in an external
temporary directory. No workspace package manifest or lockfile was created.

- Baseline: 136 tests passed before this execution.
- Sequential milestone: 139 tests passed.
- Model/repository preparation: 146 tests passed, including real disconnected
  Mongoose document validation.
- Rooms: 167 tests passed, including simulated join/vote/reset races.
- HTTP preparation: 173 tests passed.
- Dormant client/polling: 181 tests passed.
- Mutation hardening: 182 tests passed; real Mongoose query casting also exercised.
- Final suite: **184 passed, 0 failed, 0 skipped** with the external Mongoose path.
  This includes the original 96 frontend tests and 88 Member 5 backend/helper tests.
- `git diff --cached --check` passed before each code commit.
- Node's optional coverage run passed before the final two added regressions;
  coverage percentages are not evidence of database/authentication correctness.

Repeat the dependency-free suite from the root:

```powershell
node --test
```

Without Mongoose, one clearly labelled Mongoose-specific test is skipped; pure
rules/services, query spies, HTTP fixtures and browser-helper tests still run.
To repeat the full Mongoose-inclusive suite without changing shared configuration:

```powershell
$member5Deps = Join-Path $env:TEMP 'cineflix-member5-validation'
npm.cmd install --prefix $member5Deps --no-package-lock --no-audit --no-fund --ignore-scripts mongoose@9.12.2
$env:CINEFLIX_MONGOOSE_PATH = Join-Path $member5Deps 'node_modules\mongoose'
node --test --test-reporter=spec
```

Once M1 installs the project's agreed Mongoose version, its normal dependency can
be used instead. Re-run compatibility tests with that version. Real Mongoose tests
call `validate()` on disconnected documents and exercise query casting with the
collection method replaced only inside the test. They do not contact MongoDB.

## What the tests prove, and what remains unverified

Tests establish deterministic business rules, service ownership constraints,
conditional-operation orchestration, generated query contents, Mongoose document
validation/casting compatibility, response mapping and polling behavior.
Test repositories apply CAS and participant uniqueness synchronously; barriers
force competing reads of the same state. These simulations do not prove actual
MongoDB atomicity, persistence, unique-index enforcement, JWT authentication,
cookie security, CSRF protection, real cross-device behavior or browser-page UI
integration. Do not describe the feature as live until those gates pass.

## Proposed contracts requiring team approval

1. `revision` on session DTOs and `X-Movie-Night-Revision` on sequential vote/reset
   and room host start/reset. Missing/malformed => 400; stale/lost CAS => 409.
2. Session status values `voting`/`complete`; room adds `waiting`. Internal tallies
   use `{itemId,count}` and winner IDs. Result envelope remains the agreed shape.
3. Six room routes, `X-Movie-Night-Round`, roomCode/roundId/membership fields,
   participant vote records, host/participant permissions, and sanitized polling
   DTO as specified in `movie-night-room-contract.md`.
4. Same-collection mode separation and partial unique room-code/membership indexes.
   Auto-index creation is disabled; these are definitions, not deployed indexes.
5. Router factory's required supplied `requireAuth` and `protectMutation` interfaces
   and the eventual single `/api/movie-night` mount.

The user approved independent implementation, not team integration. Existing
sequential API paths and bodies are preserved. Room routes default disabled.

## Integration sequence and ownership

### Member 1

Supply the shared Express app/router, agreed package configuration/Mongoose
version, existing connected Mongoose connection, Title model/seeded catalogue,
JSON parser, static hosting, safe error middleware and route mount. The model
factory takes `{mongoose,connection}` and must receive that existing connection.
Construct the session/room repositories from the returned model and the title
repository from M1's Title model. Inject them into the services and controllers.

Review schema/indexes and explicitly deploy indexes before allowing room creation.
Missing room-code uniqueness makes collision retries ineffective. Review MongoDB
update-pipeline support and Mongoose compatibility, query plans, polling load,
join request limits and database write durability settings in the shared backend.
If any existing records lack revisions/mode, agree on an explicit scoped migration;
never silently treat every missing revision as zero or reset the shared database.

### Member 2

Supply real JWT-cookie `requireAuth` with verified string `req.user.id`, plus
Origin/CSRF mutation protection. No caller should construct identities from body,
headers or demo browser storage. Coordinate session-change/logout UI hooks.
Room code possession never bypasses authentication. Each participating account
gets one ballot per round; this is not proof of one human per ballot.

### Member 5 after integration approval

Wire the supplied dependencies, then register approved feature routes with real
middleware. Keep room routing disabled until the room contract is approved. Map
unexpected controller errors through M1's safe 500 handler without details.
Activate the dormant client only after the real API is working. Adapt existing
Movie Night UI deliberately: distinguish clearing the entire night from resetting
only votes, retain keyboard/poster/error behavior, add room create/join/start/vote
controls and session selection/restoration, and preserve a clearly separate guest
experience. Never fall back from failed account writes to guest storage or import
old guest votes automatically. Stop polling on logout/navigation.

## Real integration verification still required

- Create/retrieve/list/delete/reset against MongoDB and verify refresh/restart
  persistence, timestamps and account separation through actual HTTP/cookies.
- Run two independent application processes against authorized isolated MongoDB
  test infrastructure. Race same-revision votes and resets; verify only one write.
- Verify different room participants can vote concurrently, duplicate ballots are
  rejected, capacity cannot overflow and completion is written with the last vote.
- Verify the actual unique room-code index, bounded collision handling, mode
  isolation and old-round rejection across reset. Inspect generated database records.
- Test missing/expired/tampered cookies, foreign accounts, role non-bypass,
  Origin/CSRF denial, safe 500 responses and participant response privacy.
- Run actual multi-device/browser-context create/join/start/vote/poll flows, including
  disconnect/reconnect, session restoration and logout while polling.
- Re-run all frontend and backend tests after shared integration. Confirm guest
  data remains distinct and no account state is displayed after logout.

Never drop the shared database or wipe collections for tests. Use authorized
isolated fixtures and host-specific cleanup only.

## Demo preparation

Today, run the sequential voting and room test files to demonstrate rules,
controlled races, ties and stale-request protection. Explain that repositories
and identity contexts are test doubles and the website backend is not active.
Show document validation separately with the Mongoose-inclusive command.

After integration: host creates three-movie session, casts four votes with two
for each of two movies, refreshes, and shows the persisted tie. Replay an old
revision and show rejection without an extra vote. For rooms, use two signed-in
browser profiles/devices, join the code (including host if voting), fill/start the
room, cast independent ballots, observe polling and persistent results, replay a
participant ballot, then reset and demonstrate the old round cannot vote.
