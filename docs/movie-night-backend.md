# Member 5: integrated Movie Night

Movie Night is integrated on `feature/backend-movie-night` with the shared Express
app, Mongoose 8.x connection, Title model and Member 2's JWT-cookie middleware.
No second application, connection or authentication implementation is introduced.
The catalogue's stable `movie-...` IDs remain the source of title identity.

## Request flow and files

`backend/src/app.js` mounts `/api/movie-night` using
`backend/src/routes/createMovieNightRouter.cjs`. That composition module supplies
the existing Express router, Mongoose singleton/connection, Title model,
`requireAuth` and `protectMutation` to Member 5's factories.

- `models/MovieNightSession.cjs`: schema factory on the existing connection.
- `repositories/movieNightRepository.cjs`: sequential/title persistence adapters.
- `repositories/movieNightRoomRepository.cjs`: room reads and conditional writes.
- `services/movieNightRules.cjs`: strict validation and ID-based result calculation.
- `services/movieNightSessionService.cjs`: host-owned sequential lifecycle.
- `services/movieNightRoomRules.cjs`, `movieNightRoomService.cjs`: room lifecycle,
  codes, membership, account ballots and private state projection.
- `controllers/movieNightController.cjs`, `routes/movieNightRoutes.cjs`: response
  handling and route registration with supplied security middleware.

All backend paths above are relative to `backend/src/` unless fully qualified.
The dependency-free factories and their earlier isolated tests remain useful;
the composition layer now connects them to the actual project dependencies.

## Authentication and errors

Every endpoint requires real `requireAuth`. Identity comes only from verified
`req.user.id`; browser user IDs/roles cannot change ownership or participation.
Every mutation also runs the existing Origin/Referer and Fetch-Site checks in
`protectMutation`. No credentialed cross-origin access or frontend JWT storage
is added. Movie Night responses are private/no-store. Unexpected errors are
forwarded to the existing safe 500 handler.

Errors use `{error:{code,message}}`. Missing/invalid/expired cookies return 401;
inaccessible sequential sessions or rooms return 404. Accessible non-host room
management and nonparticipant voting return 403. Invalid input returns 400;
stale revisions/rounds, completed voting and duplicate ballots return 409.
Room joins additionally have a 30-attempt, one-minute per-account/per-process
limit returning 429 `ROOM_JOIN_LIMIT`. Existing authentication limits are unchanged.

## Session API

All paths below are under `/api/movie-night`.

| Method/path | Request | Success |
| --- | --- | --- |
| `POST /sessions` | `{selectedIds,voterCount}` | Created own session, 201 |
| `GET /sessions` | Cookie | `{sessions:[...]}` for host, 200 |
| `GET /sessions/:sessionId` | Cookie | Own stored state, 200 |
| `POST /sessions/:sessionId/votes` | `{itemId}`, revision header | Updated state, 200 |
| `GET /sessions/:sessionId/results` | Cookie | `{complete,tallies,winners,isTie}`, 200 |
| `POST /sessions/:sessionId/reset` | Revision header, no body required | Same configuration with cleared votes, 200 |
| `DELETE /sessions/:sessionId` | Cookie | Delete own session, 204/no body |

Creation requires exactly three distinct existing **movie** IDs and an integer
`voterCount` from 2 through 10. Sessions expose `_id`, `hostUser`, `selectedIds`,
`voterCount`, `votes`, `status`, `revision`, mode and timestamps. Status is `voting`
or `complete`. This is one authenticated host with numbered sequential local
slots, not separate participant accounts.

## Sequential concurrency

Votes and reset require `X-Movie-Night-Revision`, a canonical nonnegative decimal
safe integer that can still be incremented. Missing/malformed values return 400
`INVALID_REVISION`; stale values or lost conditional writes return 409
`SESSION_CONFLICT`. A current completed session rejects another vote with 409
`VOTING_COMPLETE`. Creation starts at revision 0; successful vote/reset increments
once. Reset never rewinds the revision or changes title selection/voter count.

The actual MongoDB vote filter checks `_id`, host, sequential mode, expected
revision, voting status, selected movie membership and remaining capacity. One
update appends the vote, changes completion status and increments the revision.
Reset uses the same host/revision CAS. There are no in-process voting locks or
unconditional fetch-then-save writes. A losing request is not automatically retried
at a newer revision. Reload state before another deliberate turn after conflicts
or lost responses. Different turns can legitimately choose the same movie.

