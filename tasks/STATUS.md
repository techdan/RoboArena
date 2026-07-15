# Project status — onboarding for the next agent

**Updated:** 2026-07-12. Read this first, then the doc map below.

## TL;DR — you are here

RoboArena is a web clone of Maxis *RoboSport* (1991). We reverse-engineered the
original `ROBO.EXE` to recover the combat/gameplay model and raw tables, and
documented it in `docs/reverse-engineering.md` (the RE doc). A reproducibility
review is in `tasks/reverse-engineering-audit.md`: the core tables are confirmed,
but several name/input mappings remain provisional. **Phase 1R is now in
draft-complete:** the engine foundation, distance, three postures, cover table,
live-fire scoring/damage, and blast tables have been realigned and verified.

Use `tasks/core-build-plan.md` as the coherent execution order. The immediate
sequence is verify the first remote CI run, then implement Phase 2 resolver.
Provisional selector/action mappings remain a focused parallel research track.

**Critical gotcha:** named weapon→selector cadence/accuracy mappings and movement
command timing are still provisional. Do not describe those labels as exact
until the focused trace or DOS differential tests close them.

## Repo state

- Branch `main`; `HEAD` and `origin/main` are aligned as of this update.
- The working tree contains the planning/audit edits described in the current
  task until they are committed.
- Recent commits: `c7b1218` RE doc + toolchain · `94b525f` engine-realignment
  plan + lessons · `488c3f7` terrain + robot art candidates · `0004157` Phase 2
  resolver design.

## Phase state

| Phase | State |
|---|---|
| Phase 1 — engine primitives | ✅ original skeleton superseded by Phase 1R |
| **Reverse-engineering the original** | ✅ **complete & committed** — `docs/reverse-engineering.md` (21 sections) + `tools/re/` |
| **RE implementation audit** | ✅ raw tables reproduced; remaining mappings classified in `tasks/reverse-engineering-audit.md` |
| **Engine realignment to binary truth** | ✅ **DRAFT COMPLETE** — 86 tests; RE verifier checks 15 independent claims |
| Phase 1.5 — toolchain | ✅ local checks/config complete; first GitHub Actions run pending push |
| Phase 2 — turn resolver | 📋 corrected design ready; **NEXT implementation phase** |
| Assets (terrain + robots) | 🎨 in progress — terrain SVGs done; robot direction = **Foundry Plate** (turret=class, paint=team) |
| Phases 3–13 (projectiles, visibility, UI, planner, online) | ⬜ not started; roadmap in `docs/implementation-plan.md` |

## What the RE pass established (all in `docs/reverse-engineering.md`)

**Confirmed-exact:** RNG (dual-stream LFSR — we keep mulberry32), distance =
floored Euclidean (not Chebyshev), robot armor/accuracy table (`0x0CA8`), the
live-fire hit table (`0x156E`) + score formula, bullet damage (wide roll +
posture/distance adjust — no full/partial brackets), explosive blast tables,
terrain properties + all 10 arenas, **clock = 60 units/s** (not 20), reachable
fire-selector intervals = 10/15/20/30 units (named mapping provisional), cover =
height-based line-of-sight, moving-target = off-aimed-tile halves the hit.

**Answered design questions:** 3 postures form a mobility⇄cover dial (Ducking is
meaningful — keep all 3) and their final cover table is decoded; all 5 sport
modes + 5 bots are identified; bots are build-mode gated (Stealth needs Custom
Game), not sport-mode gated.

**The master list of everything still assumed/TBD is RE §20** — 28 items,
prioritized P1/P2/P3, each with its binary location. Check it before assuming any
constant is final. Top P1 unknowns: whether move cost actually alternates, exact
move/deploy/scan costs, scan-cone width, Scan & Fire trigger,
and arena coordinate reconciliation (§12 — extracted grids don't yet map to
in-game x/y).

## Document map

| Need | File |
|---|---|
| **Binary-derived truth + offset map** | `docs/reverse-engineering.md` (RE) — §20 = master TBD list |
| Canonical v1 spec (realigned mechanics + provisional labels) | `docs/spec.md` |
| **Next task: realign engine** | `tasks/engine-realignment-plan.md` (8 steps, numbers transcribed) |
| **Canonical execution sequence** | `tasks/core-build-plan.md` |
| RE reproducibility/confidence audit | `tasks/reverse-engineering-audit.md` |
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
