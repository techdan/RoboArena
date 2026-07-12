# Project status — onboarding for the next agent

**Updated:** 2026-07-12. Read this first, then the doc map below.

## TL;DR — you are here

RoboArena is a web clone of Maxis *RoboSport* (1991). We reverse-engineered the
original `ROBO.EXE` to get the **exact** combat/gameplay logic, and documented it
in `docs/reverse-engineering.md` (the RE doc). The **engine has not yet been
updated to match** — `src/engine/` is still the original Phase-1 model built from
playtest estimates. The single most important next step is executing
`tasks/engine-realignment-plan.md`.

**Critical gotcha:** the live engine (`TICKS_PER_SECOND=20`, Chebyshev distance,
BLACK/GREY hit zones, full/partial damage brackets) is **known-wrong** vs the
binary. Do not build on it. Realign first (plan is written and ready).

## Repo state

- Branch `main`, working tree **clean**. Everything is committed.
- **4 commits ahead of `origin/main` (unpushed)** — push is a separate call; ask
  the user before pushing (public repo).
- Recent commits: `c7b1218` RE doc + toolchain · `94b525f` engine-realignment
  plan + lessons · `488c3f7` terrain + robot art candidates · `0004157` Phase 2
  resolver design.

## Phase state

| Phase | State |
|---|---|
| Phase 1 — engine primitives | ✅ built, 75 tests, but on the **old (playtest) model** — must be realigned |
| **Reverse-engineering the original** | ✅ **complete & committed** — `docs/reverse-engineering.md` (21 sections) + `tools/re/` |
| **Engine realignment to binary truth** | 📋 **planned, NOT executed** — `tasks/engine-realignment-plan.md` (8 steps). ← DO THIS NEXT |
| Phase 2 — turn resolver | 📋 designed (`tasks/phase2-resolver-design.md`), implement AFTER realignment |
| Assets (terrain + robots) | 🎨 in progress — terrain SVGs done; robot direction = **Foundry Plate** (turret=class, paint=team) |
| Phases 3–13 (projectiles, visibility, UI, planner, online) | ⬜ not started; roadmap in `docs/implementation-plan.md` |

## What the RE pass established (all in `docs/reverse-engineering.md`)

**Confirmed-exact:** RNG (dual-stream LFSR — we keep mulberry32), distance =
floored Euclidean (not Chebyshev), robot armor/accuracy table (`0x0CA8`), the
live-fire hit table (`0x156E`) + score formula, bullet damage (wide roll +
posture/distance adjust — no full/partial brackets), explosive blast tables,
terrain properties + all 10 arenas, **clock = 60 units/s** (not 20), **fire
interval = fixed per-weapon** (0.33/0.5 s — not alternating), cover =
height-based line-of-sight, moving-target = off-aimed-tile halves the hit.

**Answered design questions:** 3 postures form a mobility⇄cover dial (Ducking is
meaningful — keep all 3); all 5 sport modes + 5 bots identified; bots are
build-mode gated (Stealth needs Custom Game), not sport-mode gated.

**The master list of everything still assumed/TBD is RE §20** — 28 items,
prioritized P1/P2/P3, each with its binary location. Check it before assuming any
constant is final. Top P1 unknowns: posture height integers, whether move cost
actually alternates (fire "alternation" turned out to be a myth — move may be
fixed too), exact move/deploy/scan costs, scan-cone width, Scan & Fire trigger,
and arena coordinate reconciliation (§12 — extracted grids don't yet map to
in-game x/y).

## Document map

| Need | File |
|---|---|
| **Binary-derived truth + offset map** | `docs/reverse-engineering.md` (RE) — §20 = master TBD list |
| Canonical v1 spec (has "corrections pending" banner → RE) | `docs/spec.md` |
| **Next task: realign engine** | `tasks/engine-realignment-plan.md` (8 steps, numbers transcribed) |
| Resolver architecture (Phase 2) | `tasks/phase2-resolver-design.md` |
| Corrections we've been given | `tasks/lessons.md` (e.g. body color = team, not class) |
| 14-phase roadmap | `docs/implementation-plan.md` |
| RE extraction scripts (need `pip install iced-x86`) | `tools/re/*.py` |
| Machine-readable extracted tables (git-ignored, regenerate) | `docs/extracted/robosport-data.json` via `tools/re/export_data.py` |

## Conventions (from `CLAUDE.md`)

- Engine stays pure TS: no `Math.random`, no wall-clock, integer game-state math,
  pure functions, one-way dependency (UI imports engine, never reverse).
- Trunk-based commits to `main`; frequent focused commits; never amend/force-push.
- Original game + machine-derived extracts (`docs/extracted/`, decoded sprites)
  are git-ignored — copyrighted Maxis material, local research only.
- When a constant is provisional, tag it `// PROVISIONAL RE §20 #N`.
