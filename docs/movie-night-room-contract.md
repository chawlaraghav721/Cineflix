# Proposed multi-device integration contract

Implemented independently for Member 5; not mounted or team-approved. Use the same
backend, `movienightsessions` collection, connection and verified M2 identities.
No anonymous participants or alternative authentication. Room codes are locators,
not credentials; M1/M2 must apply join rate limits and existing Origin/CSRF controls.

| Method/path under `/api/movie-night` | Body / precondition | Behavior |
| --- | --- | --- |
| `POST /rooms` | `{selectedIds,voterCount}` | Host creates room; 201 |
| `POST /rooms/join` | `{roomCode}` | Signed-in account joins; repeat join is idempotent |
| `GET /rooms/:roomId` | Verified host/member | Private polling state |
| `POST /rooms/:roomId/start` | `X-Movie-Night-Revision` | Host starts full roster |
| `PUT /rooms/:roomId/votes/me` | `{itemId}`, `X-Movie-Night-Round` | One immutable account vote in this round |
| `POST /rooms/:roomId/reset` | `X-Movie-Night-Revision` | Host clears votes, creates new round, returns to waiting |

Three stable catalogue movie IDs and 2-10 voters remain required. Host is not
automatically a voter; joining explicitly consumes a slot. Capacity includes all
joined accounts. Start requires every slot filled. Membership is frozen while
voting or complete. Reset retains the roster/configuration but requires a fresh
host start. There is no leave, kick, deadline, or automatic no-show completion.

Rooms use `mode: room`, `roomCode`, `roundId`, `participants` (user ObjectIds), and
vote records `{participantId,itemId,roundId}`. Sequential sessions retain ID-string
votes and `mode: sequential`. A unique partial roomCode index and a membership
lookup index extend the same collection, subject to M1 approval/index deployment.
Codes are eight cryptographically random characters, normalized uppercase, with
I/O/0/1 omitted. On a roomCode unique-index collision only, retry at most five times.

Every join/start/reset/vote advances a server revision. Host start/reset use CAS.
Participant voting checks round and account uniqueness, not a global client
revision, allowing different participants to vote concurrently. A single database
update must check membership, round, active status, capacity, and no prior ballot;
append the ballot and calculate completion atomically. Reset changes roundId even
if the number of votes later matches an earlier state. Old-round requests fail.

Polling state contains id, mode, selectedIds, voterCount, participantCount, status,
revision, roundId, isHost, hasJoined, hasVoted, canStart and results. Only the host
receives roomCode. Raw participant IDs, individual ballots and ownership metadata
are omitted. Results use `{complete,tallies:[{itemId,count}],winners:[itemId],isTie}`.
Partial totals are deliberately visible to authorized members. Winners appear only
at completion. Requests are private/no-store; polling never mutates a session.

Errors retain `{error:{code,message}}`: missing identity 401; inaccessible or
unknown room 404; accessible non-host lifecycle action/nonparticipant vote 403;
invalid input 400; full/closed room, stale round/revision, duplicate ballot or a
lost conditional write 409. A room code may be normalized from lowercase or outer
whitespace, but IDs and revision/round preconditions are strict. These details
require team review before integration. One account vote is not one-human proof.
