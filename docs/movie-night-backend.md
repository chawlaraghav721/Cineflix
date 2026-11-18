# Movie Night backend: Member 5

## Scope and current milestone

Work belongs on `feature/backend-movie-night`. Completed independent work covers
business rules and repository-injected session management with isolated tests.
It does not mount routes, connect to MongoDB, authenticate users, or modify the
existing browser experience. There is no second Express server or database
connection module.

Implemented files:

- `backend/src/services/movieNightRules.cjs`
- `backend/tests/movie-night-rules.test.cjs`
- `backend/src/services/movieNightSessionService.cjs`
- `backend/tests/movie-night-session-service.test.cjs`

The explicit `.cjs` extension allows the rules to run without a package manifest
and avoids deciding Member 1's shared CommonJS/ES module configuration. A future
CommonJS controller can `require()` this module; an ES module controller can use
its default import. Member 1 still owns the shared dependency setup.

## Rule interface

- `validateSessionConfiguration(input)` checks request shape and returns a copy of
  `selectedIds` and `voterCount` before repository access. It does not check title
  existence; `validateSessionInput` must still run against trusted title records.
- `validateSessionInput(input, catalogueTitles)` validates exactly three distinct
  stable IDs and an integer voter count from 2 through 10. Every ID must match a
  trusted catalogue record with `type: "movie"`. The returned configuration is a
  copy containing only `selectedIds` and `voterCount`, never client ownership or
  votes. The production controller must supply records queried through Member 1's
  Title model. Catalogue JSON is loaded only by the tests, not by production rules.
- `validateNextVote(state, itemId)` validates one selected movie against an ordered
  sequential vote history and rejects a completed session. It does not append a
  vote, prevent concurrent requests, or establish identity.
- `calculateResults(state)` derives completion, tallies, winner IDs, and tie state
  from valid configuration and vote history. Zero-vote movies remain present in
  selection order. Winners are empty and `isTie` is false until all votes arrive.
- `MovieNightRuleError` carries an internal `code`, `message`, and `statusCode`.
  Input errors use 400; a vote on a completed session uses 409. Future controllers
  must map errors into the agreed `{error:{code,message}}` response envelope.
  Unexpected programmer/database errors must use the shared safe 500 handler.

Rule state uses `{selectedIds, voterCount, votes}` with votes as catalogue ID
strings. It deliberately excludes transport, ownership, and persistence details.
Repeated votes for the same movie are valid across different sequential slots.
Stored IDs are not re-queried during tally calculation: deletion of a catalogue
title must not erase its recorded votes. The future UI must handle unavailable
metadata without inventing replacement identities.

The internal tally shape is `[{itemId,count}]`; winners are catalogue ID strings.
This is not an approved HTTP serialization contract. Likewise, provisional error
code names and incomplete-results semantics must be reviewed before integration.
No revision header, room route, or shared contract extension is implemented here.

## Session-management service and internal repository contract

`createMovieNightSessionService({sessionRepository,titleRepository})` requires
explicit dependencies, with no default or in-memory production implementation.
All methods are asynchronous. A future controller must pass only Member 2's
verified `req.user` as `actor`; request bodies, query parameters, demo storage,
or arbitrary browser user IDs must never supply this argument.

The service rejects missing/malformed `actor.id` with an internal 401 error. This
is a caller precondition, not token verification or authentication middleware.
An arbitrary well-shaped identity is not proven authentic by this service.

| Service method | Behavior | Future agreed endpoint |
| --- | --- | --- |
| `createSession(actor,input)` | Validate configuration, resolve trusted movies, create an empty host-owned session | `POST /api/movie-night/sessions` (201) |
| `getSession(actor,sessionId)` | Retrieve an owned record | `GET /api/movie-night/sessions/:sessionId` |
| `listSessions(actor)` | Return `{sessions:[...]}` for that host | `GET /api/movie-night/sessions` |
| `resetSession(actor,sessionId)` | Clear votes, retain host/selection/count/record identity | `POST /api/movie-night/sessions/:sessionId/reset` |
| `deleteSession(actor,sessionId)` | Delete only the owned record, return no payload | `DELETE /api/movie-night/sessions/:sessionId` (204) |

