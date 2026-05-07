# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RoboArena — a modern web-based clone of the 1991 Maxis tactical game *RoboSport*. Two players program teams of robots, then watch the simultaneous resolution as a deterministic movie.

**v1 scope**: human-vs-human only (hot-seat + online lobby), no AI. Survival sport mode. Desktop-only (mouse + keyboard). Personal-scale, not production-grade — see "Scope discipline" below.

**Project state**: Phase 1 (engine primitives) draft complete with 75 passing tests. Phase 1.5 (toolchain) is the next phase. The full 14-phase plan is in `docs/implementation-plan.md`.

## Commands

```bash
npm test               # Run all engine unit tests (75 tests)
npm run test:watch     # Vitest in watch mode
npm run typecheck      # tsc --noEmit; strict mode
npx vitest run path/to/file.test.ts    # Single test file
npx vitest run -t "BLACK zone"         # Tests matching a name
```

Lint, format, dev server, and build scripts land in Phase 1.5 — not yet wired.

## Architecture

The codebase is in two distinct phases of completion:

**`src/engine/` (Phase 1, complete)** — pure-TypeScript deterministic simulation. No React, no DOM, no I/O. Layered: `constants.ts` → `types.ts` → primitives (`rng`, `geometry`, `movement`, `firing`, `blast`, `catalog`) → `index.ts`. Every probabilistic decision goes through a seedable RNG (`createRng(seed)`); replays = `{ initialState, seed, turnOrders[] }` re-run to byte-identical events.

**Everything else (Phases 2-13, not yet built)** — turn resolver, projectiles, visibility, replay format, Next.js + PixiJS UI, planner, online lobby. Architecture sketched in `docs/implementation-plan.md` §1, repository layout in §2.

### Hard rules for `src/engine/`

These are not stylistic preferences — they are the determinism contract. The engine spec depends on them:

- **No `Math.random()`** — use the `Rng` from `rng.ts`. Phase 1.5 lands an ESLint rule that enforces this in CI.
- **No `Date.now()`, `performance.now()`, `setTimeout`, `setInterval`** — engine has no concept of wall-clock time, only ticks.
- **No imports from `src/app/`, `src/components/`, `src/renderer/`, `src/planner/`** — engine is one-way-dependency. UI imports engine, not the other way.
- **Integer arithmetic on game-state values** where possible. Distances and damage are integers. Projectile mid-flight uses tile-by-tile schedules, never floats.
- **Pure functions everywhere**: engine modules return new state, never mutate inputs.

Match 1-7 empirical observations are codified into `constants.ts`. Don't change those numbers without updating `docs/initial-plan.md` §"Engine constants" — they are coupled.

## Where things live

```
docs/
  spec.md                  CANONICAL game spec (rules + numbers; current truth)
  implementation-plan.md   14-phase execution roadmap with per-phase acceptance criteria
  priority-tests.md        empirical research log (Match 1-7 results inform engine constants)
  empirical-tests.md       broader test catalog
  manual.txt               partial Amiga manual (provenance noted in §14 risks)
  initial-plan.md          HISTORICAL — original planning log; superseded by spec.md
  archive/                 pre-empirical-research docs (superseded; kept for provenance)
src/engine/                pure-TS simulation (Phase 1 complete)
screenshots/               DOS reference captures for UI/mechanics
references/                source matrix mapping mechanics → evidence
RoboSport (1991)/          gitignored — original DOS distribution; local research only
```

When working on an engine numerical value: **`src/engine/constants.ts` and `src/engine/catalog.ts` are the literal source of truth.** `docs/spec.md` documents what's there. If they disagree, the code wins and the spec gets updated to match.

## Documentation conventions

- Each `src/engine/*.ts` file has a top-of-file JSDoc block citing the spec section it implements.
- Locked numerical constants live in `constants.ts` with comments tying them to empirical-test sources (Match N).
- High-level design lives in `docs/`. Module-level docs stay in source.
- When closing a gap or shipping a phase, update `docs/implementation-plan.md` to mark the phase status (✅ DRAFT COMPLETE / 🟡 IN PROGRESS / ⬜ NOT STARTED / ⏸ DEFERRED).

## Workflow

**Trunk-based commits** for now (PR-based later when multi-agent review starts). Frequent, focused commits to `main`. Never amend commits or force-push.

Commit messages: short imperative subject; body explains *why* + lists tests added. Use a HEREDOC for multi-line; use `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` when AI-paired.

## Scope discipline

This is a "fun game with friends" project, not a production-grade SaaS. Many things that look like obvious gaps are explicit non-goals — they're deferred in `docs/implementation-plan.md` §14:

- No accessibility work in v1
- No security / abuse prevention beyond zod input validation
- No production observability (Sentry, metrics, alerts)
- No internationalization, no analytics, no cookie banner, no license/legal text
- No AI players (Survival vs another human only)
- No mobile / touch / tablet support
- No account system (anonymous browser-token identity)

Don't surface these as gaps unless something has changed about scope.

## Stack

- TypeScript 5.6 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`, ESM)
- Vitest 2.1 for tests
- Phase 6+: Next.js 16 + React 19 + Tailwind v4 + PixiJS + Zustand
- Phase 12: Postgres (local for dev, Supabase eventual) + WebSocket relay

Parent project `C:\src\DevProjects\CLAUDE.md` adds rules across the workspace (e.g. all clickable elements get `cursor-pointer`, prefer Server Components by default).
