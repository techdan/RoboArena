# Phase 8 room-service deployment gate

## Deployment target

RoboArena uses a split deployment for v1:

- **Vercel** hosts the Next.js web application.
- **A long-lived container/VM host** runs the authoritative Node WebSocket room
  service. It must support TLS WebSocket pass-through, graceful restart, and one
  process owner per room.
- **Supabase Postgres** is the target production database. The room service is
  its only database client; database credentials and participant-token hashes
  must never be exposed to the browser or placed in a `NEXT_PUBLIC_*` variable.
- **Local Supabase Postgres** is the target development database once the
  Postgres storage adapter lands. Keep schema migrations under `supabase/` and
  run them against both local and hosted projects.

The only room-service setting needed by the Vercel web deployment is:

```text
NEXT_PUBLIC_ROOM_WS_URL=wss://<room-service-host>
```

Do not run the current SQLite database in a Vercel Function. Vercel Functions
have only ephemeral writable `/tmp` storage, and separate function instances do
not share a SQLite file. Vercel WebSockets also do not provide the sticky,
indefinite process ownership assumed by the current in-memory connection map,
room lock, and broadcast implementation.

An all-Vercel room service would therefore be a separate distributed-systems
migration: shared Postgres storage, distributed locks/idempotency, shared
presence and pub/sub fan-out, and reconnect behavior across non-sticky function
instances. It is not required for v1.

## Current local/test adapter

`server/storage.ts` currently implements the storage contract with SQLite WAL.
It remains supported for automated tests and zero-setup local development, but
it is not the selected production database. Until the Postgres adapter and
migrations are implemented, the portable image can only be used as a temporary
test deployment with a persistent volume:

```sh
docker build -f deploy/room-service.Dockerfile -t roboarena-room-service .
docker run --rm -p 3001:3001 -v roboarena-room-data:/data roboarena-room-service
```

The SQLite profile uses `PORT=3001` and
`ROOM_DATABASE_PATH=/data/roboarena.sqlite`. Do not point a production Vercel
deployment at an ephemeral instance of this profile.

## Supabase connection profile

The future Postgres adapter should accept one server-only `DATABASE_URL`. A
persistent room-service host should use Supabase's direct connection when it has
IPv6 connectivity, or the session-mode pooler on an IPv4-only host. Transaction
pooling is intended for temporary/serverless clients and is not the default for
this long-lived service.

For local development, the supported Supabase workflow is:

```sh
npx supabase init
npx supabase start
```

The local stack requires Docker and must not be exposed publicly. Commit the
generated configuration and SQL migrations, but never commit hosted database
passwords or generated local secrets.

## External verification gate

The service health check is `GET /health`. Before closing the external gate:

1. Deploy the room service and apply the checked-in Postgres migrations to a
   non-production Supabase project.
2. Create a room over the deployed `wss://` endpoint from network A.
3. Join from a separate device on network B.
4. Ready both seats and start a match.
5. Restart/redeploy the service without resetting the database.
6. Reload both browsers and confirm their opaque rejoin tokens restore the same
   player IDs, room, configuration, and match.
7. Retry a previously acknowledged mutation and confirm it is idempotent.

Local automated coverage proves the four-client protocol, token ownership,
request retry, and SQLite restart invariants. The Supabase/WSS/two-network check
requires deployment credentials and two external devices, so record its result
separately rather than claiming it from a local run.

## Vendor references

- [Vercel Function filesystem](https://vercel.com/docs/functions/runtimes)
- [Vercel SQLite guidance](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
- [Vercel WebSocket support](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Supabase Postgres connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
