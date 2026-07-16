# Engine realignment to binary truth — execution plan

**Status:** draft implementation complete; focused RE gates completed 2026-07-15.
`tools/re/verify_claims.py` now checks all 77 descriptor rows plus the named
selector, timing, scan-boundary, and endpoint-cover code paths.

**Goal:** replace the Phase-1 playtest-derived combat model in `src/engine/`
with the exact model read from `ROBO.EXE`. This must land **before Phase 2**
(turn resolver) so no downstream code builds on the old model.

**Ground rules (unchanged):** engine stays pure TS, no `Math.random()`, no
wall-clock, integer arithmetic on game state, pure functions, one-way
dependency. Keep mulberry32 RNG — we do NOT match the original LFSR (RE §3).

---

## Design decisions — LOCKED (do not re-litigate)

Per RE §13 recommendations + spec banner:

1. **Adopt the exact live-fire model** (RE §7b): score → `0x156E` table, wide
   damage roll + adjustments. Delete the 2-zone BLACK/GREY hit model and the
   full/partial damage brackets.
2. **Fire-time resolution**: hit + damage are rolled when the fire command
   resolves; the projectile carries the result. No in-flight dodging. The
   "target no longer on aimed tile → score halved" rule IS in scope.
3. **Distance = floored Euclidean** everywhere (range, damage terms, blast
   radius). `floor(sqrt(dx²+dy²))` — compute with integer inputs; `Math.sqrt`
   + `Math.floor` is fine (deterministic across platforms for these magnitudes;
   add a test asserting the 32×32 table values match RE §4 examples).
4. **Keep 3 postures**: Upright / Ducking / Crouching (RE §14). The focused
   trace resolved the stored values as 1/2/3 and the final terrain/posture cover
   table; do not synthesize 4/3/2 posture heights.
5. **Cover = height-based LoS** producing `coverClass 1..4` (RE §15). Replaces
   flat per-terrain cover %.
6. **Clock = 60 units/s.** Turn budget 15 s = 900 units.

## Preflight — resolve or classify the mappings

Before Step 1, attempt the focused traces for weapon labels/fire costs, cover
class/posture mapping, and action costs. Anything still unresolved must be
isolated in a table and tagged `PROVISIONAL RE §20 #N`. Do not bury a guess in
control flow.

## Sequencing (tests and typecheck green at each stable boundary)

### Step 1 — `constants.ts` + `types.ts`
- `TICKS_PER_SECOND`: 20 → **60**. Rename tick-derived constants if misleading.
- Add `WEAPON_MAX_RANGE = 18` (already?), `TURN_SECONDS = 15` → 900 units.
- Exact action costs: one-/two-tile move 30/40 (no parity), deploy 120,
  absolute posture 10, absolute scan heading 5.
- Named Aim/Scan timing: Rifle 30/30, Burst 15/20, Automatic 10/10, Missile
  30/20, Grenade 30/20.
- Types: `Posture = "upright" | "ducking" | "crouching"`; stored posture enum
  is 1/2/3. Terrain heights from TIL b0:
  open/rough/bush/crevice = 2, lowWall = 3, wall = 4.
- Add terrain type `fence` to the enum ONLY if trivially accommodated;
  otherwise add a `// RE §20 #11 fence deferred` note. Fence mechanics (chance
  to strike in transit) are NOT in this task's scope.

### Step 2 — `geometry.ts`: distance
- Add `floorEuclidean(a, b)`. Replace `chebyshevDistance` usages in range
  checks, firing, blast. Keep `chebyshevDistance` exported only if the stealth
  adjacency rule (spec §7, adjacent = Chebyshev ≤ 1) needs it; otherwise delete.
- Tests: axis-aligned dist == both metrics agree; (13,13) → 18 in range;
  (18,18) → 25 out of range; (18,0) → 18 (RE §4).

### Step 3 — `firing.ts`: hit model
Replace zone model with (RE §7b, all exact):

```
HIT_TABLE = [0,4,8,16,24,32,40,48,64,80,96,112,128,144,160,176,192,208,224,240] // /256, score 0..19
coverInit = {1: 4, 2: 8, 3: 12, 4: 18}          // coverClass → base score
score += distance ladder:
  dist > 12:  + floor(base/2) - 4
  7..12:      + base - 2
  3..6:       + floor(base/2) + (6 - dist)
  0..2:       + base + 2*(3 - dist) + 2
  where base = accuracyTier + 4  (Rifle 2, Burst/Missile/Stealth 1, Auto 0)
score += target terrain: rough +2, (cover tiles -1/-3 per RE — map bush -1, lowWall -3)
  otherwise add weaponAccTable[weaponKind] from DGROUP 0x1596
score -= scan sight strength: <=4 => 4, <=8 => 2, otherwise 0 (Aim passes 16)
score = clamp(score, 0, 19)
if damage-stagger count > 0: score >>= 1; consume one count per firing action
if target not on aimed tile at resolution: score >>= 1   // RE §15, confirmed
hit = rngInt(0,255) < HIT_TABLE[score]
```