No endpoints or HTTP response handling are implemented yet. Internal repository
records normalize `_id` and `hostUser` to strings, retain stable catalogue IDs,
and otherwise carry session fields/timestamps. This does not change MongoDB's
agreed ObjectId ownership field or freeze the eventual public response schema.
The service's current internal active-state value is `voting`; any public status
enum/serialization still needs review alongside the model and route contracts.

| Required repository method | Internal contract |
| --- | --- |
| `titleRepository.findByIds(selectedIds)` | Return trusted title records as an array; no client-supplied catalogue data |
| `sessionRepository.create(record)` | Persist the allowlisted configuration, trusted `hostUser`, empty votes and active status; return the created record with ID/timestamps |
| `sessionRepository.findOwned({sessionId,hostUser})` | Return the exact host-owned record, or `null` |
| `sessionRepository.listOwned({hostUser})` | Return an array containing only that host's sessions; an empty list is `[]` |
| `sessionRepository.updateOwned({sessionId,hostUser},changes)` | Apply only the supplied reset fields (`votes`, `status`) to the matched record; maintain timestamps; return updated record or `null` |
| `sessionRepository.deleteOwned({sessionId,hostUser})` | Delete the matched record only; return exactly `true` if deleted, `false` if absent |

The future Mongoose adapter must put both `_id: sessionId` and `hostUser` into
every targeted database read/update/delete filter. It must normalize/validate
database identifiers and translate query/update results into the interface above.
No unscoped fetch-then-write ownership check is acceptable. Reset must use an
update, not replacement of the entire session. The service never accepts reset
changes or ownership overrides from a browser body.

Foreign and missing sessions both result in `SESSION_NOT_FOUND` (404), avoiding an
existence distinction. There is no admin ownership bypass. The service also
rejects accidentally returned foreign/mismatched records rather than exposing
them; such adapter violations and unexpected errors go to the future shared safe
500 handler. These defensive result checks cannot undo an unsafe repository write.

Test repositories and identity fixtures live exclusively under `backend/tests/`.
The tests verify use-case behavior and host-scoped adapter calls, including
negative access attempts. They do not prove real authorization, database filters,
MongoDB persistence, timestamps, or race safety. Reset-versus-vote concurrency
still awaits the approved voting precondition; no revision mechanism is added.

## Verification

From the repository root:

```powershell
node --test backend/tests/movie-night-rules.test.cjs
node --test backend/tests/movie-night-session-service.test.cjs
node --test
```

The first two commands run isolated tests without installing dependencies.
The last includes these tests and the existing frontend regression suite.
Rule tests cover strict configuration validation, actual catalogue IDs, show/unknown-ID
rejection, trusted-record lookup, invalid/excess votes, completion bounds, zero
counts, partial results, winners, two/three-way ties, and immutable inputs.
Service tests cover creation, retrieval, listing, reset, deletion, caller identity
preconditions, foreign ownership, scoped write arguments, adapter contract
violations, and repository failure propagation without fallback writes.

These tests do not prove database atomicity, authentication, ownership isolation,
or persistence. Those checks belong to later integration milestones.

## Remaining Phase 1 milestones

Each completed milestone must have passing relevant tests before a local commit.
Tests accompany behavior changes; they are not deferred to the final commit.
Never push, merge, or deploy without the user's permission.

1. **Session model:** Mongoose schema and executed validation tests, after Member 1
   establishes dependencies. Proposed commit: `feat(movie-night): add host-owned
   session model`.
