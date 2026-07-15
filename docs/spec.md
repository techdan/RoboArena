# RoboArena game specification

The canonical, current spec for v1 mechanics. Numbers here match `src/engine/constants.ts` and `src/engine/catalog.ts` — those files are the literal source of truth; this doc explains them.

**Confidence labels** on each rule:
- ✅ **CONFIRMED** — binary path/semantics or controlled DOS test verified
- 🟨 **MAPPED / PROVISIONAL LABEL** — raw mechanism is verified, named mapping remains open
- 🔵 **PROPOSED** — engine ships with these defaults; tunable in playtest
- ⏳ **TBD** — strawman value in code, awaiting empirical pass

The binary-derived tables and code paths are documented in
[`reverse-engineering.md`](./reverse-engineering.md) and independently checked by
[`re-verification.md`](./re-verification.md). Named weapon-selector mappings,
movement timing, and the scan-cone boundary remain explicitly provisional.

---

## 1. Game overview

Two human players each command a team of robots in a top-down tactical arena. Each turn, players program their robots' actions (move, change posture, set scan, fire) over a 15-second timeline. Both teams' programs play simultaneously as a deterministic "movie", then the next turn begins. Last team standing wins (Survival mode).

**v1 scope**: human-vs-human hot-seat only. Survival sport mode only. Desktop with mouse + keyboard. Online lobby, AI, non-Survival sports, and broader original-game parity are later-version work.

### Scope trims and deliberate deviations

RoboArena v1 is a playable Survival MVP, not full RoboSport parity.

Deferred deliberately:
- Online lobby / remote multiplayer. Build hot-seat first; online depends on stable resolver, replay, planner, and movie playback.
- AI personalities. Original RoboSport includes AI levels; v1 is human-only.
- Non-Survival sports and their commands. Treasure Hunt / Capture the Flag / Hostage / Baseball plus sport-specific commands are out of v1.
- Full Custom Game team builder and point-buy roster editing. v1 can start with Quick Start / preset rosters.
- Full original weapon-system parity. v1 uses the core weapon set currently represented in `catalog.ts`; do not add extra original weapon systems without a new phase.
- Production persistence, accounts, observability, deployment automation, and full help/tutorial systems.

### Open mechanics that must not be guessed

The current defaults are good enough to prototype, but these areas need empirical confirmation before they become hard parity claims:

- **Projectile presentation timing**: hit/damage are locked at fire time; exact
  visual/impact delay by weapon remains under-specified for Phase 3.
- **Scan & Fire trigger semantics**: trigger tick, target selection when multiple enemies enter range, ammo use, and whether a tracking shot updates target tile during flight need a focused test.
- **Scan length and target speed**: the COMPUTE! review says hits depend on scan length and target speed. v1 does not model a numeric speed modifier unless DOS tests show a clear effect.
- **Arena data**: at least Rubble Two and Rubble Three need hand-verified tile maps before renderer/planner work depends on them.

---

## 2. Match structure

### Teams

- Original supports 2-4 teams. v1 UI ships exactly 2 human teams; keep engine types able to extend later. ✅
- Each team: name, color, side (1-4), brain (`'human'` only in v1; `'stupid'` AI is post-v1), home area corner.
- **Side** is an alliance axis: multiple teams can share a side (free-for-all vs. 2v2 etc.). Manual confirms ≥2 sides required. ✅

### Game lengths

| Length | Robots/team | Arena dimensions | Default roster |
|---|---:|---|---|
| Skirmish | 2 | TBD ⏳ | TBD ⏳ |
| Melee | 4 | 24×24 (Rubble Two) ✅ | 1 Rifle / 1 Burst / 1 Auto / 1 Missile ✅ |
| Battle | 6 | 32×32 (Rubble Three) ✅ | 2 Rifle / 2 Burst / 1 Auto / 1 Missile ✅ |
| Campaign | 8 | TBD ⏳ | 3 Rifle / 2 Burst / 2 Auto / 1 Missile ✅ |

### Formations

5 formations: Beginner / Standard / Fire Fight / Missile Fest / Beat the Clock. ✅
v1 ships **Beginner** only; others deferred (they affect roster composition and turn-time bounds).

### Sport modes

