# Phase 12.5 Vercel + Supabase deployment migration

## Target architecture

RoboArena deploys without a VM or long-lived custom room-service host:

- **Vercel** hosts the Next.js application, authenticated HTTP command routes,
  participant-specific projection routes, and deterministic turn resolution.
- **Supabase Postgres** stores canonical rooms, participant-token hashes,
  idempotent request results, locked orders, pending resolutions, turns,
  acknowledgements, and replay data.
- **Supabase Realtime Broadcast** sends private room-revision invalidations.
  **Presence** may provide advisory online indicators.
- **SQLite + the standalone `ws` server** remain the zero-setup local/test
  profile through the Phase 12 local release-candidate gate.

Every gameplay mutation goes through Vercel server code. The browser never
writes authoritative tables or resolves shared turns. Realtime messages never
contain orders, contacts, events, match state, participant tokens, or private
projections; they tell an authorized browser only that a room revision changed,
after which it refetches its projection from Vercel.

There is no production `NEXT_PUBLIC_ROOM_WS_URL`, Docker/VM deployment, sticky
room owner, or in-memory cross-request connection map.

## Why the local service cannot be lifted unchanged

`server/index.ts` currently combines four concerns that Phase 12.5 separates:

1. WebSocket transport and connection tracking;
2. schema validation and protocol dispatch;
3. authoritative room/match transitions and projections;
4. SQLite persistence plus process-local room locking.

Vercel Functions may run concurrently and future requests are not guaranteed to
reach the same instance. `RoomService.#locks`, `RoomService.#connected`, SQLite,
and the socket broadcast map therefore cannot be deployed as authority. Extract
one transport-independent command handler, move concurrency/idempotency into
Postgres transactions, and treat Realtime as notification rather than state.

## Storage and transaction profile

The Postgres adapter accepts a server-only `DATABASE_URL` using the Supabase
transaction pooler appropriate for serverless clients. Keep schema migrations
under `supabase/migrations/` and apply them to local/test and hosted projects.
Never place database, service-role, or JWT-signing credentials in a
`NEXT_PUBLIC_*` variable.

Required guarantees:

- serialize mutations per room with `SELECT ... FOR UPDATE` or a
  transaction-scoped advisory lock;
- store the mutation and its unique `(principal, request_id)` result in one
  transaction;
- enforce unique locked-order and canonical-turn keys;
- persist pending seed/nonce/combined orders before resolution;
- apply a resolved candidate only if the pending nonce and revision still
  match, so concurrent deterministic calculations cannot double-commit;
- keep the previous canonical room intact if resolution or commit fails;
- emit a room-revision invalidation only after commit.

## HTTP and Realtime profile

Expected deployed endpoints:

- `POST /api/rooms/command` validates one versioned protocol command and
  returns the caller's fresh participant projection;
- `GET /api/rooms/:code/snapshot` authenticates the opaque room token and
  returns the current participant projection;
- `POST /api/rooms/:code/realtime-token` authenticates the seat and returns a
  short-lived room-scoped JWT for a private Realtime channel.

Private-channel RLS permits a scoped participant to receive Broadcast/Presence
for its room. Clients may publish Presence but not Broadcast. Presence is UI
advice only and never controls readiness, locks, resolution, acknowledgement,
resignation, or ownership.

The deployed client:

1. submits commands over HTTP;
2. subscribes to the private room channel;
3. refetches after subscribe, reconnect, tab focus/visibility return, and each
   room-changed notification;
4. runs a slow 10-15 second revision poll while actively waiting;
5. degrades to polling when Realtime is unavailable.

Missed notifications therefore affect latency only. Canonical state and resume
always come from Postgres through an authenticated Vercel projection.

## Local development

The existing commands remain the Phase 12 local profile:

```text
npm run dev
npm run dev:server
```

The SQLite adapter remains supported for unit/integration tests and local
release-candidate validation. Phase 12.5 adds adapter-contract tests against
local Supabase Postgres; it does not require every ordinary UI iteration to run
the full Supabase stack.

For migration testing:

```text
npx supabase init
npx supabase start
```

The local Supabase stack requires Docker and must not be exposed publicly.
Commit configuration and SQL migrations, never generated secrets.

## Deployment verification gate

1. Finish the Phase 12 local release candidate before changing transport.
2. Apply migrations to a hosted Supabase project.
3. Configure server-only database/signing credentials and public Realtime
   connection values in Vercel.
4. Deploy the single Next.js application.
5. Verify private channel authorization and rejection of cross-room access or
   client-authored Broadcast events.
6. Drop/delay Realtime messages and confirm subscribe/focus/polling refetch
   converges on the canonical revision.
7. Race duplicate mutations across independent handler instances and confirm
   exactly one canonical transition commits.
8. Trigger a Vercel cold start/redeploy and confirm rooms resume solely from
   committed Postgres state.
9. Complete a four-player match across two real networks without projection,
   visibility, result, or replay divergence.
10. Repeat the critical room-to-results path on physical iPad Safari.

Passing this gate completes the deployed online FFA Survival v1.

## Vendor references

- [Vercel WebSocket support](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase database-change subscriptions](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Supabase Postgres connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
