# RoboArena game specification

The canonical, current spec for v1 mechanics. Numbers here match `src/engine/constants.ts` and `src/engine/catalog.ts` — those files are the literal source of truth; this doc explains them.

**Confidence labels** on each rule:
- ✅ **CONFIRMED** — verified via DOS empirical test (Match 1-7); see `priority-tests.md`
- 🔵 **PROPOSED** — engine ships with these defaults; tunable in playtest
- ⏳ **TBD** — strawman value in code, awaiting empirical pass

---

## 1. Game overview

Two human players each command a team of robots in a top-down tactical arena. Each turn, players program their robots' actions (move, change posture, set scan, fire) over a 15-second timeline. Both teams' programs play simultaneously as a deterministic "movie", then the next turn begins. Last team standing wins (Survival mode).

**v1 scope**: human-vs-human only (hot-seat or online). Survival sport mode only. Desktop with mouse + keyboard.

---

## 2. Match structure

### Teams

- 2-4 teams per match. ✅
- Each team: name, color, side (1-4), brain (`'human'` only in v1; `'stupid'` AI is post-v1), home area corner.
- **Side** is an alliance axis: multiple teams can share a side (free-for-all vs. 2v2 etc.). Manual confirms ≥2 sides required. ✅

### Game lengths

| Length | Robots/team | Arena dimensions | Default roster |
|---|---:|---|---|
| Skirmish | 2 | TBD ⏳ | TBD ⏳ |
| Melee | 4 | 25×25 (Rubble Two) ✅ | 1 Rifle / 1 Burst / 1 Auto / 1 Missile ✅ |
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

- Beginner default: **15.0 seconds = 300 ticks**. ✅
- Other formations: configurable 1-40 seconds (Turn Length dialog in original). ✅
- The planner permits commands extending past the budget; commands beyond 15.0 s are greyed out and not executed. ✅

---

## 3. Robot classes

5 classes. Point-buy by **rating**; team's total ≤ a configurable cap (Custom Game lobby).

| Class | Primary weapon | Accuracy tier¹ | Armor (HP) | Rating | Special |
|---|---|---|---:|---:|---|
| Rifle | Rifle | High | 140 | 40 | — |
| Burst | Burst Gun | Medium | 120 | 50 | — |
| Auto | Auto Rifle² | Low | 100 | 60 | — |
| Missile | Missile Launcher (+ Rifle secondary³) | Medium | 100 | 80 | 3 missiles starting ammo |
| Stealth | Burst Gun | Medium | 120 | 100 | Visibility rule (§7) |

All ✅ from B&W Mac team-builder dialog.

¹ Accuracy tier is descriptive — engine uses scan-zone-based hit chance (§6), not accuracy multipliers.
² Auto Rifle's in-game label is "Machine Gun"; manual calls it "Automatic Rifle". Engine uses `auto-rifle` as the canonical id.
³ Missile robots also carry rifles per Amiga manual. Other formations may grant secondaries (TBD ⏳).

### Postures

**v1 ships 2 postures**, dropping the original's middle Ducking posture (DOS testing showed it was strictly dominated by Standing).

| Posture | Movement | Damage taken |
|---|---|---|
| Standing (default) | full speed on all passable terrain ✅ | baseline brackets (§6) |
| Crouching | only Open Ground; blocked by all non-flat terrain ✅ | brackets shifted ~25% lower 🔵 |

Posture-change cost: **0.1 s per height step**. Standing↔Crouching = 0.2 s. ✅

> Ducking is reserved for v2; engine's `Posture` enum can extend without major refactor.

---

## 4. Weapons

| Weapon | Bullets/click | Firing interval (alt) | Max range | Ammo |
|---|---:|---|---:|---|
| Rifle | 1 | **0.7 / 0.3 s** ✅ | 18 ✅ | unlimited |
| Burst Gun | **3** ✅ | **0.15 / 0.55 s** ✅ | 18 ✅ | unlimited |
| Auto Rifle | 1 | 0.7 / 0.3 s ⏳ | 18 ✅ | unlimited |
| Missile Launcher | 1 (explosive) | 0.7 / 0.3 s ⏳ | 18 ✅ | 3 |
| Grenade Launcher | 1 (explosive) | 0.7 / 0.3 s ⏳ | 18 ✅ | limited (TBD ⏳) |

Firing intervals **alternate by stride parity** like movement (§5). Range is **Chebyshev distance** (king-move) and is uniform across weapons (cursor-probed in DOS). ✅

### Bullet weapon damage

Two-bracket model: each on-tile hit rolls full or partial damage. P(full) falls linearly with distance.

```
P(full)(d) = clamp01(1 − d / 17)   ✅
   d=1  → 0.94 (mostly full)
   d=6  → 0.65 (mix)
   d=17 → 0.00 (all partial)
```

Per-bullet damage brackets (in HP):

| Weapon | Standing target | Crouching target |
|---|---|---|
| Rifle full | 18-25 ✅ | 14-21 🔵 |
| Rifle partial | 10-17 ✅ | 7-13 🔵 |
| Burst Gun full (per bullet × 3) | 7-10 🔵 | 5-8 🔵 |
| Burst Gun partial | 3-6 🔵 | 2-5 🔵 |
| Auto Rifle full | 18-25 🔵 | 14-21 🔵 |
| Auto Rifle partial | 10-17 🔵 | 7-13 🔵 |

