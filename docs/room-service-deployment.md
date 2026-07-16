# Phase 8 room-service deployment gate

The authoritative room service is a long-lived Node process, not a serverless
route. Production must provide:

- WebSocket pass-through with TLS termination (`wss://` externally);
- one process owner per room;
- a persistent volume mounted at `/data` for SQLite WAL files;
- ordinary process/deploy restart without replacing that volume;
- `PORT=3001` and `ROOM_DATABASE_PATH=/data/roboarena.sqlite`;
- the web build configured with `NEXT_PUBLIC_ROOM_WS_URL=wss://<room-host>`.

Build the portable service image from the repository root:

```sh
docker build -f deploy/room-service.Dockerfile -t roboarena-room-service .
docker run --rm -p 3001:3001 -v roboarena-room-data:/data roboarena-room-service
```

The platform health check is `GET /health`. Before closing the external gate:

1. Create a room over the deployed `wss://` endpoint from network A.
2. Join from a separate device on network B.
3. Ready both seats and start a match.
4. Restart/redeploy the service without deleting the volume.
5. Reload both browsers and confirm their opaque rejoin tokens restore the same
   player IDs, room, configuration, and match.

Local automated coverage proves the same four-client protocol and SQLite
restart invariants. The real-network/WSS check requires deployment credentials
and two external devices, so its result must be recorded separately rather than
claimed from a local run.