The formerly unnamed argument is Scan & Fire's terrain-derived scan-grid sight
strength, not posture or geometric alignment. The first halving flag is the
confirmed 1–4-action damage-stagger counter (`+0x1E`).

`resolveFire` must receive the aimed tile separately from the actual target
robot/tile. The occupancy penalty compares those values at fire-resolution
time; it is not an in-flight projectile check.

### Step 4 — `firing.ts` / `catalog.ts`: damage model
Replace brackets with (RE §7b, rolls and labels exact):

```
weaponRoll: Rifle = 10 + rngInt(0,7)   // 10–17
            Burst = 8  + rngInt(0,15)  // 8–23 per bullet, 3 bullets
            Auto  = 6  + rngInt(0,15)  // 6–21
postureAdjust by coverClass: {1: -4, 2: 0, 3: 0, 4: +4}
if dist > 12: -4 ;  if dist < 5: +4
dmg = max(0, si)
```

The labels are confirmed by `seg14:0x07B4` + `seg6:0x4CF2`.

### Step 5 — `blast.ts`: exact tables + Euclidean radius
- radius = `floorEuclidean(center, robot)` (was Chebyshev).
- Tables (RE §7, exact; `dmg = base + rngInt(0, mask)` then × posture cut):

```
cat0 grenade:  base [45,25,5],           mask [31,15,7]
cat1 missile:  base [60,40,10],          mask [31,15,7]      // ship this in v1
cat2 bomb/zap: base [120,80,40,20,10],   mask [31,31,31,15,7] // catalog only, unused v1
postureCut by coverClass: {1: 0.5, 2: 0.75, 3: 0.875, 4: 1.0}
  — implement as integer ops: >>1 ; x - (x>>2) ; x - (x>>3)
```

- Index beyond table length → 0 damage. Missile radius = 2 effective.

### Step 6 — cover model (`geometry.ts` or new `cover.ts`)
Endpoint cover classification returns `coverClass 1..4` (RE §15). The decoded
final mapping is:

| obstruction | Upright | Ducking | Crouching |
|---|---:|---:|---:|
| open/exposed | 4 | 4 | 3 |
| bush / partial height 2 | 4 | 3 | 2 |
| low wall / height 3 | 3 | 2 | 1 |

Wall (4) is fully blocked by the separate scan-sight gate. Point-blank defaults to class 4.
Implement the table exactly. Target cover samples the target, the major-axis
neighbor toward the shooter at distance ≥2 (y-major ties), and the corner
neighbor only when distance >1 and `abs(dx-dy)<2`.

### Step 7 — arenas + spec sync
- Rubble Two: 25×25 → **24×24** (RE §10). MAP grids import row-major as
  `tiles[y][x]`; homes use the exact generated 6/8/12/16 spans (RE §12).
- Update `docs/spec.md` in the same pass: replace corrected sections (distance,
  clock, hit, damage, blast, postures, fire rate), remove the "corrections
  pending" banner, keep 🟨/🟥 flags on still-provisional constants mirroring
  RE §20 numbering.

### Step 8 — test rewrite guidance
- Delete zone-model tests (`BLACK zone`, `GREY ≈ 0.2`) and bracket tests.
- Prefer **exact** assertions over statistical ones: seed the RNG and assert
  specific rolls; assert table lookups directly (score 19 → 240; score 8 → 64).
- Keep one statistical sanity test per roll (e.g. rifle damage ∈ [10,17]
  over 1000 samples, mean ≈ 13.5 ± tolerance).
- Add the RE §4 distance examples as fixtures.
- Determinism test stays: same seed → identical event stream.

## Explicitly OUT of scope
- Fence mechanics, Grenade/TimeBomb/Zap gameplay, sport modes beyond Survival,
  formation rosters, stealth changes,
  scan-sight/acquisition changes inside the confirmed closed ±90° hard gate, Phase 1.5
  toolchain.

## Acceptance
- `npm test` green; `npm run typecheck` green.
- No `chebyshev` in firing/blast paths (grep).
- `TICKS_PER_SECOND = 60`; all cost constants integers.
- Every provisional constant carries a `RE §20 #N` comment.
- spec.md and constants.ts agree (code wins).
- Hit scoring includes the `0x1596` weapon-table fallback for target terrain
  values outside 1/2/3.