Burst Gun rolls 3 independent hit + bracket rolls per click; per-click damage is the sum of bullet damages (with each bullet possibly missing).

### Explosive weapon damage (Missile)

Blast at impact tile; falloff by Chebyshev radius from impact:

| Radius | Damage |
|---|---|
| 0 (direct hit) | 55-80 ✅ |
| 1 | 40-60 ✅ |
| 2 | 13-17 ✅ |
| 3+ | 0 ✅ |

**Blast radius = 2.** Friendly-fire rule: explosives damage all robots in radius regardless of team. ✅

Grenade Launcher uses a similar shape at ~80% of Missile damages (🔵 tunable; see `catalog.ts`).

---

## 5. Movement

### Step costs

Movement steps **alternate by stride parity** (per-robot 0/1 flag flipping each step):

| Move size | Parity 0 | Parity 1 |
|---|---|---|
| Single tile | 0.3 s ✅ | 0.7 s ✅ |
| Double tile | 0.4 s ✅ | 0.8 s ✅ |

The pathfinder is responsible for chunking long paths into 1- and 2-tile moves to minimize total time. Triple+ chunks: TBD ⏳.

Stride parity **persists across non-movement commands** (posture change, scan rotation, fire). Resets only on deployment. ✅

### Terrain & traversal

Movement step costs do **not** vary by terrain at standing posture. ✅

| Terrain | Standing can walk on | Crouching can walk on |
|---|---|---|
| Open Ground | yes | yes |
| Rough Ground | yes | **no** |
| Low Walls | yes (occupies briefly while crossing) | **no** to walk onto; can occupy via in-place posture change |
| Walls | **no** | **no** |
| Bushes | yes | **no** |
| Crevices | **no** | **no** |
| Outer Walls | **no** (except Dock↔Field transitions) | **no** |

### Deployment

First action of each robot: deploy from Dock into Home Area. Cost: **2.0 s = 40 ticks**. ✅
First move out of the Dock must enter the Home Area. ✅

---

## 6. Combat resolution

### Two independent dials

Hit chance and damage bracket are independent:
- **Scan-cone position** → hit chance (does the bullet hit at all?)
- **Distance** → damage bracket (full vs partial)

### Scan cone

Each robot has a `scanHeading` (one of 8 compass directions). The firing arc is a 180° forward semicircle, subdivided:

| Zone | Half-width from heading | Hit chance |
|---|---|---|
| BLACK (optimum) | ±45° | **1.0** ✅ |
| GREY (peripheral) | ±45-90° | **0.2** ✅ |
| Outside | > 90° | "angle blocked" — cannot fire ✅ |

Scan rotation cost: **0.05 s per directional unit**. ✅ E.g., facing N, rotating to W = 4 units = 0.2 s.

### Per-shot resolution pipeline

```
1. Range check       — distance > weapon.maxRange (18) → angle-blocked equivalent
2. Angle check       — scan-cone classify; "blocked" → no fire
3. Bullet path trace — tile-by-tile from shooter to target tile:
                          • Wall in path: bullet absorbed mid-flight (no damage)
                          • Low wall in path: pathHasLowWall = true (used in cover)
                          • Bushes / crevices / open / rough: pass through
4. Hit chance        — BLACK 1.0 / GREY 0.2; failure → miss
5. Cover miss chance — only if target is CROUCHING:
                          • Target tile bush:        30%
                          • Target tile low wall:    50%
                          • Low wall in path:        90% (in-transit cover)
                          • Take MAX of target-tile and in-transit (don't stack)
                       Standing targets ignore all cover. ✅
6. Damage roll       — bracket = (random < P(full)(distance)) ? FULL : PARTIAL
                       damage = uniform(weapon.brackets[bracket][posture])
7. Rough multiplier  — if target is on rough ground: damage × 1.2 ✅ 🔵
```

### Two firing modes

- **Aim & Fire** (tile-targeted): bullet flies to a fixed tile. If the target moves before bullet impact, the bullet hits empty space (the "shot went past" outcome). Used for static targets, predicted intercepts, area denial. ✅
- **Scan & Fire** (enemy-targeted, tracks): robot waits in scan mode; when an enemy enters the scan cone × range, fires *at the enemy* with the bullet tracking the robot's tile each tick until impact. ✅

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
| Tick rate | **20 ticks/second** (0.05 s/tick) ✅ |
| Movie playback | 12 fps (decimated from 20-fps sim) ✅ |
| Default turn duration | 15.0 s = 300 ticks ✅ |
| Configurable turn range | 1-40 s = 20-800 ticks ✅ |

Time is integer ticks throughout the engine. Conversions to/from seconds happen at UI boundaries only.

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
| Empirical research log | `docs/priority-tests.md` |
| Implementation roadmap | `docs/implementation-plan.md` |
| Original-game research | `docs/manual.txt`, `screenshots/` |

If the spec and code diverge, **the code is correct** and this doc gets updated.
