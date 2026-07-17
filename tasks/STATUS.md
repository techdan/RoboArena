# Project status — onboarding for the next agent

**Updated:** 2026-07-16. Read this first, then the doc map below.

## TL;DR — you are here

RoboArena is a web clone of Maxis _RoboSport_ (1991). We reverse-engineered the
original `ROBO.EXE` to recover the combat/gameplay model and raw tables, and
documented it in `docs/reverse-engineering.md` (the RE doc). A reproducibility
review is in `tasks/reverse-engineering-audit.md`: the v1 combat tables,
formerly provisional mappings, exact slow movement, and all **2-4 Team**
Survival business-rule gaps are confirmed. **Phase 1R is now in
draft-complete:** the engine foundation, distance, three postures, cover table,
live-fire scoring/damage, and blast tables have been realigned and verified.
Phase 2 is also draft-complete: the engine now resolves immutable programmed
turns with command validation, exact completion boundaries, stable event order,
stacking movement, and batched immediate direct fire.

Use `tasks/core-build-plan.md` as the coherent execution order. Phases 3-7 and 9
are draft-complete; Phase 8 is locally implemented with its deployed
WSS/two-network restart gate still open.
Visual projectile travel timing is
renderer tuning. Stealth and all non-Survival sport logic are post-main-game
Phases 14/15 and cannot enter the v1 critical path. v1 is now internet-first
free-for-all: 2-4 separate devices, one Team and unique Side per player.
Three-/four-player online integration remains Phase 11.6. Alliance
visibility/combat/scoring and explicit Home-slot rules are traced but alliance
and hot-seat product paths are deliberately deferred to v2.

**Critical correction:** descriptor byte 0 is encoded command-record length,
not a direct/explosive category. Named selectors, 30/40 movement, 120 deploy,
10 posture, 5 scan-heading, the inclusive cone edge, and endpoint-cover samples
are exact for the version-locked binary.

## Repo state

- Branch `main`; trunk-based phase checkpoints continue.
- Phase 8 room/setup is locally verified; its Vercel frontend + external WSS
  service + Supabase Postgres deployment gate remains open.
- The last recorded remote CI gate passed; run local gates for each checkpoint.

## Phase state

| Phase                                           | State                                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 — engine primitives                     | ✅ original skeleton superseded by Phase 1R                                                                                                                            |
| **Reverse-engineering the original**            | ✅ **complete & committed** — `docs/reverse-engineering.md` (21 sections) + `tools/re/`                                                                                |
| **RE implementation audit**                     | ✅ 44 claim groups verified; deferred labels/content isolated in `tasks/reverse-engineering-audit.md`                                                                  |
| **Engine realignment to binary truth**          | ✅ **DRAFT COMPLETE** — RE verifier checks 44 independent claim groups, including all 77 descriptor rows                                                               |
| Phase 1.5 — toolchain                           | ✅ **COMPLETE** — local checks and GitHub Actions pass                                                                                                                 |
| Phase 2 — turn resolver                         | ✅ **DRAFT COMPLETE** — exact slow-terrain validation and Survival audit added                                                                                         |
| Phase 3 — projectile/blast events               | ✅ **DRAFT COMPLETE** — named missile/grenade blast dispatch, finite ammo, stable launch/impact cues; 149 engine tests total                                           |
| Phase 4 — visibility / Scan & Fire              | ✅ **DRAFT COMPLETE** — per-Team contacts, last-known markers, exact scan-sight strength, deterministic acquisition/cooldown/ammo                                      |
| Phase 5 — replay contract                       | ✅ **DRAFT COMPLETE** — per-turn seeds, strict versioned JSON validation, deterministic recorder/verifier, state/event digests, v1 golden fixture                      |
| Phase 6 — arena renderer                        | ✅ **DRAFT COMPLETE** — Next.js 16/React 19/Tailwind shell, client-only PixiJS, verified 24×24 and 32×32 Rubble imports, production visual baseline; 188 tests total   |
| Phase 7 — movie playback                        | ✅ **DRAFT COMPLETE** — deterministic snapshots, PixiJS/GSAP robots and effects, full transport/scrub/speed/idle controls, production visual baseline; 198 tests total |
| Phase 8 — authoritative rooms                   | 🟨 **LOCALLY COMPLETE / HOSTING GATE OPEN** — strict v1 protocol, hashed rejoin ownership, reconnect/idempotency recovery, SQLite local/test storage, four-browser setup/start flow; Supabase Postgres adapter and external deployment remain open |
| Phase 9 — movement/posture/scan planner         | ✅ **DRAFT COMPLETE** — authenticated match snapshot, tick-cost A*, exact per-selector preview, versioned conflict recovery, direct legal-prefix editing, undo/redo; 224 tests total |
| Assets (terrain + robots + effects)             | ✅ **SHIPPED & INTEGRATED** (2026-07-16) — Foundry Plate production set: 5 classes × 3 postures + turrets (generated), 11 effects, 3 markers; movie renderer consumes them with per-team paint recolor. Contract: `docs/asset-manifest.md`; regenerate robots via `scripts/generate-robot-assets.mjs` |
| Phases 10–13 (firing/turn loop/polish)          | ⬜ Phase 10 is next; Phase 11.6 is the 3-/4-player online FFA gate; Phase 12 hot-seat/alliances is post-v1                                                               |
| Phase 14 Stealth / Phase 15 non-Survival sports | ⏸ post-v1; hard-gated on shipped online FFA Survival                                                                                                                   |

