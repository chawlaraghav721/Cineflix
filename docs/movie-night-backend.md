# Member 5: independent Movie Night backend

All work belongs to `feature/backend-movie-night`. No shared Express application,
connection, authentication middleware, or package configuration is supplied here.
The existing browser flow remains active. Test repositories and identities exist
only in `backend/tests/`.

## Implemented sequential service

`backend/src/services/movieNightRules.cjs` validates configuration and votes and
calculates ID-based tallies. Configuration requires three distinct catalogue
movies and an integer voter count of 2-10. Production code does not load the static
JSON; a trusted title repository must supply records from Member 1's Title model.

`createMovieNightSessionService({sessionRepository,titleRepository})` provides
create/get/list/delete, `submitVote(actor,id,{itemId},expectedRevision)`,
`resetSession(actor,id,expectedRevision)`, and `getResults(actor,id)`.
Caller context must come from M2's verified `req.user`, never the request body.
Its presence check is not authentication. All targeted operations include host
ownership; missing and foreign sessions both return internal 404 errors.

Sessions start at revision 0. Votes and resets advance once and never rewind.
Results include zero tallies in selection order; incomplete results have no
winners. Repeated choices by different sequential slots are valid. Completion
status is set with the last vote. Malformed stored state is an internal error.

## Proposed integration contracts (not team-approved or mounted)

Existing `/api/movie-night/sessions` routes and JSON bodies remain as agreed.
Add `revision` to session records and require `X-Movie-Night-Revision` on vote and
reset requests. Missing/malformed revisions => 400 `INVALID_REVISION`; stale or
lost conditional writes => 409 `SESSION_CONFLICT`; current completed sessions =>
409 `VOTING_COMPLETE`. Errors use `{error:{code,message}}`. Public status values
`voting`/`complete`, tally entries `{itemId,count}`, and winner ID arrays await team
review. The fixed results envelope remains `{complete,tallies,winners,isTie}`.

Revisions are nonnegative safe integers and cannot wrap. No absent revision is
silently defaulted. A client must refetch after conflict or a lost response; never
automatically replay a mutation at the new revision. This gives at-most-one turn
consumption per revision, not successful-response replay.

## Repository interface

Factories require explicit dependencies. Repository records normalize `_id` and
`hostUser` to strings; database ownership remains ObjectId in the shared collection.

| Method | Required behavior |
| --- | --- |
| `titleRepository.findByIds(ids)` | Trusted title array |
| `create(record)` | Insert allowlisted configuration/host/votes/status/revision; return record |
| `findOwned({sessionId,hostUser})` | Host-owned record or null |
| `listOwned({hostUser})` | Host-owned session array |
| `appendVoteOwned(scope,{itemId,nextStatus})` | Atomic append/status/revision advance; record or null |
| `resetVotesOwned(scope)` | Atomic clear/status/revision advance; record or null |
| `deleteOwned({sessionId,hostUser})` | Boolean deletion result |

Conditional scopes contain `sessionId`, `hostUser`, and `expectedRevision`.
The old unconditional reset update is removed. Future adapters must filter actual
writes by host and revision; vote filters also require active status, selected ID
membership, and remaining capacity. Appending the vote, marking completion and
incrementing revision must occur in one operation. No in-process lock or unscoped
fetch-then-save is a substitute. Reset preserves identity, host, selection and count.
Deleting a session never permits a stale vote to recreate it.

MongoDB documents single-document atomicity and expected-value update filters:
https://www.mongodb.com/docs/manual/core/write-operations-atomicity/

## Verification and limitations

## HTTP preparation

`createMovieNightControllers` accepts the session service and optional room service.
It implements agreed success statuses/envelopes, strict revision/round parsing,
resource ID/body checks and private/no-store responses. Expected business errors
become the agreed JSON envelope. Unexpected errors are forwarded to M1's shared
safe 500 middleware; internal details must never be serialized there.

