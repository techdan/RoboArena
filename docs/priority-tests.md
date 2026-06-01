# Priority Empirical Tests — DOS RoboSport

Working list. Order is value × ease — top first. Run from the top; stop when you have enough data to unblock engine work.

**Setup that's the same for every match:**

- Two teams, both **Human Brain** (you control both sides). Default rosters from Quick Start formation = Beginner, Survival.
- **Team role assignments** (so Ctrl+D shows the targets' HP first):
  - **Computers (purple)** → **Sitting Ducks** (the targets whose HP we track)
  - **Cyborgs (red)** → **Hunters** (the shooters)
  - Computers shows up first in Ctrl+D Team Data → SD HPs are immediately visible without scrolling.
- Read HP via **Ctrl+D Team Data** (works live during movie playback — see *measuring per-shot damage* below).
- All shooters and targets in **standing** posture.
- Place all robots on **open ground** (the gray dotted/hatched terrain in Rubble arenas), avoiding bushes / blue crates / rough patches / walls.

**Confirmed arenas:**

- Melee → **Rubble Two**, 25 × 25 tiles (indices 0-24).
- Battle → **Rubble Three**, 32 × 32 tiles.

---

## MVP empirical gates (run before Phase 3/4 if possible)

These are intentionally low-burden. Stop after the qualitative answer is clear. Do not run large statistics unless a result would change implementation.

### Gate A — Aim & Fire projectile timing and moving-target miss

**Goal**: determine whether Aim & Fire resolves immediately or after visible travel, and whether a target that leaves the targeted tile before impact avoids damage.

**Setup**:
- Arena: Battle / Rubble Three if you need a long clean row; Melee / Rubble Two is fine if coordinates are easier.
- Use one Rifle Hunter and one Rifle Sitting Duck on open ground with clear line of sight, distance 8-12 if possible.
- Hunter scans toward the target. Sitting Duck starts on the targeted tile.

**Steps**:
1. Control run: SD does nothing. Hunter Aim & Fires the SD tile once. Record whether damage occurs and whether the shot has an observable travel delay.
2. Moving run: same setup, but SD moves away from the targeted tile immediately while Hunter Aim & Fires the SD starting tile.
3. During movie playback, record only:
   - Did the shot hit the old tile, the moving robot, or nothing?
   - Approximate impact timing: same tick / visibly delayed / unknown.
   - SD HP before and after.

**Default if skipped**: implement tile-targeted Aim & Fire with tunable projectile timing; do not claim original-game faithfulness until this gate is run.

### Gate B — Scan & Fire trigger and tracking

**Goal**: determine the minimum semantics for Scan & Fire: when it triggers, whether it fires at the detected enemy or a fixed tile, and whether it tracks the enemy through impact.

**Setup**:
- One Rifle Hunter on open ground, facing a clean lane.
- One Rifle Sitting Duck walks across or down that lane so it enters the Hunter's scan cone during the turn.
- Use a short enough range that the trigger is easy to see; avoid walls, bushes, and overlapping robots.

**Steps**:
1. Hunter chooses Scan & Fire with Rifle, facing the lane.
2. SD moves into the cone and keeps moving.
3. During playback, record:
   - Did Hunter fire automatically?
   - Did the shot seem to target the entry tile or the moving robot?
   - Was ammo/shot count consumed when the shot fired?
   - SD HP before and after.

**Default if skipped**: keep Scan & Fire behavior marked PROPOSED/TBD in the spec and implementation plan.

### Gate C — Scan length and target speed first pass

**Goal**: interpret the COMPUTE! claim that hit outcomes depend on scan length and target speed without committing to a numeric model.

Run this only after Gate B works. Use one or two paired trials, not a statistical study.

**Trial 1: scan length**
- Same Hunter/SD setup.
- Repeat once with a short Scan & Fire length and once with a longer Scan & Fire length, if the DOS UI exposes that setting clearly.
- Record only obvious differences: trigger range, hit/miss, and damage/no damage.

**Trial 2: target speed**
- Same range and scan length.
- Compare a stationary SD in the cone to an SD that is moving through the cone.
- Record only obvious differences: does moving make the shot visibly miss, delay, or do less damage?

**Default if skipped or inconclusive**: no numeric target-speed modifier in v1. Model moving-target effects through tile targeting, projectile timing, and Scan & Fire trigger/tracking semantics only.

### Gate D — Rubble arena transcription

**Goal**: create faithful-enough v1 arena data for Rubble Two and Rubble Three without screenshot extraction tooling.

**Terrain codes**:

| Code | Terrain |
|---|---|
| `O` | open ground |
| `R` | rough ground |
| `B` | bush |
| `L` | low wall |
| `W` | wall / tall wall |
| `C` | crevice |
| `X` | outer wall / boundary |
| `K` | crate / blue obstacle |
| `?` | unknown, needs review |

**Workflow**:
1. In DOS RoboSport, open the target Rubble map and click/probe each coordinate.
2. Record rows left-to-right, top-to-bottom. Rubble Two is 25x25 (`x=0..24`, `y=0..24`); Rubble Three is 32x32 (`x=0..31`, `y=0..31`).
3. Use this row template:

```text
map: Rubble Two
size: 25x25
y00: XXXXXXXXXXXXXXXXXXXXXXXXX
y01: X???????????????????????X
...
y24: XXXXXXXXXXXXXXXXXXXXXXXXX

notes:
- (x,y): reason for any `?`
```

4. Convert the row strings into `src/lib/arenas/<name>.json`.
5. Review only `?` tiles or tiles that block a planned test path.

**Default if partially complete**: ship only the map(s) fully transcribed and keep the other out of the selectable v1 UI.

---

## Match 1 — Battle (Rubble Three, 32×32) — combined damage + accuracy

**Goal**: in one match, get
- Validated per-shot damage at point-blank for **all 4 weapons** (Rifle / Burst / Auto / Missile).
- Hit rate at mid-range (distance 6) for **Rifle and Burst** (the duplicated weapons in Battle's 2R/2B/1A/1M roster).

### Setup

**Sitting Ducks** (6 stationary targets along the **y=11 open-ground row**, do nothing after deploy):

| Robot | Coord | Role |
|---|---|---|
| Rifle SD A | **(4, 11)** | point-blank Rifle target |
| Rifle SD B | **(10, 11)** | mid-range (d=6) Rifle target |
| Burst SD A | **(16, 11)** | point-blank Burst target |
| Burst SD B | **(22, 11)** | mid-range (d=6) Burst target |
| Auto SD | **(26, 11)** | point-blank Auto target |
| Missile SD | **(28, 11)** | point-blank Missile target |

(SDs A and B for the same weapon are 6 tiles apart so the d=6 shooter doesn't accidentally hit the d=1 target. Row y=11 is the user-confirmed open-ground horizontal stretch with buildings above (upper-left and upper-right) and below (small lower-left, large center, plus a crevice in the lower-right).)

**Hunters** (each pairs with the same-class Sitting Duck, walks south to firing position):

| Robot | Firing position | Distance | Target tile |
|---|---|---|---|
| Rifle Hunter A | **(3, 11)** | 1 | (4, 11) | E |
| Rifle Hunter B | **(16, 11)** *stacked w/ Burst SD A* | 6 | (10, 11) | W |
| Burst Hunter A | **(17, 11)** | 1 | (16, 11) | W |
| Burst Hunter B | **(16, 11)** *stacked w/ Burst SD A & Rifle Hunter B* | 6 | (22, 11) | E |
| Auto Hunter | **(25, 11)** | 1 | (26, 11) | E |
| Missile Hunter | **stay in Home Area, do not fire** | — | — | — |

> **All Hunters on y=11** (the user-confirmed clean horizontal stretch). This:
> - Avoids every wall block south of y=11 (10-12,17 / 15-16,12 / 16,13 / lower-right crevice) without coordinate gymnastics.
> - **Doubles as a free verification** that bullets pass through any robot on the path and only damage the target tile. If a Hunter takes damage from a friendly's stray shot, that's a useful surprise — record it and we'll revise the engine model.
> - **Stacking is intentional**: Rifle Hunter B and Burst Hunter B both sit on (16, 11) with Burst SD A. They fire in opposite directions (W and E) along the row. Each one's bullet passes through tiles that contain other robots, ending only at its target tile.
> - **Missile Hunter is skipped** in Match 1. Firing a missile at distance 1 from (28, 11) would put Missile Hunter inside its own blast radius (probably 1–3 tiles). Match 2 covers Missile damage cleanly at every radius including direct hit, so we lose no data by deploying Missile Hunter into Home Area and leaving it idle.

**Bullet path table** (sanity check — all paths cross friendlies but not enemies until target tile):

| Hunter | Path | Friendlies crossed | Enemies crossed before target |
|---|---|---|---|
| Rifle A → (4, 11) | E from (3, 11) | none | none |
| Rifle B → (10, 11) | W from (16, 11) thru (15..11, 11) | none | none (cells empty) |
| Burst A → (16, 11) | W from (17, 11) | none | none |
| Burst B → (22, 11) | E from (16, 11) thru (17..21, 11) | (17, 11) Burst Hunter A | none (cells empty) |
| Auto → (26, 11) | E from (25, 11) | none | none |

Only Burst B's path passes through a friendly (Burst Hunter A). If our "bullets pass through" model is correct, Burst Hunter A takes no damage. If it does, we've found a contradiction worth knowing about.

> **Adjust if needed**: if any specific tile falls on a bush / crate / building wall / crevice, slide the whole pair east or west (keeping shooter↔target distance the same) to a clean stretch on y=11. Mid-range Hunter firing positions (y=17) are below the y=11 row — verify those tiles are also clean open ground; otherwise nudge to y=16 or y=18 and adjust target distance accordingly. **Avoid the crevice in the lower-right of the arena** — robots can't path across it.

### Steps (per Hunter, all happen in the same single turn)

#### Point-blank Hunters (Rifle A, Burst A, Auto) — for damage values

1. Deploy out of Dock, walk into Home Area, walk to assigned firing position.
2. **Set scan direction toward the target** (Shift+click in the target's direction). Required — without this the shot will be "**angle blocked**" because firing only works inside the robot's scan cone. Rotation costs 0.05 s per directional unit and the robot may already be facing the target after walking to position; check the Tools-panel Scan indicator and only rotate if needed.
3. **Aim & Fire** the target tile **3 separate times** (just click 3 times, no Ctrl+Shift). 3 individual shots gives 3 clean per-shot damage samples — easier to read in movie playback than a 30-shot repeat-fire stream.
4. Missile Hunter: skipped in Match 1 (covered by Match 2).

#### Mid-range Hunters (Rifle B, Burst B) — for hit rate

1. Deploy, walk to firing position.
2. **Set scan direction toward the target** (same as above).
3. **Ctrl+Shift+click** the target tile → **repeat-fire** for the rest of the turn. Lots of shots → reliable hit-rate estimate.

> **Scan-direction reminder per Hunter** (each must scan toward its target before firing, or the shot is "angle blocked"):
> - Rifle Hunter A at (3, 11) → scan **East**
> - Rifle Hunter B at (16, 11) → scan **West**
> - Burst Hunter A at (17, 11) → scan **West**
> - Burst Hunter B at (16, 11) → scan **East**
> - Auto Hunter at (25, 11) → scan **East**
>
> Robots stacked on (16, 11) (Rifle B and Burst B) face **opposite** directions — that's fine; scan is per-robot, not per-tile.

#### Sitting Ducks

1. All 6 SDs: deploy, walk to assigned coord, then sit. No further actions.

### After the turn — measuring damage

Recommended workflow (slow but accurate):

1. End turn → watch the movie once at full speed for context.
2. Rewind. **Ctrl+D Team Data**: confirm starting HPs (140 / 140 / 120 / 120 / 100 / 100).
3. Step the movie forward (Forward Step button) until you see a **"Ha!" / "Ow!" / "Aaargh!"** speech bubble pop up on a target. Stop.
4. Step backward 1 frame so the bubble is gone. **Ctrl+D**, note that target's HP.
5. Step forward past the bubble. **Ctrl+D**, note the new HP.
6. Subtract → per-shot damage. Record.
7. Continue stepping forward to the next bubble; repeat.

You only need to do this for the **3 point-blank shots × 4 weapons = 12 measurements**. The mid-range Hunter's full repeat-fire stream you can ignore at the per-shot level — just record the **final HP delta** and we'll compute hit rate using TEST 1's per-shot averages.

### Recording template

Paste your numbers back to me in this format:

```
MATCH 1 (Battle, Rubble Three)

Point-blank damage (3 shots each, distance 1):
  Rifle  → shot1: 140->120 , shot2: 120->97 , shot3: 97->72  | misses (if any): 0
  Burst  → shot1: 120->97 , shot2: 97->67 , shot3: 67->41 , shot 4: 41->15, shot 5: 0 | misses: 0
  Auto   → shot1: 100->71 shot2: 71->55 , shot3: 55->35  | misses: 0
  Missile → shot1: __ , shot2: __ , shot3: __  | misses: __

Mid-range total damage (repeat-fire, distance 6, full turn):
  Rifle B → total dmg dealt: 140->121->107->87->72->58->37->20->2->0, approx shots fired: ___
  Burst B → total dmg dealt: 120->103->84->66->52->35->15->0, approx shots fired: 8 plenty of time left 
```

That's everything I need to lock damage ranges + accuracy curves for the 4 default weapons.

---

## Match 2 — Melee (Rubble Two, 25×25) — missile blast falloff

**Goal**: missile damage curve at radii 0, 1, 2, 3 from the impact tile. One missile shot per turn = one full curve sample. With 3 missiles in inventory, three turns of firing = three samples per radius (variance).

**Game setup**:
- Quick Start → Beginner → **Melee** → **Rubble** → Survival.
- **Computers (purple)** = Sitting Ducks. **Cyborgs (red)** = Hunters (only Missile Hunter acts).
- Both teams Human Brain.

### Setup

**Use the y=24 perimeter row** — Rubble Two's middle is full of rubble/buildings; the south edge is clean and close to the Computers' home area, so SDs walk into position fast and Cyborgs Hunters can start firing as soon as they arrive.

**Important: Missile max range = 6 tiles** (per the Scan-and-Fire dialog cap). Missile Hunter firing position must be **exactly 6 tiles** from the impact tile, on the same row.

**Sitting Ducks** (Computers — 4 stationary targets in a horizontal line along y=24):

| Robot | Coord | Radius from impact |
|---|---|---|
| Rifle SD | **(7, 24)** | 0 — impact tile |
| Burst SD | **(8, 24)** | 1 (east) |
| Auto SD | **(9, 24)** | 2 (east) |
| Missile SD | **(10, 24)** | 3 (east) |

**Hunters** (Cyborgs — only Missile Hunter acts):

- Missile Hunter firing position: **(1, 24)** — 6 tiles west of impact. Distance just needs to be within Missile's actual max range (which is >10 — see range correction below); 6 is comfortable and keeps Hunter outside any plausible blast radius.
- All other Cyborgs (Rifle / Burst / Auto Hunters): do nothing — leave them in Home Area or sit anywhere out of the way. Irrelevant to Match 2.

> **Range correction (user-confirmed via DOS)**: the Scan-and-Fire dialog's "Maximum Distance: 6" is the **player's setting** for how far an enemy can enter scan range before the robot auto-fires — it's a Scan-and-Fire engagement cap, not the weapon's true range. **Aim & Fire works at distances well past 6** (8, 9, 10+ confirmed). Match 2 uses distance 6 for safety / convenience, not because the weapon is range-limited.
>
> **If y=24 turns out to be partially obstructed**: slide the entire layout east or west along the row, keeping the relative positions (Hunter, gap of 5 tiles, impact, +1, +2, +3). Or fall back to y=1 / column 1 / column 23.

### Steps — single turn, all 3 missiles

#### Programming the turn

**Computers (Sitting Ducks)** — program each one:
1. Rifle SD: deploy → walk to (7, 24) → sit.
2. Burst SD: deploy → walk to (8, 24) → sit.
3. Auto SD: deploy → walk to (9, 24) → sit.
4. Missile SD: deploy → walk to (10, 24) → sit.

**Cyborgs (Hunters)** — only Missile Hunter acts:
1. Missile Hunter: deploy → walk to (1, 24).
2. Set scan direction **East** (Shift+click E). Hover impact tile (7, 24) — status bar should not read "angle blocked".
3. **Aim & Fire missile at (7, 24) three times** (just click 3 times in succession). Each fire consumes a small slice of timeline; the full sequence (deploy + walk + 3 missiles) should fit comfortably in 15 s if Cyborgs deploys near y=24.
4. Other Cyborgs Hunters (Rifle / Burst / Auto): leave in Dock or idle in Home Area.

End turn.

#### Reading damage during the movie

Three missile impacts will occur during movie playback. **Frame-step between them, Ctrl+D between impacts:**

1. Rewind movie. Ctrl+D → confirm starting HPs (140 / 120 / 100 / 100). Record.
2. Step forward until the **first missile impact** (explosion sprite + speech bubbles). Stop just past it.
3. Ctrl+D → record HPs after impact 1. Compute deltas → **Sample 1 damage per radius**.
4. Step forward until the **second missile impact**. Ctrl+D → deltas from end-of-impact-1 → **Sample 2 damage**.
5. Step forward until the **third missile impact**. Ctrl+D → deltas → **Sample 3 damage**.
6. If any SD dies, stop reading that row for subsequent samples.

**Per radius (per sample):**
- Radius 0 = HP delta on Rifle SD (impact tile)
- Radius 1 = HP delta on Burst SD
- Radius 2 = HP delta on Auto SD
- Radius 3 = HP delta on Missile SD

**0 damage at radius N → blast doesn't reach that far** (engine `blastRadius < N`).

> If Cyborgs' home area is too far from y=24 to fit deploy + walk + 3 missiles in 15 s, fall back to multi-turn: turn 1 deploy + walk only, then 1 missile per turn. Tell me which approach you used.

---

### 🟢 Quick range exploration (free, no match-time cost)

While in Edit mode, before committing the Aim & Fire commands, probe the actual max range of each weapon:

1. Click the **Aim & Fire** button on a Hunter to enter targeting mode.
2. Hover the cursor at progressively farther tiles along the row from the Hunter.
3. Watch the upper-right corner — it shows **"distance N"** (target valid) or **"out of range"** (or **"angle blocked"** if outside scan cone).
4. The largest distance that still shows "distance N" is the weapon's **actual max range**. Note it.
5. Cancel without firing (click somewhere else / hit Cancel) — costs no timeline.

Repeat for **each weapon** in the respective Hunter's Edit mode. Match 1 already covers Rifle, Burst, Auto Hunters; their max ranges can be probed before you start the Aim & Fire shots.

**Recording template:**

```
Weapon max ranges (cursor probe, no match needed):
  Rifle:   max range = 18
  Burst:   max range = 18
  Auto:    max range = 18
  Missile: max range = 18
  Grenade: (Custom Game only — defer)
```

This lets us replace the bogus "Missile range = 6" with the real numbers across all weapons.

### Recording template

```
MATCH 2 (Melee, Rubble Two) — Missile blast (single turn, 3 missiles)

Sample 1 (after impact 1):
  Radius 0 (Rifle SD): 78 health 
  Radius 1 (Burst SD): 73 health 
  Radius 2 (Auto SD):  85 health
  Radius 3 (Missile SD): 100 health

Sample 2 (after impact 2):
  Radius 0: 0  | Radius 1: 18  | Radius 2: 68  | Radius 3: 100

Sample 3 (after impact 3):
  Radius 0: 0  | Radius 1: 0  | Radius 2: 54  | Radius 3: 100
```

---

## Match 3 — Posture × hit rate + Match 1 re-validation (Battle, Rubble Three)

**Critical context:** Match 1 was partially tainted — Burst SD A at (16, 11) was on a **bush** (provides cover, reduced damage taken) and Burst SD B at (22, 11) was on **rough ground** (vulnerable, increased damage taken). Match 3 redoes the d=6 measurement on **verified open ground only**, AND adds posture variants.

### Step 0 (mandatory) — terrain reconnaissance

**Before placing any robot**, hold **Cmd / Alt / L.Amiga-Shift + click** on each candidate tile to open the Help-on-Terrain dialog. Confirm "Open Ground" — anything else (rough, bush, low wall, crevice, blue crate) → pick a different tile.

**Known-bad y=11 tiles from user reconnaissance** (skip these):
- ❌ **(16, 11) — bush** (Burst SD A in Match 1; tainted Burst point-blank data)
- ❌ **(22, 11) — rough ground**
- ❌ **(24, 11) — rough ground**
- (Probably also (23, 11) — sits between two confirmed-rough tiles. Probe to confirm.)

**Confirmed-open y=11 tiles** (Match 1 anchors + user-confirmed):
- ✓ (3, 11), (4, 11) — used by Rifle Hunter A / Rifle SD A in Match 1
- ✓ (10, 11) — Rifle SD B in Match 1
- ✓ (17, 11) — Burst Hunter A in Match 1
- ✓ (25, 11) — user-confirmed open
- ✓ (26, 11) — Auto SD in Match 1

**Probe these new positions before committing**: (18, 11), (19, 11), (27, 11), (28, 11). If any are bad, slide ±1 tile and re-probe. If y=11 has too many bad spots overall, fall back to y=10 or y=12.

### Setup (after reconnaissance — adjust to whatever your probes confirm open)

**Computers Sitting Ducks** (Battle = 2R/2B/1A/1M, postures vary, **all on confirmed open ground — no bush, no rough**):

| Robot | Coord | Posture | Role |
|---|---|---|---|
| Rifle SD A | **(4, 11)** ✓ | **standing** | point-blank Rifle target (control, Match 1 anchor) |
| Rifle SD B | **(10, 11)** ✓ | **ducking** | mid-range (d=6) Rifle target — posture variant (Match 1 anchor) |
| Burst SD A | **(19, 11)** *(probe)* | **standing** | point-blank Burst target — **replaces tainted Match 1 (16, 11) bush** |
| Burst SD B | **(25, 11)** ✓ | **crouching** | mid-range (d=6) Burst target — **replaces tainted Match 1 (22, 11) rough** |
| Auto SD | **(28, 11)** *(probe)* | **standing** | point-blank Auto target |
| Missile SD | leave in dock | — | irrelevant |

> If (19, 11) probes as rough/bush, shift Burst SD A west to (18, 11) or (17, 11) and adjust Burst SD B east to keep their distance ≥ 6 (e.g., (17, 11) → SD B at (25, 11) gives d=8, still mid-range; record actual distance used).
>
> If (28, 11) probes as bad, use (29, 11) or (30, 11) — Battle is 32 wide so plenty of room.
>
> Setting posture: in Edit mode, click a posture icon in the Tools panel (Standing / Ducking / Crouching) before sitting. Posture change costs 0.1 s per height step — negligible.

**Cyborgs Hunters** (each at confirmed-open firing position):

| Robot | Firing position | Distance | Target | Scan | Action |
|---|---|---|---|---|---|
| Rifle Hunter A | **(3, 11)** ✓ | 1 | Rifle SD A (4, 11) | E | 3 Aim & Fire shots |
| Rifle Hunter B | **(4, 11)** *stacked w/ Rifle SD A* | 6 | Rifle SD B (10, 11) ducking | E | repeat-fire (Ctrl+Shift) |
| Burst Hunter A | **(18, 11)** *(probe)* | 1 | Burst SD A (19, 11) | E | 3 Aim & Fire shots |
| Burst Hunter B | **(19, 11)** *stacked w/ Burst SD A* | 6 | Burst SD B (25, 11) crouching | E | repeat-fire |
| Auto Hunter | **(27, 11)** *(probe)* | 1 | Auto SD (28, 11) | E | 3 Aim & Fire shots |
| Missile Hunter | leave in dock | — | — | — | — |

> **Stacking pattern same as Match 1** preserved: each mid-range Hunter stacks on the point-blank target tile, fires east at the mid-range SD 6 tiles further east.
>
> **Bullet path for Burst Hunter B (19, 11) → Burst SD B (25, 11)** crosses (20-24, 11). The known rough tiles (22, 11) and (24, 11) are in the path — that's fine because rough ground only affects movement and damage taken, **not bullets in transit**. The bullet flies through.
>
> Verify (18, 11) and (19, 11) are open ground via terrain probe before placing — those are the two unknowns.

### Yield

| Measurement | Source |
|---|---|
| Rifle d=1 dmg (clean re-validation) | Rifle Hunter A vs standing SD on confirmed open ground |
| Burst d=1 dmg (replaces tainted) | Burst Hunter A vs standing SD on confirmed open ground |
| Auto d=1 dmg (re-validation) | Auto Hunter vs standing SD |
| Rifle d=6 hit rate (vs ducking) | Rifle Hunter B → posture multiplier for ducking |
| Burst d=6 hit rate (vs crouching) | Burst Hunter B → posture multiplier for crouching |
| Standing baseline at d=6 | already in Match 1 (Rifle B against Rifle SD B) — assume valid since Rifle SD B at (10, 11) wasn't flagged as bush/rough |

Combined with Match 1's standing-at-d=6 data, this gives all three posture multipliers (standing 1.0, ducking ?, crouching ?).

### Recording template

```
MATCH 3 (Battle, Rubble Three) — Posture + re-validated open-ground damage

Confirmed open-ground positions used (from terrain reconnaissance):
  Rifle SD A: (__, __) standing
  Rifle SD B: (__, __) ducking
  Burst SD A: (__, __) standing
  Burst SD B: (__, __) crouching
  Auto SD:    (__, __) standing

Point-blank damage (3 shots each, distance 1, all OPEN GROUND) END HP AFTER EACH SHOT:
  Rifle  → shot1: 116 , shot2: 96 , shot3: 73  | misses: __
  Burst  → shot1: 94 , shot2: 69 , shot3: 48  | misses: __    ← replaces Match 1 (was on bush)
  Auto   → shot1: 80 , shot2: 62 , shot3: 33  | misses: __

Mid-range total damage (repeat-fire, d=6):
  Rifle B vs DUCKING SD → start HP 140 / end HP 126, 110, 90, 74, 56, 39, 25, 6, 0 / total dmg ___
  Burst B vs CROUCHING SD → start HP 120  / end HP 78, 65, 53, 34, 18, 0 / total dmg ___
```

### 🟢 Bonus while you're already in this match — movement re-validation

Before sitting any SD, walk one of them through 5+ confirmed-open-ground tiles and record the timeline at each step. Should be 0.3, 1.0, 1.3, 2.0, 2.3 (cumulative timestamps, alternating step costs). If different, the original 0.3/0.7 model needs revision. **Costs nothing extra** — it's part of the SDs' walk to position anyway.

```
Movement re-validation (one SD, all open ground):
  Tile 1 → timeline ___
  Tile 2 → timeline ___
  Tile 3 → timeline ___
  Tile 4 → timeline ___
  Tile 5 → timeline ___
```

---

## Match 4 — Posture × hit-rate (controlled, ratio-based) — single Battle match

Battle's 2R + 2B roster covers all 4 pairs in one match: 2 controls (standing) + 2 posture variants (ducking, crouching). 4 same-distance, same-weapon comparisons → both ducking and crouching multipliers in ~15 minutes.

### Why fixed-count Aim & Fire instead of Ctrl+Shift repeat-fire

We need to **know exactly how many shots fired** for the test/control ratio. Repeat-fire is opaque — if a target dies mid-stream, total damage caps at HP and breaks the math. Manual Aim & Fire 10 times per Hunter = 10 known clicks. Pick a distance where the target survives all 10 clicks and the full damage signal is preserved.

**At d=10**: Rifle hits ~20% × ~17 dmg/hit × 10 clicks ≈ 34 dmg. 140-HP target survives. ✓ Burst at d=10 is borderline, see fallback below.

### Setup (Battle, Rubble Three)

**Layout principle**: 4 pairs along y=11 at d=10. Rifle pairs sit west of the bush at (16, 11); Burst pairs sit east of it. This keeps every bullet path on clean ground and avoids the bush providing accidental cover to any target. Rough at (23, 11)/(24, 11) is in the bullet path of the Burst pairs but doesn't provide cover (rough is a "you take more damage when ON it" effect, not a cover-in-transit effect), so paths are still clean.

**Computers Sitting Ducks** (4 active, Auto/Missile idle):

| Robot | Coord | Posture | Role |
|---|---|---|---|
| Rifle SD A | **(13, 11)** *(probe)* | **standing** | Rifle control |
| Rifle SD B | **(15, 11)** *(probe)* | **ducking** | Rifle posture test |
| Burst SD A | **(27, 11)** *(probe)* | **standing** | Burst control |
| Burst SD B | **(29, 11)** *(probe)* | **crouching** | Burst posture test |
| Auto SD | leave in dock | — | irrelevant |
| Missile SD | leave in dock | — | irrelevant |

**Cyborgs Hunters** (4 active, Auto/Missile idle):

| Robot | Coord | Distance | Target | Scan | Action |
|---|---|---|---|---|---|
| Rifle Hunter A | **(3, 11)** ✓ | **10** | (13, 11) | E | **10 individual Aim & Fire clicks** at (13, 11) |
| Rifle Hunter B | **(5, 11)** *(probe)* | **10** | (15, 11) | E | **10 individual Aim & Fire clicks** at (15, 11) |
| Burst Hunter A | **(17, 11)** ✓ | **10** | (27, 11) | E | **10 individual Aim & Fire clicks** at (27, 11) |
| Burst Hunter B | **(19, 11)** *(probe)* | **10** | (29, 11) | E | **10 individual Aim & Fire clicks** at (29, 11) |
| Auto Hunter | leave in dock | — | — | — | — |
| Missile Hunter | leave in dock | — | — | — | — |

> **Probe step** before committing: Cmd/Alt+click on each unprobed tile (13, 5, 15, 19, 27, 29 on y=11) and confirm "Open Ground". If any are bad, slide that pair east or west together (keep d=10) and tell me what you used.
>
> **No stacking** in this match. Each Hunter has its own dedicated firing tile and target, so damage attribution is unambiguous.

### Bullet paths (sanity check — all friendly-pass-through, no cover in transit)

| Hunter | Path | Notes |
|---|---|---|
| Rifle A → (13, 11) | E from (3, 11) thru (4-12, 11) | clean |
| Rifle B → (15, 11) | E from (5, 11) thru (6-14, 11) | clean (passes through Rifle SD A at 13 — friendly-style pass-through; no damage to wrong target) |
| Burst A → (27, 11) | E from (17, 11) thru (18-26, 11) | passes rough at 23/24 (rough has no transit-cover effect); clean |
| Burst B → (29, 11) | E from (19, 11) thru (20-28, 11) | passes rough at 23/24 + Burst SD A at 27 (pass-through); clean |

The cross-target pass-throughs (Rifle B's bullet through Rifle SD A's tile, Burst B's bullet through Burst SD A's tile) are useful **secondary verifications** — if the wrong SD takes any damage, we've found a contradiction in our "bullets only hit target tile" model.

### Steps

1. Reconnaissance pass: probe (3, 5, 13, 15, 17, 19, 27, 29) on y=11 with Cmd/Alt+click. Adjust any bad tiles ±1 east/west together with their pair partner to keep d=10.
2. **Postures**: before sitting each SD, click the appropriate Tools-panel Height icon:
   - Rifle SD A: Standing (top icon)
   - Rifle SD B: **Ducking** (middle icon)
   - Burst SD A: Standing
   - Burst SD B: **Crouching** (bottom icon)
3. Deploy all 4 SDs and 4 Hunters, walk to assigned positions. Hunters scan East.
4. Each Hunter: click Aim & Fire button → click target tile. **Do this 10 times per Hunter** (no Ctrl+Shift). Each Hunter ends with exactly 10 fire commands queued.
5. End turn → watch movie once at full speed.
6. Ctrl+D Team Data → record final HP for all 4 SDs.

### Yield

```
MATCH 4 (Battle, Rubble Three) — Posture × hit rate at d=10, all 4 pairs

Rifle pair (10 individual Aim & Fires per Hunter):
  Rifle SD A (standing control) at (13, 11):  start 140, damage  140, 126, 108
  Rifle SD B (ducking test)    at (15, 11):  start 140,   damage 140, 119, 100, 86, 68, 49, 35, 15, 0
  Ducking multiplier = (SD B damage) / (SD A damage) = ___

Burst pair (10 individual Aim & Fires per Hunter):
*Fired some before SD were in place*
  Burst SD A (standing control) at (27, 11):  start 120  damage 101, 75, 61, 39, 27, 6, 0
  Burst SD B (crouching test)   at (29, 11):  start 95 (took damage while getting to position)  damage 74, 65, 44, 27, 17, 0
  Crouching multiplier = (SD B damage) / (SD A damage) = ___

Cross-target pass-through verification:
  Rifle SD A took ANY damage from Burst Hunter B? (should be NO) ___
  Burst SD A took ANY damage from Rifle Hunter B? (should be NO) ___
  (Bullets pass through without hitting non-target tiles)
```

### Fallback — if a sample caps out

If standing-control damage approaches the target's HP cap (140 for Rifle, 120 for Burst), the sample is capped and the ratio breaks. Push the whole match to **d=12** (less expected damage):
- All 4 Hunters move 2 tiles further west.
- All 4 SDs stay where they are.
- Distance for each pair becomes 12 instead of 10.

At d=12, expected damage drops ~33% — both Rifle and Burst standing controls survive 10 clicks comfortably.

### Why the ratio works

Within a single weapon pair (control vs test) at the same distance and same shot count, the only differing variable is the target's posture. So:

```
damage_test / damage_control
  = (10 × accuracyTier × distanceFalloff(10) × posture_test × dmg_per_hit)
  / (10 × accuracyTier × distanceFalloff(10) × 1.0          × dmg_per_hit)
  = posture_test
```

Distance falloff, base accuracy, weapon-specific damage, and shot count all cancel. We measure the multiplier directly.

### What this still doesn't validate

- **Whether posture multipliers are weapon-independent** (does Rifle's ducking multiplier match Burst's? Auto's?). Engine assumes yes; if you want to test, swap the postures in a second Match 4 (Rifle vs crouching, Burst vs ducking). Diminishing returns.
- **Cover modifiers** (bush / low wall / wall in path) — defer; defaults are sensible.

---

## Match 5 — Scan-cone hit chance (BLACK vs GREY reticle)

**Goal**: lock the GREY-zone hit chance vs BLACK-zone. You already have 1/6 = 17% at d=5 grey. One more match locks it.

### Setup (Battle or Melee, doesn't matter)

- **Computers**: 1 stationary Rifle SD at **(13, 11)**, standing.
- **Cyborgs**: 1 Rifle Hunter at **(8, 11)** (distance **5** west of SD).
- All other Hunters/SDs: idle in dock.

### Steps

1. Hunter deploys → walks to (8, 11).
2. **BLACK control phase**: scan **East** (target dead-center). **Aim & Fire 5 times** at (13, 11). Verify reticle is **dark/black** while hovering target tile.
3. **GREY test phase**: rotate scan **2 directional units** so target is near cone edge (e.g., E → SE → S). When hovering (13, 11), reticle should be **light/grey**. **Aim & Fire 5 times** at (13, 11).
4. End turn → movie + Ctrl+D to count hits per phase.

### Yield

```
MATCH 5 — Scan-cone hit chance at d=5

BLACK reticle (5 shots, scan dead center):
  Hits: 5 / 5
  Health observed from 140: 123, 103, 83, 66, 45

GREY reticle (5 shots, scan rotated, target on cone edge):
  Hits: 1 / 5
  Damages observed: 26, ___, ___, ___, ___

  Combined grey estimate: 2 / 11 (with the prior 1/6 sample)
```

If grey hits land, also note their **damages** — if similar to black at same distance, scan position only affects hit chance. If grey hits do less damage, scan affects both.

---

## 🟡 Further optional follow-ups

### Match 6 (optional) — Stacked-tile firing

Position 2 enemy robots on the same tile, shoot at the tile, observe whether both take damage or only one. **Default if skipped**: all robots on tile take a damage roll per shot.

### Match 7 (optional) — Radial symmetry / Chebyshev vs Euclidean

Cross-shaped SD layout to test whether missile blast uses king-move or Euclidean distance. **Default if skipped**: Chebyshev.

### Deferred — Stealth / Grenade / Sport modes

Need Custom Game (Stealth class, Grenade-bearing formations) or playtesting. Not blocking v1 engine.

---

## How to send results back

After each match, paste the recording-template block (filled in) and I'll fold the numbers into the engine spec. Numbers I'm watching for:

- `damageMin` / `damageMax` per weapon — from Match 1 + Match 3 (re-validated on open ground).
- `hitRate(distance, posture)` shape per weapon — from Match 1 (standing) + Match 3 (ducking, crouching).
- Missile `blastRadius` and `blastDamageAt(radius)` — locked from Match 2 (radius 0 ≈ 70, radius 1 ≈ 50, radius 2 ≈ 15, radius 3+ = 0).
- Movement step alternation — re-validated on confirmed open ground (Match 3 bonus).
- Weapon max range — locked: **all 18 tiles** from cursor probe.

Matches 1-3 gave the Phase 1 constants enough support to start the engine. They do not settle the Phase 3/4 gates above: projectile timing, moving-target misses, Scan & Fire tracking, scan length, target speed, or arena row data.

---

## Already locked (no further test needed)

- **Weapon max range = 18 tiles** for all weapons (CONFIRMED via DOS cursor probe).
- **Missile blast curve**: r=0 ≈ 70, r=1 ≈ 50, r=2 ≈ 15, r=3+ = 0. blastRadius = 2.
- **No collision system**: robots pass through each other; bullets pass through robots and only hit the target tile.
- **Friendly fire**: bullets don't damage friendlies and don't get blocked by them.
- **Stride parity persists** across non-movement commands (resets only at deployment).
- **Firing arc**: directional cone gated by scan heading; "angle blocked" outside it.
- **Terrain semantics** (from in-game help dialogs): walls = total cover + impassable, low walls = excellent cover + slow + crouch-blocked, bush = on-or-behind cover + slow + crouch-blocked, rough = no cover + vulnerable + slow + crouch-blocked, crevice = impassable but LoS-transparent, open = full speed + no cover.
- **Stealth visibility** (Compute! review): invisible unless moving or scanned from adjacent square.
- **v1 scope**: human-vs-human hot-seat only; no AI. Online lobby is post-MVP.
