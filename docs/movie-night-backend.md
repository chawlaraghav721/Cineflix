# Movie Night backend: Member 5

## Scope and current milestone

Work belongs on `feature/backend-movie-night`. The approved first milestone is
dependency-free business rules and isolated tests. It does not mount routes,
connect to MongoDB, authenticate users, or modify the existing browser experience.
There is no second Express server or database connection module.

Implemented files:

- `backend/src/services/movieNightRules.cjs`
- `backend/tests/movie-night-rules.test.cjs`

The explicit `.cjs` extension allows the rules to run without a package manifest
and avoids deciding Member 1's shared CommonJS/ES module configuration. A future
CommonJS controller can `require()` this module; an ES module controller can use
its default import. Member 1 still owns the shared dependency setup.

## Rule interface

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

## Verification

From the repository root:

```powershell
node --test backend/tests/movie-night-rules.test.cjs
node --test
```

The first command runs the isolated rule tests without installing dependencies.
The second includes these tests and the existing frontend regression suite.
Tests cover strict configuration validation, actual catalogue IDs, show/unknown-ID
rejection, trusted-record lookup, invalid/excess votes, completion bounds, zero
counts, partial results, winners, two/three-way ties, and immutable inputs.

These tests do not prove database atomicity, authentication, ownership isolation,
or persistence. Those checks belong to later integration milestones.

## Remaining Phase 1 milestones

Each completed milestone must have passing relevant tests before a local commit.
Tests accompany behavior changes; they are not deferred to the final commit.
Never push, merge, or deploy without the user's permission.

1. **Session model:** Mongoose schema and executed validation tests, after Member 1
   establishes dependencies. Proposed commit: `feat(movie-night): add host-owned
   session model`.
2. **Session APIs:** host-scoped create/list/get/delete/reset, with injected
   repository tests first. Proposed commit: `feat(movie-night): implement
   host-scoped session APIs`.
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

The next milestone is the Phase 1 session model where dependencies permit, not
Phase 2 implementation or a replacement shared backend.
