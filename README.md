# RoboArena

A modern web-based take on the 1991 Maxis tactical game *RoboSport*. Two to
four internet-connected players privately program robot teams, then watch the
simultaneous resolution as a movie. Inspired by but not affiliated with the
original.

**Status**: deterministic engine/replay work, the Next.js/PixiJS renderer,
event-driven movie playback, local authoritative room/setup flow, and the
movement/posture/scan/firing planner are built. The external WSS/restart hosting gate
remains open alongside continued local phases. v1 targets online
free-for-all Survival. See
`docs/implementation-plan.md` for the roadmap.

## Stack

- TypeScript strict mode
- Next.js 16 + React 19 + Tailwind v4
- PixiJS 8 terrain/movie renderer + GSAP presentation effects
- Vitest 4 unit tests + Playwright visual smoke test
- Long-lived WebSocket room service; SQLite local/test storage with Supabase
  Postgres as the production target

## Quick start

```sh
npm install
npm run dev
npm run dev:server       # second terminal; ws://localhost:3001
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run test:room        # four-browser room + planner flow
```

## Repository layout

```
docs/
  spec.md                 CANONICAL game spec (rules + numbers; read this first)
  implementation-plan.md  phased execution roadmap
  priority-tests.md       empirical research log (Match 1-7)
  empirical-tests.md      broader test catalog
  initial-plan.md         HISTORICAL — superseded by spec.md
  archive/                pre-empirical-research docs (superseded)
src/engine/               pure-TS deterministic simulation and replay codec
src/app/                  Next.js routes (`/`, `/room/:code`, `/match/:id/edit`, `/preview`, `/movie/demo`)
src/planner/              deterministic pathfinding, command timing, history, draft state
src/lib/arenas/           verified generated Rubble Two/Three data
src/renderer/             client-only PixiJS arena and movie boundary
public/assets/terrain/    original RoboArena SVG terrain art
server/                   v1 authoritative room service and storage adapters
references/               source matrix, screenshot index
screenshots/              gitignored local original-game research captures
RoboSport (1991)/         gitignored — original DOS distribution, local research only
```

## Key design facts

- **Deterministic engine**: every probabilistic decision goes through a seedable RNG. `Math.random()` and `Date.now()` are forbidden inside `src/engine/`.
- **Replay format**: `{ initialState, turns: { seed, orders }[] }` re-runs to a
  byte-identical event stream on any machine.
- **No robot-vs-robot collision**: robots pass through each other; bullets only hit the target tile.
- **v1 roster**: four non-Stealth combat classes, three postures, Survival, the
  verified Rubble arenas, and 2-4 unique-Side players.

For the full mechanic spec including live-fire scoring, the inclusive scan gate,
cover classes, and terrain effects, see **[`docs/spec.md`](docs/spec.md)**.

## v1 scope

Two to four humans on separate internet-connected devices join a room. Each
controls one Team on a unique Side, so supported configurations are 1v1,
1v1v1, and 1v1v1v1. The server stores submitted turns durably and resolves them
authoritatively; players may leave after submitting and return later to watch
and plan. Survival only, desktop mouse + keyboard, no AI. Hot-seat,
alliance/team modes, Stealth, other
sports, mobile/touch, accounts, and production-scale operations are post-v1.

## Contributing

This is currently a personal project. The plan in `docs/implementation-plan.md` is structured so any agent or human contributor can pick up a phase cold and execute against the per-phase acceptance criteria.
