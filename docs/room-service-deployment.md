# Deployment on Cloudflare (Workers Free plan)

RoboArena deploys as two Cloudflare Workers and needs no separate database:

- **`roboarena-rooms`** (`worker/`, config `worker/wrangler.jsonc`) is the
  authoritative room service. Each room is one SQLite-backed Durable Object
  (`RoomObject`) that runs the same `RoomService`, protocol handler
  (`server/handler.ts`) and schema as the local server, with storage in the
  object's built-in SQLite (`server/sqlStorage.ts`). Players hold hibernatable
  WebSockets, so an idle room costs nothing and wakes on the next message.
- **`roboarena`** (config `wrangler.jsonc`) is the Next.js site, built with
  `@opennextjs/cloudflare`. Models, textures and other static files are served
  as Worker static assets.

This replaces the earlier Vercel + Supabase plan. The local profile is
unchanged: `npm run dev` plus `npm run dev:server` (Node `ws` + SQLite).

## How a browser reaches a room

The client opens one WebSocket per room at `${NEXT_PUBLIC_ROOM_WS_URL}/rooms/<CODE>`.
A CreateRoom connects before its code exists, so it uses
`/rooms/new/<requestId>`; the Worker derives the code from that request id
(`worker/routing.ts`), which means a retried CreateRoom reaches the same object
and gets its cached answer instead of a second room. A Durable Object only
accepts messages for its own code. The local Node server ignores the path.

A Durable Object processes one event at a time and `RoomService` still
serializes each room, so there is no cross-instance locking. Turn resolution
runs inside the object (30 s CPU budget per message), never in the front-door
Worker (10 ms CPU per request on the Free plan).

## First deploy

```sh
npx wrangler login                 # once, opens the Cloudflare dashboard
npm run deploy:rooms               # prints https://roboarena-rooms.<you>.workers.dev
npm run deploy                     # site; see scripts/deploy-site.mjs
```

`NEXT_PUBLIC_ROOM_WS_URL` is baked into the client at build time.
`npm run deploy` defaults it to `wss://roboarena-rooms.manheim.workers.dev`
(`scripts/deploy-site.mjs`); export it to target a different room worker. No secrets are needed: each room keeps its own idempotency
secret in its SQLite.

## Local Cloudflare run

```sh
npm run dev:rooms -- --port 8788                                   # rooms in workerd
NEXT_PUBLIC_ROOM_WS_URL=ws://127.0.0.1:8788 npm run preview:cloudflare  # site in workerd
```

## Free-plan limits that matter

Personal/friends scale fits comfortably. Daily limits reset at 00:00 UTC and
fail closed (nothing is billed on the Free plan).

| Limit                              | Allowance                                       |
| ---------------------------------- | ----------------------------------------------- |
| Durable Object SQLite rows written | 100,000 / day (about 100 four-player matches)   |
| Durable Object requests            | 100,000 / day; 20 WebSocket messages count as 1 |
| Durable Object storage             | 5 GB per account                                |
| Worker requests                    | 100,000 / day; static assets are free           |

See [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing)
and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
