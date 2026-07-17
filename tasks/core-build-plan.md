# RoboArena core build plan

**Status:** canonical execution sequence for the online free-for-all Survival v1.
**Updated:** 2026-07-16.

This file answers one question: **what should be built next, in what order, and
what must be true before moving on?** `docs/spec.md` remains the canonical game
spec, `docs/reverse-engineering.md` remains the evidence record, and
`docs/implementation-plan.md` remains the long-form product roadmap. When their
phase ordering is ambiguous, use this file.

## Current position

Phases 1R through 7 are draft-complete; Phase 8 is locally implemented with its
deployed WSS/two-network restart gate still open. The engine now
has binary-realigned primitives, a pure completion-driven turn resolver, and
named projectile/blast events, per-Team visibility, Scan & Fire, and versioned
replay recording/verification. The Next.js/PixiJS shell and verified Rubble
arena imports, deterministic local movie playback, and authoritative room/setup
boundary are built. Phase 9 planner work follows the Phase 8 hosting gate. Exact
screen travel duration remains presentation tuning and is not an engine blocker.

The immediate critical path is:

```text
RE audit -> Phase 1R engine realignment -> Phase 1.5 toolchain
         -> Phase 2 resolver -> Phase 3 projectile/blast events
         -> Phase 4 visibility + Scan & Fire -> Phase 5 replay
         -> renderer -> authoritative room/setup -> planner/online turn loop
         -> 3-/4-player FFA hardening -> release polish
```

Phase 3 must preserve fire-time result locking and add deterministic
launch/impact cues without turning renderer travel into gameplay state.

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
`tasks/reverse-engineering-audit.md`. The 2026-07-15 completion pass resolved:

1. selector→named weapon, damage roll, accuracy indices, and Aim/Scan cadence;
2. `seg87:0x1BF8/0x1CE0` endpoint, major-axis, and near-diagonal corner samples;
3. fixed 30/40 movement, 120 deploy, 10 posture, and 5 scan-heading timing;
4. the closed forward semicircle with inclusive perpendicular boundaries.

**Timebox:** one focused RE session. If a mapping remains unresolved, record the
working value and proceed through the confidence policy above.

**Exit gate:** satisfied. All constants needed by Phase 1R/2 are confirmed.
Scan & Fire equal adjusted-distance candidates prefer higher exact scan-grid
sight strength, then canonical candidate order; arena MAP orientation/import is
verified row-major.

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

Phase 2 explicitly does **not** own projectile presentation, Scan & Fire, team
visibility, or replay serialization. Stealth is post-main-game work, not a
Phase 2/4 dependency. Robot movement has no collision:
robots may pass through and stack.

Aim & Fire may apply its pre-rolled result immediately as an internal scaffold.
Name those tests so Phase 3 can replace only the impact-timing behavior.

**Exit gate:** at least the acceptance cases in the resolver design pass,
including stack-on-same-tile, malformed orders, same-time mutual fire, turn-end
boundary, input immutability, and same-input byte equality.

**Result:** implemented in `commandInterpreter.ts` and `resolver.ts`; 33 focused
tests cover all acceptance cases. Imported-order failures are discriminated
`MalformedOrders` results. Phase 2 direct fire is intentionally immediate.

## Milestone 4 — Phase 3: projectile/blast events

Add named missile/grenade blast handling and deterministic launch/impact
presentation events. Hit and damage remain locked and applied at the fire
boundary; later visual travel never rerolls, retargets, or permits dodging.

Choose renderer travel durations in Phase 7. They are deliberately absent from
the engine/replay contract.

**Exit gate:** projectile launch/impact cues are stable, named blast effects
batch correctly, and destroying a shooter after fire does not cancel the locked
result.

## Milestone 5 — Phase 4: visibility and Scan & Fire

The static trace closes RE §20 #23's architecture: evaluate/acquire at the
scheduled command tick, reacquire after each named repeat interval, filter by
player maximum distance, choose nearest adjusted-distance candidate, decrement
ammo at fire, and lock the aimed tile/result at fire time. Implement:

- per-team visibility and LoS;
- last-known markers;
- Scan & Fire target filtering/reacquisition, deterministic tie-breaking,
  confirmed cadence/ammo timing, and engagement limits.

Keep visibility as a derived engine subsystem, never a renderer calculation.

**Exit gate:** tests cover entering/leaving visibility, multiple simultaneous
Scan & Fire candidates, ordinary visibility transitions, and deterministic
target choice. Do not add Stealth cases here.

## Milestone 6 — Phase 5: replay contract

The canonical replay input is `{ formatVersion, initialState, turns: { seed,
orders }[] }`. `ResolutionEvent[]` is the derived movie output, not the sole
replay source of truth. Each authoritative turn seed is stored with its orders.
Version 1 retains derived events for playback and exact comparison plus required
event and next-state digests for divergence detection.

**Exit gate:** serialize/deserialize/verify round trips; replaying the same input
produces byte-identical state, events, and digest; at least one golden fixture is
checked into tests.

## Milestone 7 — online playable vertical slice

After engine/replay stability, follow the product phases in this order:

1. Next.js + Pixi scaffold and one verified row-major imported Rubble arena.
2. Event-only movie playback.
3. Durable authoritative WebSocket room foundation, restart-safe async state,
   and 2-4 player unique-Side setup.
4. Planner for move/posture/scan with exact timing and undo/redo.
5. Planner firing controls with authorized conditional previews.
6. Private lock/readiness, leave-and-return submission, exactly-once server
   resolution, unseen-turn playback, Team Data, explanations, replay, and
   Survival victory.
7. Three-/four-player FFA integration plus multi-browser/network ship tests.

Use one arena and preset roster until the complete online match loop works.
Networking is part of the foundation, not a transport retrofit. Add more arenas,
roster flexibility, and art polish only after the two-player internet slice is
playable end to end.

## Deferred gates (do not block current work)

- Arena import review is required before the first renderer arena. Terrain is
  row-major; homes use exact generated spans; Dock is off-field state.
- Exact Scan & Fire behavior: required at Phase 4, not Phase 2.
- Hot-seat and multiple Teams per Side/alliance modes are post-v1 Phase 12.
- Stealth is Phase 14 and all non-Survival sports are Phase 15. Both are hard
  gated on the complete online FFA Survival v1.
- Other formations, AI, extra weapons, full help/tutorial, audio, mobile, and
  production-scale infrastructure are post-v1 or explicitly later phases.

## Next actions

1. Implement the Supabase Postgres storage adapter/migrations, then deploy the
   Vercel frontend and external long-lived room service and verify WSS, restart
   recovery, and rejoin ownership from two real networks/devices.
2. Begin Phase 9 planner work only after that external gate passes.