5 modes from the original: Survival / Treasure Hunt / Capture the Flag / Hostage / Baseball. ✅
**v1 ships Survival only.**

### Arena types

3 types: Rubble Town / Suburbs / Computer Town. ✅
v1 ships **Rubble Town only** (Two and Three sizes; Suburbs and Computer Town can come later).

### Turn budget

- Beginner default: **15.0 seconds = 900 ticks**. ✅
- Other formations: configurable 1-40 seconds (Turn Length dialog in original). ✅
- The planner permits commands extending past the budget; commands beyond 15.0 s are greyed out and not executed. ✅

---

## 3. Robot classes

5 classes are defined by the engine/catalog. Point-buy by **rating** is reserved for the post-MVP Custom Game builder; v1 can use preset rosters, and Quick Start does not need to expose every class on day one.

| Class | Primary weapon | Accuracy tier¹ | Armor (HP) | Rating | Special |
|---|---|---|---:|---:|---|
| Rifle | Rifle | High | 140 | 40 | — |
| Burst | Burst Gun | Medium | 120 | 50 | — |
| Auto | Auto Rifle² | Low | 100 | 60 | — |
| Missile | Missile Launcher (+ Rifle secondary³) | Medium | 100 | 80 | 3 missiles starting ammo |
| Stealth | Burst Gun | Medium | 120 | 100 | Visibility rule (§7) |

All ✅ from B&W Mac team-builder dialog.

¹ Accuracy is the exact binary tier `Rifle=2`, `Burst/Missile/Stealth=1`,
`Auto=0`; it feeds the live-fire score (§6).
² Auto Rifle's in-game label is "Machine Gun"; manual calls it "Automatic Rifle". Engine uses `auto-rifle` as the canonical id.
³ Missile robots also carry rifles per Amiga manual. Other formations may grant secondaries (TBD ⏳).

### Postures

**v1 ships all 3 postures.** The binary stores them as `1/2/3`; Ducking is the
mobile middle point in the cover system.

| Posture | Movement | Exposed / Bush / Low-wall cover class |
|---|---|---|
| Upright (default) | passable terrain | 4 / 4 / 3 ✅ |
| Ducking | same traversal as Upright | 4 / 3 / 2 ✅ |
| Crouching | Open Ground only | 3 / 2 / 1 ✅ |