The result service derives totals/winners from stored votes, including zero-vote
selections. Tallies are `[{itemId,count}]`; winners are catalogue ID strings.
Incomplete sessions have no final winners and `isTie:false`.

## Rooms and round concurrency

See [room API and lifecycle](movie-night-room-contract.md) for the six additional
room routes, response fields and permissions. Rooms use the same collection with
`mode: room`; owner-only sequential endpoints cannot read or mutate room records.
Host membership is explicit, capacity is fixed at 2-10, and the host starts after
every slot fills. Each authenticated account may submit one immutable ballot in
the current round. A host can observe without voting if other accounts fill slots.

`X-Movie-Night-Round` identifies the participant's round. It is not a shared client
revision: different participants may vote concurrently. MongoDB checks member
identity, active round/status, selected ID, available capacity and absence of that
account's prior ballot. The atomic update pipeline appends the ballot and derives
completion from the resulting vote count. Host start/reset use revision CAS.
Reset creates a fresh round ID, retains the roster, clears votes and returns to
waiting; the host must start again. Old-round requests cannot consume new slots.

## Schema, indexes and startup

Collection: `movienightsessions`. Common fields: mode, hostUser (ObjectId), three
selected catalogue IDs, voterCount, votes, status, revision and timestamps. Room
fields: roomCode, roundId and participants (ObjectId array). Sequential votes are
ID strings; room votes are `{participantId,itemId,roundId}` records. Services and
document validation enforce the corresponding invariants. Title existence/type
comes from the existing Title model through trusted lookup.

| Index | Purpose |
| --- | --- |
| `{hostUser:1,mode:1,createdAt:-1}` | Host session listing |
| `{roomCode:1}`, unique, partial `{mode:"room",roomCode:{$type:"string"}}` | Room-code uniqueness without affecting sequential records |
| `{mode:1,participants:1}` | Membership lookup |

Schema auto-index creation remains disabled. After the shared connection and User
index initialization, `server.js` calls `ensureMovieNightIndexes()` before
listening. It uses non-destructive `createIndexes()`, not `syncIndexes`, drops or
resets. These definitions were tested against isolated MongoDB before startup
wiring. No test or verification command here applies indexes to shared Atlas.
The next deliberate normal server start creates them in its configured database.
If older external records lack mode/revision, agree on a scoped migration; do not
silently default stored revisions, wipe records or drop conflicting indexes.

## Frontend behavior

`js/movie-night-api.js` now supplies the real client. `js/movie-night-account.js`
connects the existing picker/session UI to `CineFlixAuth`; `js/movie-night-rooms.js`
provides create/join, host controls, independent ballots, totals and polling.

Confirmed signed-out visitors retain the existing browser-only guest demo.
Signed-in visitors use saved account sessions, with a selector, new/delete actions
and vote-only restart. An explicit Guest demo link also remains available. Guest
`cineflixMovieNightV1` data is never imported into accounts or used as a fallback
after account/API failures. Protected session/room URLs require sign-in.
Account draft selection alone uses per-account sessionStorage; saved sessions and
votes live in MongoDB. Blocked tab storage reports a picker error, while URL-based
restoration of existing sessions does not depend on that draft being readable.

Session/room IDs are restored from the URL and checked again on the server.
Selection retains catalogue IDs, keyboard interaction and poster fallbacks.
Unavailable catalogue metadata displays the recorded ID without erasing votes.
Account errors and catalogue retry can recover without switching to guest mode.
Logout/account changes stop polling and clear account views, including other tabs.

Polling is serial, normally 2.5 seconds with transient-error backoff capped at
15 seconds. Older revisions are ignored. Reads stop on access loss, completion,
hidden-page/navigation or logout. Refresh room explicitly checks for a new round
after completion; refocusing the page also reloads it. Manual refresh aborts the
prior polling read and coalesces repeated refreshes. Mutations are never replayed
automatically after network loss.

## Running, verification and limitations

Use [shared backend setup](../backend/README.md); no separate Movie Night server,
database URI or authentication configuration is required. The catalogue is already
populated in the shared development database; integration tests seed only their
own isolated temporary databases. See the [integration handoff](movie-night-integration-handoff.md)
for commands, actual test results, demos and the remaining review gates.

This branch activates the previously documented Member 5 additive routes and
revision/round contract under the user's integration request. Existing catalogue
and authentication contracts are unchanged. Team review of these feature additions
and schema/index definitions is still required before PR #22 is merged.
No claim of shared Atlas verification or physical-device testing is made.
