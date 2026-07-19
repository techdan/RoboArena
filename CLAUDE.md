# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RoboArena — a modern web-based clone of the 1991 Maxis tactical game
_RoboSport_. Two to four internet-connected players privately program robot
teams, then watch simultaneous resolution as a deterministic movie.

**Main-game scope (Phases 1-12)**: 2-4 humans on separate
internet-connected devices, one Team and unique Side per player, free-for-all
Survival, no AI. Desktop mouse + keyboard and iPad touch in landscape are v1
targets. The v1 server is authoritative
and supports private asynchronous orders, durable leave/return, and restart-safe
resolution. Hot-seat, multiple Teams
per Side/alliances, Stealth, and every non-Survival sport are post-v1 and must
not become dependencies of the playable online FFA path. Personal-scale, not
production-grade.

**Project state**: Phase 1R engine realignment and Phases 2-7 and 9-11.7 are
draft-complete; Phase 8 is locally implemented with 276 passing tests and its
external WSS/two-network hosting gate still open. Phase 1.5 lint/format/CI is
complete and the first GitHub Actions run passed. The 2026-07-15 RE completion
pass closed the **2-4 Team** Survival business-rule audit, including exact slow
movement, damage stagger, Side-based combat/visibility/scoring, arena
orientation/Home slots, and movie FPS. v1 consumes the unique-Side FFA subset;
three-/four-player online integration remains the Phase 11.6 gate, while
alliance behavior is retained for v2. Phase 11.5 explainability, observed replay
inspection, and Pointer Events-based iPad input are draft-complete. Automated
Playwright execution is temporarily disabled in favor of manual browser/iPad
checks and user-provided screenshots; the physical
iPad Safari smoke match and the independent Phase 8 production-hosting closure
are now consolidated in the Phase 12 v1 ship gate. See
`tasks/core-build-plan.md` and `docs/implementation-plan.md`.

## Commands

```bash
npm test               # Run all unit tests (currently 236 tests)
npm run test:watch     # Vitest in watch mode
npm run typecheck      # tsc --noEmit; strict mode
npm run lint           # ESLint + engine nondeterminism bans
npm run format:check   # Prettier verification
npx vitest run path/to/file.test.ts    # Single test file
npx vitest run -t "floored Euclidean"  # Tests matching a name
```

`dev`, `build`, and `start` run the Next.js application. Playwright specs are
retained but their package scripts and CI job are temporarily disabled; use
manual browser/iPad checks and screenshots for UI validation.

## Architecture

The codebase is in two distinct phases of completion:

**`src/engine/` (Phases 2-5 draft-complete)** — pure-TypeScript deterministic
simulation realigned to the audited binary structures above, plus immutable
turn scheduling, command validation, combat/visibility resolution, and replay
verification.
Confirmed named weapon cadence/accuracy mappings are centralized in
`catalog.ts`; confirmed movement/action costs remain in `constants.ts`.
Every probabilistic decision goes through a seedable RNG (`createRng(seed)`).

**Phase 3 (draft-complete)** — named missile/grenade blast dispatch, finite
explosive ammo, and deterministic fire-boundary launch/impact cues.

**Phase 4 (draft-complete)** — per-Team ordinary visibility, visibility
transitions/last-known markers, and Scan & Fire acquisition, cooldown, ammo,
scan-sight strength, and fire-time result locking. Stealth remains deferred.

**Phase 5 (draft-complete)** — versioned replay recording, JSON transport,
byte-level event/state verification, deterministic digests, and a checked-in
v1 golden replay.

**Phase 6 (draft-complete)** — Next.js/React/Tailwind shell, client-only PixiJS
terrain renderer, source-locked Rubble Two/Three arena library, and production
visual regression smoke test.

**Phase 7 (draft-complete)** — pure deterministic movie snapshots, PixiJS/GSAP
robot and effect presentation, playback transport/scrub/speed/idle controls,
and a production visual regression test.

**Phase 8 (locally complete; hosting gate open)** — versioned room protocol,
hashed anonymous seat ownership, reconnecting long-lived WebSockets, SQLite WAL
local/test persistence, 2-4 player setup/start UI, and four-browser integration
coverage. Production targets Vercel for Next.js, Supabase Postgres for durable
storage, and a separate long-lived host for the room service; the Postgres
adapter/migrations and external deployment check remain open.

**Phase 9 (draft-complete)** — authenticated canonical setup snapshot, private
versioned/reload-safe drafts with explicit prior-turn recovery, deterministic
tick-cost A*, exact single/double route chunking and per-selector multi-robot
preview, direct legal-prefix editing, posture/scan tools, and bounded undo/redo.

**Phase 10 (draft-complete)** — Aim & Fire, repeat-fire shortcut, Scan & Fire,
inclusive scan-gate overlay, exact score-table estimates from authorized facts,
and terminal repeat-fire timing without consuming authoritative RNG.

**Phase 11 (draft-complete)** — durable private drafts and locks, persisted
seed/nonce recovery, exact-once deterministic resolution, participant-specific
state/events with visibility-boundary contact materialization and unseen-source
redaction, bounded WebSocket payload/rate handling, participant-specific recent
room status, independent movie acknowledgement and playback resume, Final
Ceremony scoring, and canonical Phase 5 replay storage/verification.