Posture-change cost: **6 ticks (0.1 s) per step**; still provisional pending the
command-duration trace (RE §20 #12).

---

## 4. Weapons

| Weapon | Bullets/click | Engine firing interval | Max range | Ammo |
|---|---:|---|---:|---|
| Rifle | 1 | 30 ticks (0.50 s) 🟨 | 18 ✅ | unlimited |
| Burst Gun | **3** ✅ | 10 ticks (0.17 s) 🟨 | 18 ✅ | unlimited |
| Auto Rifle | 1 | 20 ticks (0.33 s) 🟨 | 18 ✅ | unlimited |
| Missile Launcher | 1 (explosive) | 20 ticks (0.33 s) 🟨 | 18 ✅ | 3 |
| Grenade Launcher | 1 (explosive) | 20 ticks (0.33 s) 🟨 | 18 ✅ | limited (TBD ⏳) |

The binary's reachable selector rows contain exact intervals
`30/30/20/15/20/20/10/10`; the named mappings above are isolated provisional
choices. Range uses **floored Euclidean distance** and is uniform at 18. ✅

### Bullet weapon damage

Each direct-fire hit rolls `base + (random & mask)`, then applies cover and
distance adjustments. The roll families are exact; labels are 🟨 until the
inventory selector mapping is completed.

| Weapon | Base roll per bullet |
|---|---|
| Rifle | `10 + (random & 7)` → 10–17 🟨 |
| Auto Rifle | `8 + (random & 15)` → 8–23 🟨 |
| Burst Gun | `6 + (random & 15)` → 6–21, three independent bullets 🟨 |

Damage adjustment: cover class 1/2/3/4 adds `-4/0/0/+4`; distance `<5` adds
4 and distance `>12` subtracts 4. Clamp final damage to at least 0. ✅

### Explosive weapon damage (Missile)

Blast at impact tile; falloff by floored Euclidean radius:

| Radius | Damage |
|---|---|
| 0 (direct hit) | 60-91 ✅ |
| 1 | 40-55 ✅ |
| 2 | 10-17 ✅ |
| 3+ | 0 ✅ |

**Blast radius = 2.** Friendly-fire rule: explosives damage all robots in radius regardless of team. ✅

Grenade category: radius 0/1/2 = `45-76 / 25-40 / 5-12` 🟨 (raw category is
exact; Grenade label remains mapped rather than proven).

Cover class 1/2/3/4 reduces blast damage to `1/2`, `3/4`, `7/8`, or full using
integer shifts/truncation. ✅

---

## 5. Movement

### Step costs

Movement currently alternates by stride parity; values remain provisional until
the movement command trace is complete (RE §20 #11):

| Move size | Parity 0 | Parity 1 |
|---|---|---|
| Single tile | 18 ticks / 0.3 s 🔵 | 42 ticks / 0.7 s 🔵 |
| Double tile | 24 ticks / 0.4 s 🔵 | 48 ticks / 0.8 s 🔵 |

The pathfinder is responsible for chunking long paths into 1- and 2-tile moves to minimize total time. Triple+ chunks: TBD ⏳.

Stride parity **persists across non-movement commands** (posture change, scan rotation, fire). Resets only on deployment. ✅

### Terrain & traversal

Upright and Ducking share traversal rules; exact terrain speed modifiers remain
under review.

| Terrain | Upright/Ducking | Crouching |
|---|---|---|
| Open Ground | yes | yes |
| Rough Ground | yes | **no** |
| Low Walls | yes | **no** to enter; may crouch in place |
| Walls | **no** | **no** |
| Bushes | yes | **no** |
| Crevices | **no** | **no** |
| Outer Walls | **no** except Dock transitions | **no** |

### Deployment

First action of each robot: deploy from Dock into Home Area. Current cost:
**2.0 s = 120 ticks** 🔵 (RE §20 #27).
First move out of the Dock must enter the Home Area. ✅

---

## 6. Combat resolution

Hit chance is an integer score indexing the exact 20-word live-fire threshold
table. Damage is a separate wide roll plus cover/distance adjustments.

### Scan cone

Each robot has one of 8 scan headings. The current hard firing gate is a forward
±90° semicircle 🔵; the exact binary angle boundary remains RE §20 #22. The old
BLACK/GREY probabilities are removed from live resolution.

Scan rotation cost: **0.05 s per directional unit**. ✅ E.g., facing N, rotating to W = 4 units = 0.2 s.

### Per-shot resolution pipeline

```
1. Range gate: `floorEuclidean(shooter, aimedTile) <= 18`.
2. Angle gate: aimed tile must be inside the scan cone.
3. LoS/cover: Bresenham terrain sampling yields cover class 1..4; wall blocks.
4. Score starts from cover class `1/2/3/4 -> 4/8/12/18`.
5. Add the exact accuracy/distance ladder and target-terrain modifier
   (`rough +2`, `bush -1`, `low-wall -3`, otherwise weapon-property add).
6. Clamp score to 0..19. If the target left the aimed tile, halve the score.
   A second unresolved modifier may halve it again (RE §20 #2; omitted).
7. Hit when `(rng & 255) < LIVE_FIRE_HIT_THRESHOLDS[score]`.
8. On hit, roll direct damage and apply cover/distance adjustments above.
```

### Two firing modes

- **Aim & Fire** (tile-targeted): hit and damage lock when the fire command
  resolves. If the target has already left the aimed tile, the score is halved.
  Later projectile flight does not reroll or enable in-flight dodging. ✅
- **Scan & Fire** (enemy-targeted, tracks): robot waits in scan mode; when an enemy enters the scan cone × range, fires *at the enemy*. Trigger and tracking semantics are TBD until the focused DOS test is run. ⏳

DOS shortcut: **Ctrl+Shift+click** on a target tile for repeat-fire (Amiga uses Alt). ✅

### No collision

Robots **pass through each other** and **can stack on the same tile**. ✅
Bullets pass through robots without hitting them — only the target tile takes damage. ✅
Friendly bodies do **not** block bullets and do not take damage from friendly bullets. ✅

---

## 7. Visibility

Per-team visibility is computed each tick. A team sees:
- All of its own robots' positions
- Tiles within any of its own robots' scan cone × range with unobstructed LoS
- Enemy robots in those visible tiles (with caveats below)

LoS blockers (engine treats these as opaque to *visibility*, separate from bullets):
- Walls block visibility ✅
- Crevices do **not** block visibility (manual: "robots can sight across them") ✅
- Bushes block visibility when on the bush tile ✅

### Stealth class rule

Stealth-class robots are invisible **unless**:
- They moved during the current tick, OR
- The observing robot is at Chebyshev distance ≤ 1 (adjacent) with LoS

Source: contemporary Compute! review of RoboSport for Windows. ✅

### Last-known-X markers

At end of each turn, for every team, record tiles where they last saw any enemy that's no longer visible. Renderer draws X glyphs on those tiles during the next Edit phase. ✅

---

## 8. Timeline & tick model

| Quantity | Value |
|---|---|
| Tick rate | **60 ticks/second** ✅ |
| Movie playback | 12 fps 🔵 (presentation only) |
| Default turn duration | 15.0 s = 900 ticks ✅ |
| Configurable turn range | 1-40 s = 60-2400 ticks ✅ |

Time is integer ticks throughout the engine. Conversions to/from seconds happen at UI boundaries only.

### Resolver boundary order

`resolveTurn({ state, orders, seed })` is a pure completion-driven simulation.
At each integer boundary it applies deploy/movement, then posture/scan changes,
then resolves Aim & Fire in canonical team/roster order, and finally batches
direct damage and deaths. Robots may stack; same-boundary mutual kills are
allowed. Events carry stable, gap-free `{ tick, seq }` values. Malformed or
Phase-ineligible imported orders return a discriminated `MalformedOrders`
result without mutating inputs.

Phase 2 applies direct-fire results immediately as a scaffold. Phase 3 will
preserve the fire-time hit/damage roll but schedule projectile launch and impact
events. Scan & Fire remains an explicit unsupported command until Phase 4.

---

## 9. Arena structure

```
┌──────────────────────────────────────────┐
│  Dock                                    │  ← robots wait pre-deploy;
│                                          │    return here when destroyed
├──────────────────────────────────────────┤
│  Playing Field                           │
│   ┌─────────┐              ┌─────────┐   │
│   │ Home NW │              │ Home NE │   │  ← 4 corners, assigned
│   └─────────┘              └─────────┘   │    clockwise by team list
│                                          │    position
│                                          │
│   ┌─────────┐              ┌─────────┐   │  First move out of Dock
│   │ Home SW │              │ Home SE │   │  must enter the team's
│   └─────────┘              └─────────┘   │  Home Area.
└──────────────────────────────────────────┘
```

All ✅ from Amiga manual + DOS observation.

---

## 10. Replay format

A complete match is reconstructible from:

```ts
ReplayLog = {
  initialState: MatchState,   // arena, teams, robots, config
  seed: string,               // RNG seed for the entire match
  turnOrders: TurnOrders[],   // per-turn programs from each team
  formatVersion: number,
}
```

Re-running this through `resolveTurn` produces a **byte-identical** event stream on any machine. Determinism is enforced by:
- Seedable RNG (mulberry32) for every probabilistic decision
- Integer arithmetic on game-state values
- Tile-by-tile Bresenham for projectile paths (no floats)
- No `Math.random`, no `Date.now`, no `setTimeout` in `src/engine/`

---

## 11. Source-of-truth pointers

| Concern | Where |
|---|---|
| Locked numerical constants | `src/engine/constants.ts` |
| Weapon damage tables | `src/engine/catalog.ts` (`WEAPONS`) |
| Robot class stats | `src/engine/catalog.ts` (`ROBOT_DEFINITIONS`) |
| Combat resolution implementation | `src/engine/firing.ts`, `src/engine/blast.ts` |
| Movement implementation | `src/engine/movement.ts` |
| Turn scheduling and resolution | `src/engine/commandInterpreter.ts`, `src/engine/resolver.ts` |
| Empirical research log | `docs/priority-tests.md` |
| Implementation roadmap | `docs/implementation-plan.md` |
| Original-game research | `docs/priority-tests.md`; local ignored source captures |

If the spec and code diverge, **the code is correct** and this doc gets updated.