2. **Session APIs:** the independent host-scoped create/list/get/delete/reset
   service and injected-repository tests are implemented. HTTP controllers and
   routes still need M1/M2 integration; this is not a working API milestone yet.
3. **Atomic voting:** conditional persistence with actual concurrency verification.
   Proposed commit: `feat(movie-night): persist sequential votes atomically`.
4. **Shared integration:** Member 1's route mount, Title model, shared connection,
   and error middleware; Member 2's real `requireAuth` and Origin/CSRF protections.
   No permissive production auth fallback. Proposed commit: `feat(movie-night):
   connect routes to shared backend`.
5. **Frontend:** asynchronous authenticated sessions, refresh restoration, results,
   and error states while retaining the existing single-device experience and
   separate guest data. Proposed commit: `feat(movie-night): integrate persistent
   sessions with frontend`.
6. **Integration evidence:** multi-account/API/browser regression checks and demo
   documentation in focused test/documentation commits where warranted.

Two decisions require coordination before integration:

- The agreed `{itemId}` vote body cannot distinguish a delayed duplicate request
  from the next voter choosing the same movie. Proposed session revision/turn
  preconditions must be approved and enforced atomically, including across reset.
- API reset clears votes; the existing UI resets the entire night. Proposed
  separate restart-voting and delete-to-clear actions preserve both meanings.

## Phase 2: planned project goal, pending shared-contract coordination

Multi-device Movie Night is a planned goal, not discarded or implemented by this
milestone. Keep the current owner-only sequential endpoints intact. Proposed room
routes, response fields, schema extensions, and concurrency preconditions need team
agreement before integration; the route names below remain proposals.

- Unique room codes with a database uniqueness constraint and collision retry.
- Authenticated joining from another device, idempotent repeated joins, and atomic
  capacity enforcement. Codes locate rooms; they do not replace authentication.
- A host-started round after the configured 2-10 slots fill; membership freezes.
  A host who wants to vote joins explicitly and consumes a slot.
- Independent participant votes, at most one per account per round. Identity and
  membership checks are separate from the reusable ID-based tally calculation.
- Authorized polling for progress/totals with retry and cleanup behavior.
- Persistent final results and automatic server-calculated winners/ties.
- A new round identifier on restart, rejecting delayed requests from prior rounds.

Proposed additional routes under `/api/movie-night`: `POST /rooms`,
`POST /rooms/join`, `GET /rooms/:roomId`, `POST /rooms/:roomId/start`,
`PUT /rooms/:roomId/votes/me`, and `POST /rooms/:roomId/reset`. Existing session
routes must not become participant-readable merely because a session ID is known.

Proposed persistence extends the existing session collection with a mode, bounded
membership/vote records, room code, and round identity. Member 1 must coordinate
schema/indexes, atomic writes, mounting, shared dependencies, and polling load.
Member 2 must coordinate real authenticated identities and request protections.
Anonymous guests are outside this proposed first room version and would need a
separate identity agreement. One vote per account does not guarantee one per human.

Room code generation, lifecycle rules, membership rules, result calculations, and
simulated polling UI can be developed independently after the relevant milestone
is authorized. Real joining/voting/access-control and database race checks need
the shared backend/authentication. Independent participant votes should not use
one global sequential-turn revision that rejects other participants' valid votes.

Planned room commits, each with its own relevant tests:

1. `feat(movie-night): define room lifecycle and membership rules`
2. `feat(movie-night): persist rooms with unique join codes`
3. `feat(movie-night): add authenticated room joining`
4. `feat(movie-night): enforce one participant vote per round`
5. `feat(movie-night): add room polling and results API`
6. `feat(movie-night): add multi-device room interface`
7. `test(movie-night): verify multi-device voting lifecycle`

This milestone stops at the session service. Next work is the Phase 1 session model
and persistence adapter where shared dependencies permit, followed by real
authenticated HTTP integration, not a replacement shared backend. Phase 2 remains
a planned project goal pending coordination.