**Phase 11.5-11.7 (draft-complete)** — typed Robots/Terrain/Actions Field Guide,
contextual help dialogs, first-use guidance, authorized event filters/export,
Pointer Events-based iPad planner/movie controls, high-resolution planner robot
sprites, honest timeline projection, targeting overlays, and planner camera
controls. Retained Playwright specs/baselines are not part of automated
validation; UI review is currently manual.

**Everything after Phase 11.7** — Phase 11.6's remaining real-session gate is
followed by the Phase 12 production, resilience, real-network, and
physical-iPad v1 ship gate. Phase 13 polishes and enhances the core battle game;
Phase 13.5 then adds online alliances before Stealth or additional sports, while
Phase 16 keeps hot-seat/local-device work last.
Architecture is sketched in `docs/implementation-plan.md` §1.

### Hard rules for `src/engine/`

These are not stylistic preferences — they are the determinism contract. The engine spec depends on them:

- **No `Math.random()`** — use the `Rng` from `rng.ts`. Phase 1.5 lands an ESLint rule that enforces this in CI.
- **No `Date.now()`, `performance.now()`, `setTimeout`, `setInterval`** — engine has no concept of wall-clock time, only ticks.
- **No imports from `src/app/`, `src/components/`, `src/renderer/`, `src/planner/`** — engine is one-way-dependency. UI imports engine, not the other way.
- **Integer arithmetic on game-state values** where possible. Distances and damage are integers. Projectile travel is renderer-only interpolation; the engine stores no authoritative mid-flight projectile position.
- **Pure functions everywhere**: engine modules return new state, never mutate inputs.

Match 1-7 empirical observations are codified into `constants.ts`. Don't change those numbers without updating `docs/spec.md` — they are coupled.

## Where things live

```
docs/
  spec.md                  CANONICAL game spec (rules + numbers; current truth)
  implementation-plan.md   long execution roadmap with per-phase acceptance criteria
  priority-tests.md        empirical research log (Match 1-7 results inform engine constants)
  empirical-tests.md       broader test catalog
  initial-plan.md          HISTORICAL — original planning log; superseded by spec.md
  archive/                 pre-empirical-research docs (superseded; kept for provenance)
src/engine/                pure-TS simulation (Phase 1 draft; realign before resolver)
tasks/core-build-plan.md    canonical near-term execution order and phase gates
references/                source matrix mapping mechanics → evidence
RoboSport (1991)/          gitignored — original DOS distribution; local research
                           only (screenshots/ research captures live inside it)
```

When working on an engine numerical value: **`src/engine/constants.ts` and `src/engine/catalog.ts` are the literal source of truth.** `docs/spec.md` documents what's there. If they disagree, the code wins and the spec gets updated to match.

## Documentation conventions

- Each `src/engine/*.ts` file has a top-of-file JSDoc block citing the spec section it implements.
- Locked numerical constants live in `constants.ts` with comments tying them to empirical-test sources (Match N).
- High-level design lives in `docs/`. Module-level docs stay in source.
- When closing a gap or shipping a phase, update `docs/implementation-plan.md` to mark the phase status (✅ DRAFT COMPLETE / 🟡 IN PROGRESS / ⬜ NOT STARTED / ⏸ DEFERRED).

## Workflow

**Trunk-based commits** for now (PR-based later when multi-agent review starts). Frequent, focused commits to `main`. Never amend commits or force-push.

Commit messages: short imperative subject; body explains _why_ + lists tests added. Use a HEREDOC for multi-line; use `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` when AI-paired.

## Scope discipline

This is a "fun game with friends" project, not a production-grade SaaS. Many things that look like obvious gaps are explicit non-goals — they're deferred in `docs/implementation-plan.md` §14:

- Accessibility basics in v1: keyboard-reachable controls, focus states,
  readable/non-color-only status, and complete iPad touch gameplay; full board
  screen-reader support remains later
- v1 security is bounded but real: schema/order validation, ownership checks,
  hidden-state filtering, payload limits, and basic rate limits
- No production observability (Sentry, metrics, alerts)
- No internationalization, no analytics, no cookie banner, no license/legal text
- No AI players
- Online free-for-all rooms are v1; online alliance/team modes arrive in Phase
  13.5 and hot-seat/local-device modes remain last in Phase 16
- No phone UI or native mobile/tablet app; browser-based iPadOS Safari in
  landscape is supported in v1
- No account system; an opaque server-issued token restores one room seat
- No Stealth or non-Survival sport implementation before the complete online
  free-for-all Survival v1 gate

Don't surface these as gaps unless something has changed about scope.

## Stack

- TypeScript 5.6 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`, ESM)
- Vitest 4.1 for tests
- Phase 6+: Next.js 16 + React 19 + Tailwind v4 + PixiJS + GSAP; Zustand remains planned
- Phase 8+: Vercel-hosted Next.js, a separately hosted long-lived WebSocket room
  service, Supabase Postgres in production, and SQLite only for local/test use;
  multi-process room distribution and accounts remain post-v1

Parent project `C:\src\DevProjects\CLAUDE.md` adds rules across the workspace (e.g. all clickable elements get `cursor-pointer`, prefer Server Components by default).