`registerMovieNightRoutes` accepts a supplied router, controllers, real
`requireAuth`, and real `protectMutation` middleware. It does not import Express,
implement middleware, or mount routes. Every read requires auth; every mutation
also requires the supplied Origin/CSRF protection. Rooms require explicit
`enableRooms: true`; imports alone do nothing. M1 must coordinate the eventual
`/api/movie-night` mount, and M2 must approve these middleware interfaces.

HTTP tests invoke handlers with test-only request/response fixtures. They do not
constitute an actual Express/cookie/JWT/CSRF integration test.

## Test commands

The dormant `js/movie-night-api.js` exports a fetch client and room poller. No HTML
loads it and no existing frontend file is changed. Creation payloads contain only
configuration; cookies remain same-origin and no JWT or identity is stored/read.
Mutations are never automatically replayed. Errors/204/abort are explicit.
Polling is serial, backs off on transient errors (2.5s normal / 15s cap), ignores
older revisions, stops on completion/access failure and aborts on stop. Consumers
must stop it on logout/navigation and explicitly restart after a completed round
is reset. It does not imply any unavailable backend is active.

```powershell
node --test backend/tests/movie-night-rules.test.cjs backend/tests/movie-night-session-service.test.cjs backend/tests/movie-night-voting-service.test.cjs
node --test
```

Controlled test barriers force concurrent reads of the same revision. Test-only
repositories simulate conditional writes. These tests establish service behavior,
not real MongoDB atomicity, persistence, verified authentication, or CSRF protection.
Future database tests must use authorized isolated infrastructure, never destructive
resets of the shared Atlas database.

## Continuous independent work

Model preparation now lives in `backend/src/models/MovieNightSession.cjs`.
Its factory requires M1's existing connection; it never opens one. Document
validation covers configuration, vote/status consistency and revision invariants.
Catalogue existence/type checks still belong to the trusted title lookup.
`backend/src/repositories/movieNightRepository.cjs` builds host/mode-scoped reads
and conditional updates against an injected model. Query-spy tests verify the
generated filters/updates; they do not execute MongoDB.

Real Mongoose document tests run without a database when Mongoose is available.
Otherwise that clearly labelled test is skipped. For this independent run,
Mongoose 9.12.2 was installed outside the repository in a temporary directory.
Set `CINEFLIX_MONGOOSE_PATH` to its module directory to include those checks.
No shared package manifest/lockfile is created. Recheck compatibility against
M1's eventual dependency version and perform real database verification later.

Next milestones prepare a dependency-injected model and persistence adapter,
multi-device room rules/services, HTTP controllers, dormant frontend API/polling
helpers, and their tests. Each completed tested unit gets a focused local commit.
Do not push, merge or deploy without permission.

Multi-device rooms remain a planned goal. Proposed room routes, schema/index
extensions, participant permissions and round headers require team coordination.
The intended first version uses M2's authenticated accounts, capacity-limited
membership, a host-started frozen roster, one vote per participant per round,
polling and persistent server-calculated results. Codes locate rooms; they are
not credentials. A host joins explicitly to consume a voter slot. Independent
participants must not contend for one client-supplied sequential revision.

The independently implemented room rules/service and injected-model repository
now live alongside the sequential modules. See `movie-night-room-contract.md` for
the proposed lifecycle and privacy contract. Race tests simulate competing joins,
ballots and resets; query tests inspect actual generated MongoDB update commands.
Room vote completion uses an update pipeline after ballot append, not a status
calculated from a potentially stale service snapshot. Mongoose document validation
also covers room invariants. Index auto-creation is disabled: M1 must explicitly
review/deploy indexes, including the partial unique room-code index, before use.

M1 must supply dependencies, shared connection, Title model, route mounting and
error middleware. M2 must supply JWT-cookie authentication and Origin/CSRF safeguards.
Integration must keep guest and account state separate, verify actual database
constraints/races and multi-account requests, and preserve all frontend regressions.
