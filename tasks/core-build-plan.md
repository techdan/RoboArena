# RoboArena core build plan

**Status:** canonical execution sequence for the hot-seat Survival MVP.
**Updated:** 2026-07-15.

This file answers one question: **what should be built next, in what order, and
what must be true before moving on?** `docs/spec.md` remains the canonical game
spec, `docs/reverse-engineering.md` remains the evidence record, and
`docs/implementation-plan.md` remains the long-form product roadmap. When their
phase ordering is ambiguous, use this file.

## Current position

Phase 1R and Phase 2 are draft-complete with 109 passing tests. The engine now
has binary-realigned primitives plus a pure, completion-driven turn resolver.
The next engine gate is Phase 3 projectile timing; projectile presentation
timing should receive a focused original-game check before a default is locked.

The immediate critical path is:

```text
RE audit -> Phase 1R engine realignment -> Phase 1.5 toolchain
         -> Phase 2 resolver -> Phase 3 projectile timing
         -> Phase 4 visibility + Scan & Fire -> Phase 5 replay
         -> renderer/setup/planner/end-turn vertical slice
```

Do not build planner or movie UI against the temporary immediate-impact scaffold;
Phase 3 must replace only impact timing while preserving fire-time rolls.

## Confidence policy

Binary-derived work is not all equally complete. Every mechanic entering the
engine must be one of:

- **CONFIRMED:** raw value and runtime meaning are verified; implement directly.
- **MAPPED:** raw table/mechanism is verified, but a label or input mapping is
  unresolved; keep the mapping in one table and mark it `PROVISIONAL RE §20 #N`.
- **PROVISIONAL:** current playtest/design value; isolate it in constants and do
  not describe it as original-game truth.

A provisional value does not automatically block the MVP. It blocks a phase
only when changing it later would alter a public type, event schema, or resolver
architecture. Numeric tuning behind a stable table-shaped interface may proceed.

## Milestone 0 — close the engine-blocking RE questions [COMPLETE / CLASSIFIED]

**Goal:** reduce guesswork before rewriting combat, without turning reverse
engineering into an open-ended side project.

The reproducibility audit and confirmed-value inventory are recorded in
`tasks/reverse-engineering-audit.md`. Run only the focused traces needed by the
next two phases:

1. Trace selector 5..12 -> named weapon for damage roll and cadence
   (RE §20 #1/#10). Raw rows are confirmed; named mapping remains isolated.
2. Decode `seg87:0x1BF8/0x1CE0` far enough to specify cover-class production,
   posture values, and explosive cover cuts. Final mapping is confirmed; exact
   beside-line sampling remains provisional (RE §20 #3).
3. Trace command duration cases for move/deploy/posture/scan and determine
   whether movement really alternates (RE §20 #11/#12/#27).
4. Trace the hard scan-angle gate if it is cheap (RE §20 #22). If not, preserve
   the existing cone as explicitly provisional.

**Timebox:** one focused RE session. If a mapping remains unresolved, record the
working value and proceed through the confidence policy above.

**Exit gate:** all constants needed by Phase 1R and Phase 2 are either CONFIRMED
or isolated and tagged PROVISIONAL. Arena coordinates and Scan & Fire semantics
remain later gates.

## Milestone 1 — Phase 1R: realign engine primitives [DRAFT COMPLETE]

Execute `tasks/engine-realignment-plan.md`, with these work packages:

1. **Foundation:** 60 units/s, 900-unit turn, three postures, terrain metadata,
   robot stats, and selector-driven fire-cost mappings.
2. **Geometry:** floored Euclidean distance for combat/range/blast; retain
   Chebyshev only where an explicitly Chebyshev rule needs it.
3. **Cover/LoS:** a pure, separately tested cover-class calculation. Wall
   blocking and exposed class 4 must not be hidden inside `resolveFire`.
4. **Direct fire:** live-fire score table and formula, aimed-tile occupancy
   penalty, single wide damage roll, and burst-per-bullet resolution.
5. **Blast:** exact category tables and integer posture/cover cuts.
6. **Truth sync:** replace the obsolete sections of `docs/spec.md`, then rewrite
   old-model tests around exact table and seeded-roll assertions.

Avoid one giant rewrite. Keep each work package typechecking and testable; commits
may be smaller than the packages when type migration requires it.

**Exit gate:**

- `npm test`, `npm run typecheck`, and (once available) lint/format are green.
- No BLACK/GREY probability or full/partial bracket logic remains in live fire.
- Firing and blast use floored Euclidean distance.
- Three postures exist end to end.
- Every unresolved mapping points to its RE §20 item.
- `docs/spec.md`, constants, catalogs, and tests describe the same model.

## Milestone 2 — Phase 1.5: enforce the toolchain [COMPLETE]

Land the small toolchain phase before the resolver expands the codebase:

- ESLint flat config with engine nondeterminism bans.
- Prettier and format-check script.
- CI running typecheck, lint, format check, and tests.

Do not add Next.js `dev/build/start` scripts until the Next.js scaffold exists.
Pre-commit hooks remain optional.

**Exit gate:** the four CI checks pass locally and in GitHub Actions; a temporary
`Math.random()` in `src/engine/` is rejected by lint.

## Milestone 3 — Phase 2: deterministic turn resolver core [DRAFT COMPLETE]

Implement the corrected architecture in `tasks/phase2-resolver-design.md`.
Phase 2 owns:

- command validation and scheduling on the 60-unit clock;
- deploy, move, posture, and scan-rotation completion events;
- Aim & Fire using the realigned fire-time roll;
- deterministic same-timestamp ordering and batched damage/death handling;
- immutable `nextState` plus a complete derived event stream.

Phase 2 explicitly does **not** own projectile travel, Scan & Fire, team
visibility, stealth, or replay serialization. Robot movement has no collision:
robots may pass through and stack.

Aim & Fire may apply its pre-rolled result immediately as an internal scaffold.
Name those tests so Phase 3 can replace only the impact-timing behavior.

**Exit gate:** at least the acceptance cases in the resolver design pass,
including stack-on-same-tile, malformed orders, same-time mutual fire, turn-end
boundary, input immutability, and same-input byte equality.

**Result:** implemented in `commandInterpreter.ts` and `resolver.ts`; 23 focused
tests cover all acceptance cases. Imported-order failures are discriminated
`MalformedOrders` results. Phase 2 direct fire is intentionally immediate.

## Milestone 4 — Phase 3: projectile timing and impacts

Add deterministic, integer-scheduled projectile paths. Hit and damage remain
pre-rolled when fire resolves; Phase 3 changes **when the result is displayed
and applied**, not whether a target dodges in flight.

Before choosing timing values, inspect the original's projectile/movie timing.
If exact gameplay timing cannot be derived because flight is cosmetic, choose a
renderer-friendly schedule and label it a RoboArena presentation decision.

**Exit gate:** projectile launch/impact events are stable, blast impacts batch
correctly, and destroying a shooter does not cancel an already launched shot.

## Milestone 5 — Phase 4: visibility and Scan & Fire

First resolve RE §20 #23 with a focused trace or DOS test. Then add:

- per-team visibility and LoS;
- last-known markers;
- Stealth behavior (still provisional unless binary-confirmed);
- Scan & Fire trigger, target selection, cadence, ammo timing, and engagement
  limits.

Keep visibility as a derived engine subsystem, never a renderer calculation.

**Exit gate:** tests cover entering/leaving visibility, multiple simultaneous
Scan & Fire candidates, hidden Stealth robots, and deterministic target choice.

## Milestone 6 — Phase 5: replay contract

The canonical replay input is `{ formatVersion, initialState, seed,
turnOrders[] }`. `ResolutionEvent[]` is the derived movie output, not the sole
replay source of truth. Store an optional event digest for divergence detection.

**Exit gate:** serialize/deserialize/verify round trips; replaying the same input
produces byte-identical state, events, and digest; at least one golden fixture is
checked into tests.

## Milestone 7 — playable vertical slice

After engine/replay stability, follow the product phases in this order:

1. Next.js + Pixi scaffold and one hand-verified Rubble arena.
2. Event-only movie playback.
3. Two-team Quick Start setup.
4. Planner for move/posture/scan.
5. Planner firing controls.
6. Hot-seat handoff, end-turn loop, Team Data, and Survival victory.

Use one arena and preset roster until the complete match loop works. Add more
arenas, roster flexibility, art polish, and online play only after that slice is
playable end to end.

## Deferred gates (do not block current work)

- Arena coordinate reconciliation and Dock/Home metadata: required before the
  first real arena in the renderer, not before the resolver.
- Exact Scan & Fire behavior: required at Phase 4, not Phase 2.
- Other sports, formations, AI, extra weapons, online lobby, onboarding, audio,
  mobile, and production infrastructure: post-MVP or explicitly later phases.

## Next actions

1. Run a focused original-game projectile/movie timing check and classify
   gameplay timing versus cosmetic presentation timing.
2. Implement Phase 3 projectile launch, travel, impact, and blast scheduling
   without rerolling fire-time outcomes.
3. Preserve already launched projectiles when their shooter is destroyed and
   batch same-boundary impacts deterministically.
4. Then resolve Scan & Fire semantics before beginning Phase 4 visibility.