## What the RE pass established (all in `docs/reverse-engineering.md`)

**Confirmed-exact:** RNG (dual-stream LFSR — we keep mulberry32), distance =
floored Euclidean (not Chebyshev), robot armor/accuracy table (`0x0CA8`), the
live-fire hit table (`0x156E`) + score formula, bullet damage (wide roll +
posture/distance adjust — no full/partial brackets), explosive blast tables,
terrain properties + all 24 arenas, **clock = 60 units/s** (not 20), reachable
named Aim/Scan fire selectors and intervals, fixed 30/40 movement, 120 deploy,
10 posture, 5 scan heading, cover = height-based endpoint sampling, and
moving-target = off-aimed-tile halves the hit.

**Answered design questions:** 3 postures form a mobility⇄cover dial (Ducking is
meaningful — keep all 3) and their final cover table is decoded; all 5 sport
modes + 5 bots are identified. Main game uses the four non-Stealth classes;
Stealth needs Custom Game and is deliberately deferred.

**The master list of everything still assumed/TBD is RE §20** — 29 tracked
items, including resolved rows for audit history. Remaining v1-adjacent research
contains no open **2-4 Team** Survival business-rule blocker. Arena terrain is
row-major; Home rectangles use exact generated spans; Dock is off-field; movie
default is 12 fps. The v1 implementation uses unique-Side FFA only; audited
alliance semantics move to v2 and other deferred rows are later parity content.

## Document map

| Need                                                        | File                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| **Binary-derived truth + offset map**                       | `docs/reverse-engineering.md` (RE) — §20 = master TBD list         |
| Canonical v1 spec (realigned mechanics + confidence labels) | `docs/spec.md`                                                     |
| Engine realignment record                                   | `tasks/engine-realignment-plan.md` (8 steps, numbers transcribed)  |
| **Canonical execution sequence**                            | `tasks/core-build-plan.md`                                         |
| RE reproducibility/confidence audit                         | `tasks/reverse-engineering-audit.md`                               |
| Resolver architecture (Phase 2)                             | `tasks/phase2-resolver-design.md`                                  |
| Corrections we've been given                                | `tasks/lessons.md` (e.g. body color = team, not class)             |
| 15-phase roadmap                                            | `docs/implementation-plan.md`                                      |
| Post-parity design alternatives and timing analysis         | `docs/design-improvements.md`                                      |
| RE extraction scripts (need `pip install iced-x86`)         | `tools/re/*.py`                                                    |
| Machine-readable extracted tables (git-ignored, regenerate) | `docs/extracted/robosport-data.json` via `tools/re/export_data.py` |

## Conventions (from `CLAUDE.md`)

- Engine stays pure TS: no `Math.random`, no wall-clock, integer game-state math,
  pure functions, one-way dependency (UI imports engine, never reverse).
- Trunk-based commits to `main`; frequent focused commits; never amend/force-push.
- Original game + machine-derived extracts (`docs/extracted/`, decoded sprites)
  are git-ignored — copyrighted Maxis material, local research only.
- When a constant is provisional, tag it `// PROVISIONAL RE §20 #N`.
