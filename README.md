# RoboArena

A modern web-based take on the 1991 Maxis tactical game *RoboSport*. Two players program teams of robots, then watch the simultaneous resolution as a movie. Inspired by but not affiliated with the original.

**Status**: pre-implementation — engine primitives exist, UI not yet built. See `docs/implementation-plan.md` for the roadmap.

## Stack

- TypeScript strict mode
- Next.js 16 + React 19 + Tailwind v4 (UI, not yet scaffolded)
- PixiJS (renderer, not yet scaffolded)
- Vitest (engine tests)
- Postgres for shared persistence (Supabase eventually; local Postgres for dev)

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

# Connect to a local Postgres instance
echo "DATABASE_URL=postgres://postgres:postgres@localhost:5432/roboarena" > .env.local
psql -f db/migrations/001_init.sql
```

## Repository layout

```
docs/                 spec, plans, research log
  initial-plan.md     canonical engine constants & combat spec
  implementation-plan.md   13-phase execution roadmap
  priority-tests.md   empirical research log (Match 1-7)
  manual.txt          partial Amiga manual (provenance TBD; see §14 risks)
src/engine/           pure-TS deterministic simulation (Phase 1, complete)
src/                  (everything else lands in Phases 2-13)
screenshots/          DOS reference captures
references/           source matrix, screenshot index
RoboSport (1991)/     gitignored — original DOS distribution, local research only
```

## Key design facts

- **Deterministic engine**: every probabilistic decision goes through a seedable RNG. `Math.random()` and `Date.now()` are forbidden inside `src/engine/`.
- **Replay format**: `{ initialState, seed, turnOrders[] }` re-runs to a byte-identical event stream on any machine.
- **No robot-vs-robot collision**: robots pass through each other; bullets only hit the target tile.
- **5 robot classes** (Rifle / Burst / Auto / Missile / Stealth), **5 weapons**, **3 arena types** (Rubble / Suburbs / Computer), **4 game lengths** (Skirmish / Melee / Battle / Campaign).

For the full mechanic spec including damage brackets, scan-cone hit chance, cover model, and terrain effects, see `docs/initial-plan.md` §"Engine constants — v1 canonical stats".

## v1 scope

Human-vs-human only (hot-seat + online lobby), no AI. Survival sport mode. Desktop-only, mouse + keyboard. Other modes / AI / mobile / accessibility / production-grade ops are post-v1.

## Contributing

This is currently a personal project. The plan in `docs/implementation-plan.md` is structured so any agent or human contributor can pick up a phase cold and execute against the per-phase acceptance criteria.
