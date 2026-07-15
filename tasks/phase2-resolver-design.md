# Phase 2 turn resolver — design record

**Status:** draft-complete 2026-07-15. Implemented after Phase 1R engine
realignment and Phase 1.5 tooling. Acceptance sequencing lives in
`tasks/core-build-plan.md`.

## Scope

Phase 2 consumes `{ state, orders, seed }`, resolves one programmed turn, and
returns immutable `{ nextState, events }`.

It includes command validation/scheduling, deployment, movement, posture, scan
rotation, and an Aim & Fire scaffold using the realigned fire-time hit/damage
roll. It excludes projectile travel/impact timing (Phase 3), Scan & Fire,
visibility/Stealth (Phase 4), and replay serialization (Phase 5).

## Clock and command model

The resolver is a deterministic discrete-event simulation on integer time
boundaries `0..TURN_DURATION_UNITS` (0 through 900 for a 15-second turn).
Commands start at a boundary and complete after their integer duration. A
command completing at boundary 900 is allowed; no command may start there.

Each robot owns a command queue and runtime cursor:

```ts
interface RobotProgramCursor {
  readonly robotId: string;
  readonly segmentIndex: number;
  readonly startedAt: number;
  readonly completesAt: number;
}
```

Do not recompute the active command by scanning the whole timeline every tick.
Schedule the next completion when a segment starts. A simple boundary loop is
acceptable for v1 because 901 boundaries is small, but state transitions must
still be completion-driven.

## Same-boundary order

At each boundary:

1. Gather command completions due now from a boundary-start snapshot.
2. Apply deploy/move completions in canonical actor order.
3. Apply posture and scan-rotation completions in canonical actor order.
4. Resolve all Aim & Fire completions against the settled positions at this
   boundary. Consume RNG in canonical actor order and collect damage results.
5. Apply collected direct-fire damage as one batch; clamp HP and emit deaths.
6. Start the next legal command for each surviving robot in canonical order.
7. Emit `turnEnd` at boundary 900 after all allowed completions are processed.

Phase 3 inserts scheduled projectile impacts between steps 3 and 4/5 and moves
damage application to impact boundaries without changing the fire-time roll.

The implemented command union includes an explicit `deploy` command. Aim & Fire
captures the canonical opposing robot on the aimed tile when that fire command
starts, then compares that robot's settled position when the command completes.
This preserves the confirmed off-aimed-tile score penalty. Replacement-target
behavior when multiple robots cross the tile remains a focused parity question,
not a hidden resolver-order dependency.

## Determinism contract

1. **Canonical actor order:** team array index, then roster slot index. Never
   derive game-effect order from Map/Set/object-key iteration.
2. **One engine RNG stream:** consume only in the resolver and its pure combat
   helpers, always in canonical order. UI/renderer randomness is separate.
3. **Stable event order:** every event has `{ tick, seq }`; `seq` increases in
   emission order across the turn.
4. **Pure API:** do not mutate state, orders, catalog data, or nested arrays.
5. **Stable IDs:** projectile/event IDs are derived from turn + actor + command
   + shot index, never wall-clock time or randomness.

## Movement and simultaneity decisions

- **No robot collision.** Robots pass through and may occupy the same tile.
  Same-boundary moves are independent; no actor "wins" a destination.
- Terrain and arena bounds still gate movement. Malformed/illegal orders return
  a typed resolver error rather than silently changing the path.
- Aim & Fire observes positions after same-boundary movement/posture/scan
  completions. This makes the confirmed off-aimed-tile score penalty explicit.
- Phase 2 batches same-boundary direct-fire damage so mutual kills are possible.
  Revisit batching only if a later binary trace proves a materially different
  rule; preserve the event schema either way.
- A destroyed robot does not start another command. Phase 3 preserves already
  launched projectiles after their shooter is destroyed.

## Aim & Fire scaffold

When an Aim & Fire command completes:

1. Validate range, scan-angle gate, and LoS.
2. Calculate cover class.
3. Compare the aimed tile with the target robot's settled tile.
4. Roll hit and damage immediately using the Phase 1R model.
5. Emit `fired` and the appropriate hit/miss/damage events at the same boundary.

This immediate application is temporary. Phase 3 keeps steps 1–4 at fire time,
emits a launch event carrying the pre-rolled result, and applies it at the
scheduled impact boundary.

## Minimum event vocabulary

Use one naming convention consistently (the existing discriminated union may be
migrated during Phase 1R):

`turn-start`, `command-start`, `deployed`, `move-step`, `posture-changed`,
`scan-rotated`, `fired`, `shot-missed`, `damaged`, `destroyed`,
`command-aborted`, `turn-end`.

Events are the complete derived movie stream. They are **not** the canonical
replay input; Phase 5 replays initial state + seed + turn orders and may compare
an event digest.

## Validation boundary

The planner should create legal orders, but the resolver is a trust boundary for
replay/imported data. Validate:

- referenced teams/robots/weapons exist and belong to the ordering player;
- paths are adjacent, in bounds, and traversable for the active posture;
- command durations and budgets are derived from engine constants, not supplied
  by callers;
- aimed tiles/headings/postures are valid;
- dead/undeployed robots do not execute illegal commands.

Return a discriminated `MalformedOrders` result (or a single documented typed
exception strategy); do not mix nulls, silent skips, and throws.

## Required tests

- open-path movement emits arrivals at the exact realigned costs;
- two robots move onto and remain on the same tile;
- posture and scan changes complete at boundary-correct times;
- a command completing exactly at 900 runs, while later work does not;
- malformed path/order produces `MalformedOrders` without input mutation;
- stationary Aim & Fire uses seeded Phase 1R results;
- target moving off the aimed tile before same-boundary fire receives the score
  halving;
- same-boundary mutual lethal fire destroys both robots;
- destroyed robot does not start its next command;
- same input resolved twice yields deep-equal state/events;
- frozen input objects remain unchanged;
- HP is always clamped to `0..armor`.

## Exit gate

- At least 15 focused tests cover the cases above.
- Every command union member is handled or rejected explicitly.
- No projectile advancement, visibility, Stealth, or Scan & Fire code has leaked
  into Phase 2.

All gates pass with 23 focused command-interpreter/resolver tests (109 engine
tests total). Scan & Fire and explosive Aim & Fire return an explicit
`unsupported-command` result until their scheduled phases.
- `npm test`, `npm run typecheck`, lint, and format-check pass.
