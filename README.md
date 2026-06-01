# RoboArena

A modern web-based take on the 1991 Maxis tactical game *RoboSport*. Two players program teams of robots, then watch the simultaneous resolution as a movie. Inspired by but not affiliated with the original.

**Status**: pre-implementation — engine primitives exist, UI not yet built. v1 targets hot-seat Survival first. See `docs/implementation-plan.md` for the roadmap.

## Stack

- TypeScript strict mode
- Next.js 16 + React 19 + Tailwind v4 (UI, not yet scaffolded)
- PixiJS (renderer, not yet scaffolded)
- Vitest (engine tests)
- Post-MVP shared persistence: Postgres / Supabase

## Quick start

```sh
npm install
npm test         # 75 engine tests, all passing
npm run typecheck
```

Once Phase 6 lands:

```sh
# Local dev with hot reload
npm run dev
```

## Repository layout

```
docs/
  spec.md                 CANONICAL game spec (rules + numbers; read this first)
  implementation-plan.md  14-phase execution roadmap
  priority-tests.md       empirical research log (Match 1-7)
  empirical-tests.md      broader test catalog
  initial-plan.md         HISTORICAL — superseded by spec.md
  archive/                pre-empirical-research docs (superseded)
src/engine/               pure-TS deterministic simulation (Phase 1, complete)
src/                      (everything else lands in Phases 2-13)
references/               source matrix, screenshot index
screenshots/              gitignored local original-game research captures
RoboSport (1991)/         gitignored — original DOS distribution, local research only
```

## Key design facts

- **Deterministic engine**: every probabilistic decision goes through a seedable RNG. `Math.random()` and `Date.now()` are forbidden inside `src/engine/`.
- **Replay format**: `{ initialState, seed, turnOrders[] }` re-runs to a byte-identical event stream on any machine.
- **No robot-vs-robot collision**: robots pass through each other; bullets only hit the target tile.
- **5 robot classes** (Rifle / Burst / Auto / Missile / Stealth), **5 weapons**, **3 arena types** (Rubble / Suburbs / Computer), **4 game lengths** (Skirmish / Melee / Battle / Campaign).

For the full mechanic spec including damage brackets, scan-cone hit chance, cover model, and terrain effects: **[`docs/spec.md`](docs/spec.md)**.

## v1 scope

Human-vs-human hot-seat only, no AI. Survival sport mode. Desktop-only, mouse + keyboard. Online lobby, other modes, AI, mobile, accessibility, and production-grade ops are post-v1.

## Contributing

This is currently a personal project. The plan in `docs/implementation-plan.md` is structured so any agent or human contributor can pick up a phase cold and execute against the per-phase acceptance criteria.
