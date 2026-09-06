# Headless scenario runner

Run a precise local game situation without opening a browser or room server.
The runner constructs a small Survival FFA match, submits canonical `TurnOrders`
to the production resolver, checks expectations, and verifies a canonical replay.
It does not implement its own movement, timing, combat, or visibility rules.

## Quick start

```sh
npm run scenario -- --help
npm run scenario -- run scenarios/movement.json
npm run scenario -- run scenarios/wall-blocked-shot.json
npm run scenario -- run scenarios/missile-friendly-fire.json --seed 42 --out out/scenarios/blast
```

Use `npm.cmd` if PowerShell blocks `npm.ps1`. No development server is needed.
`out/` is already gitignored. Choose a separate output directory for each case;
running again replaces its three artifact files.

For clean machine-readable stdout (without npm's script banner):

```sh
npm run --silent scenario -- run scenarios/movement.json --json
```

Exit codes:

- **0**: every assertion passed and replay verification succeeded. If there
  are no assertions, this means only that resolution and replay verification worked.
- **1**: an assertion or replay verification failed. Reports/artifacts are still
  produced so the failure can be inspected.
- **2**: invalid JSON, malformed scenario/orders, unsupported arguments, or an I/O error.

## Saved scenario format

Copy an example in `scenarios/` and edit it. These files are executable
regressions: the harness test suite runs all three bundled examples.

```json
{
  "formatVersion": 1,
  "name": "Crouch in place",
  "arena": { "width": 12, "height": 12 },
  "teams": [
    {
      "id": "red",
      "robots": [{ "id": "r1", "class": "rifle", "position": { "x": 2, "y": 2 } }]
    },
    {
      "id": "blue",
      "robots": [{ "id": "r2", "class": "rifle", "position": { "x": 9, "y": 9 } }]
    }
  ],
  "turns": [{
    "seed": "crouch-1",
    "orders": {
      "turnNumber": 1,
      "timelines": [{
        "robotId": "r1",
        "segments": [{ "kind": "set-posture", "posture": "crouching" }]
      }]
    }
  }],
  "assertions": [{
    "kind": "robot",
    "turn": 1,
    "robotId": "r1",
    "equals": { "posture": "crouching", "position": { "x": 2, "y": 2 } }
  }]
}
```

- Arena dimensions are 6–128 tiles per axis. Coordinates are zero-based `(x,y)`;
  terrain is stored as `tiles[y][x]`. Tiles default to `open`. Set individual
  tiles using `arena.terrain: [{ "at": { "x": 4, "y": 3 }, "terrain": "wall" }]`.
  Allowed terrain: `open`, `rough`, `low-wall`, `wall`, `bush`, `crevice`, `outer-wall`.
  Duplicate overrides and invalid starting positions are rejected. Robot stacking
  is legal. Home areas come from the engine's dimension-based helper.
- Supply 2–4 teams. Array order assigns unique Sides 1–4 and Home slots
  NW, NE, SE, SW; this basic format does not configure alliances or vacant slots.
  Robot ids must be globally unique; team ids must be unique.
- Robot classes: `rifle`, `burst`, `auto`, `missile`. Stats and starting ammo come
  from the canonical catalog. Optional overrides: `hp`, `posture`, `scanHeading`,
  `damageStaggerActionsRemaining`, and partial `ammo` (keys are weapon ids).
  Defaults are full armor, upright, east, zero stagger, and catalog ammo.
  A position may also be `"dock"`. Explosive ammo overrides must be nonnegative
  integers. Stealth and other deferred gameplay are excluded.
- Turns start at 1 and must be consecutive. Each supplies a nonempty string seed
  and the existing `TurnOrders` format: `turnNumber`, `timelines`, and each robot's
  `segments`. Omitted robot timelines idle. State carries into the next turn.
  `turnLengthSeconds` defaults to 15 (valid range 1–40).
- `--seed 42` replaces the first seed with the string `"42"`; subsequent turns use
  `"42:2"`, `"42:3"`, etc. Without that option, every saved turn seed is preserved.
  The report and replay record the effective seeds. Seed changes may invalidate
  expectations that intentionally depend on a specific random outcome.
- The CLI validates schema and setup, then the real resolver checks command
  legality. Unknown fields are errors, including misspelled assertion fields.

## Assertions

Assertions refer to a one-based resolved `turn`. Two kinds are supported:

**Robot state:** `equals` checks the specified fields after that turn. Available
fields are `position`, `hp`, `posture`, `scanHeading`,
`damageStaggerActionsRemaining`, and partial `ammo`. Unspecified fields are ignored.
At least one field is required.

```json
{ "kind": "robot", "turn": 1, "robotId": "launcher", "equals": { "ammo": { "missile-launcher": 2 } } }
```

**Event count:** count events matching every specified filter field. `kind` is
required; optional fields are `tick`, `robotId`, `shooterId`, `sourceId`, `targetId`,
`teamId`, `enemyId`, `damageKind`, and `reason`. Use fields belonging to that event
type (see `ResolutionEvent` in `src/engine/types.ts`); incompatible filter fields
are rejected to avoid false passes. A count of zero asserts
absence. Ticks are local to the turn, not wall-clock time.

```json
{ "kind": "event-count", "turn": 1, "where": { "kind": "damaged", "targetId": "target" }, "count": 0 }
```

Choose expectations from the spec or a known regression. Simply accepting whatever
the current engine emits does not establish correctness. Use positive assertions
alongside absence checks to establish that the intended action actually occurred.

## Artifacts and agent workflow

`--out <directory>` produces:

- `report.json`: pass/fail, expected and actual assertion data, effective seeds,
  per-turn states/digests, final state, and replay verification result.
- `events.json`: complete events grouped by turn, including tick and sequence.
- `replay.json`: the existing version-1 canonical replay format, compatible with
  `deserializeReplay` and `verifyReplay`. State exports preserve last-known-marker
  Maps as entry arrays using that same codec.

For an agent: copy the closest scenario, change only the setup/orders needed to
reproduce the issue, run with `--json --out`, inspect failing checks and events,
then retain a focused scenario/test when fixing the issue. The CLI is sufficient;
there is no separate model service, MCP server, or game-playing AI dependency.

This is a local developer tool with complete engine state, including all teams'
orders and visibility events. It is not a participant projection or room import
endpoint. It does not test network ownership/privacy, persistence/reconnect,
planner interaction, renderer presentation, or iPad input. It does not stop at
a room-level Final Ceremony; supplied turns exercise the engine directly.
Opening a scenario/replay directly in the planner/movie UI and driving real room
sessions are separate follow-ups. Existing manual release gates remain in place.

Implementation: `src/scenario/scenario.ts` and `src/scenario/cli.ts`.
Validation: `npm exec -- vitest run src/scenario/scenario.test.ts`.
