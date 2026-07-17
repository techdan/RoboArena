# Reverse-engineering audit

**Completion date:** 2026-07-15
**Binary:** `ROBO.EXE`, SHA-256
`513E48101C373ECCBFD141D6B54F8B9FAE7559EAA87A01A8757DDB736329A9D4`

## Conclusion

The original Windows code now supplies the business rules and numerical data
needed for RoboArena's **2-4 Team** Survival combat/resolution core. The four
explicitly provisional areas are closed with path + semantics evidence and
engine boundary tests:

1. named weapon-to-selector mappings;
2. movement, deploy, posture, and scan-heading timing;
3. the exact inclusive scan-cone boundary;
4. diagonal beside-line endpoint-cover sampling.

The completion pass also corrected an earlier audit error: byte 0 of each
four-byte command descriptor is **encoded command-record length**, not a
direct/explosive category. Selectors 7 and 10 are Burst and Automatic group
headers, so their zero direct-damage jump slots are structural—not explosive
classification evidence.

This is a complete audit for the main-game **2-4 Team, four-class** Survival
rules scope, not a claim that every RoboSport feature has been cloned or that
the 2-4 player product/UI is already implemented. RoboArena v1 consumes the
unique-Side free-for-all subset; hot-seat and alliances are v2. The same pass
also closed the remaining Survival-relevant gaps: damage stagger, live-vs-
preview table usage, shooter posture, named explosive categories, Survival
ceremony scoring, row-major arena import, exact generated Home areas, and the
12 fps movie default. Stealth and all non-Survival sport logic are explicitly
post-main-game Phases 14/15 and were not pulled into this audit.

A focused player-count trace then closed the original 3-/4-Team rules. Heap
field `+0x28` is the Side index: direct fire and Scan & Fire exclude same-Side
allies, blasts can damage them, allies are always mutually visible but do not
pool enemy scan contacts/last-known markers, and Final Ceremony contributions
aggregate by Side. Team Name boxes provide non-compacting Home slots and
canonical Team order. Phase 11.6 therefore retains online three-/four-player
free-for-all integration and end-to-end testing gates. The traced alliance
behavior is retained for post-v1 Phase 12, with no known original-code
business-rule gate.

## Reproduction and independent checks

- Re-parsed the NE header: 101 segments; autodata/DGROUP is segment 101.
- Re-read the complete command descriptor table, rows 0..76 at DGROUP `0x07F4`.
- Traced command record decoding, named weapon group mapping, live dispatcher,
  duration lookup, scan-angle predicate, endpoint cover classifier, and Scan &
  Fire acquisition/interval paths.
- Expanded `references/re-claims.json` to schema 2. The independent verifier now
  checks all 77 descriptor rows plus code fingerprints for the semantic paths.
- Regenerated/exported data now names direct-fire rolls and emits exact command
  timing instead of provisional labels.
- Engine transcription has focused tests for mappings, timing, inclusive cone
  edges, y-major diagonal ties, near-diagonal corners, remote non-cover, and
  exact slow-terrain path chunking.

Run:

```powershell
& 'C:\Users\manhe\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' `
  tools/re/verify_claims.py 'RoboSport (1991)/games/RoboSpor/ROBOWIN'
npm.cmd test
npm.cmd run typecheck
```

## Five completed gates

### 1. Named weapon selectors, rolls, accuracy indices, and cadence

`seg14:0x07B4` maps command groups to numeric weapon IDs; strings 605–611 name
those IDs. `seg6:0x4CF2` proves which selectors reach Aim & Fire versus Scan &
Fire handlers. `seg6:0x383B` uses `selector-5` for direct damage and
`seg6:0x3790` uses the same index for the `0x1596` accuracy-add table.

| Weapon | Group | Aim | Scan | Direct roll | Aim/Scan ticks | Aim/Scan accuracy index |
|---|---:|---:|---:|---|---:|---:|
| Rifle | 4 | 5 | 6 | `10+(rng&7)` | 30 / 30 | 0 / 1 |
| Burst | 7 | 8 | 9 | `8+(rng&15)` | 15 / 20 | 3 / 4 |
| Automatic | 10 | 11 | 12 | `6+(rng&15)` | 10 / 10 | 6 / 7 |
| Missile | 13 | 15 | 16 | blast path | 30 / 20 | specialized path |
| Grenade | 17 | 19 | 20 | blast path | 30 / 20 | specialized path |
| Prod | 1 | 2 | 3 | specialized path | table-driven | specialized path |
| Bomb | 21 | 22 | 23 | blast path | table-driven | specialized path |

**Confidence:** SEMANTICS CONFIRMED; ENGINE VERIFIED for v1 catalog fields.

### 2. Movement/deploy/posture/scan timing

`seg13:0x060E` proves descriptor byte 0 is record length. `seg13:0x08C5`
returns byte 1 unless the selector uses a player parameter multiplied by 60.
The live dispatcher and posture enum helpers identify these command groups:

| Command | Selectors | Exact ticks |
|---|---:|---:|
| Absolute scan heading | 24..31 | 5 |
| One-tile move | 41..48 | 30 |
| Two-tile move | 49..64 | 40 |
| Upright / Ducking / Crouching | 70 / 71 / 72 | 10 |
| Deploy | 74 | 120 |

There is no alternating stride cost or persisted stride-parity business state.
Absolute posture and heading changes each consume one fixed command.

**Confidence:** SEMANTICS CONFIRMED; ENGINE VERIFIED.

### 3. Exact slow-terrain movement

The terrain record's movement byte is a three-state classifier: Open Ground is
`2` (full speed), Rough/Bush/Low Wall are `1` (slow/conditional), and blocked
terrain is `0`. `seg87:0x2901` exposes the mode-1 predicate `movement == 2`.
The path compressor at `seg87:0x0BF6..0x0D3D` uses that predicate while
collapsing a unit-step route: it emits a two-tile endpoint only across eligible
entered tiles, and retains the prior waypoint plus a property-1 destination.

Therefore slow terrain has no independent duration multiplier. Entering each
slow tile is a 30-tick one-tile selector, while two eligible Open Ground steps
compress to one 40-tick selector. Mixed and diagonal routes apply the same rule
to the selected unit waypoints; there is no stride state.

**Confidence:** SEMANTICS CONFIRMED by TIL/help labels and path flow; ENGINE VERIFIED.

### 4. Exact scan-cone boundary

The targeting validator `seg76:0x0775` calls `seg21:0x0CCF`; failure produces
status 634, “angle blocked,” before LoS and range checks. The predicate accepts
same-tile and the closed forward semicircle for the robot's eight-way heading.

Equivalent engine rule:

```text
dot(headingVector, target - shooter) >= 0
```

Both exact ±90° rays are legal. A tile one integer step behind either boundary
is illegal. Integer dot product avoids floating-point boundary drift.

**Confidence:** SEMANTICS CONFIRMED; ENGINE VERIFIED.

### 5. Diagonal beside-line endpoint cover

The live fire resolver calls `seg87:0x1BF8`, which computes axis deltas/signs,
chooses x-major only when `dx>dy` (ties are y-major), and enables a corner
sample when `abs(dx-dy)<2`. It calls `seg87:0x1CE0` from both endpoints; target
cover uses the target-side result.

Target-side samples are exactly:

- target tile, always;
- one neighbor toward the shooter on the major axis when distance ≥2;
- the diagonal neighbor toward the shooter when distance >1 and
  `abs(dx-dy)<2`.

Remote intervening low walls do not become target cover merely because the
center line crosses them. Complete walls still fail the separate LoS gate.
The existing terrain/posture output table remains 4/4/3 exposed, 4/3/2 bush,
and 3/2/1 low wall for Upright/Ducking/Crouching.

**Confidence:** SEMANTICS CONFIRMED; ENGINE VERIFIED.

## Other v1-relevant findings retained

- 60 engine ticks/second; default 15-second turn is 900 ticks.
- Slow movement is exact command chunking: Open+Open may cost 40 ticks as a
  double; each entered Rough/Bush/Low-wall tile forces a 30-tick single.
- Floored Euclidean distance; uniform weapon range 18.
- Exact robot accuracy/armor rows and live 20-step hit threshold table.
- Aim & Fire locks hit/damage at fire time; leaving the aimed tile halves score.
- Successful damage assigns 1–4 later firing actions at half hit score; each
  firing action consumes one count. Original field `+0x1E` is stagger, not ammo.
- Shooter posture adds no independent hit/damage modifier; it only participates
  in endpoint cover. Aim passes scan-sight strength 16 (zero penalty); Scan &
  Fire passes the endpoint-inclusive terrain sight value and uses the exact
  `<=4: -4`, `<=8: -2`, otherwise-zero bands.
- Exact bullet and blast rolls, cover/distance damage adjustments, and blast
  cover cuts.
- Grenade creates projectile type 1→blast category 0; Missile type 2→category
  1; Time Bomb type 3→category 2.
- Robots do not collide and may stack; direct bullets do not hit friendly bodies;
  blasts can damage friendlies.
- In 3-/4-Team matches, friendliness is Side-based. Allied robots are always
  visible, but visible-enemy and last-known sets remain private to each Team.
- Scan & Fire remains active for `seconds×60`, reacquires an eligible enemy at
  the named weapon's repeat interval, honors player maximum distance, and adds
  2 to candidate distance only on the exact inclusive cone boundary. Equal
  adjusted distances prefer higher scan-grid sight strength, then canonical
  candidate order.
- Survival ends with the last Side standing. Each Team contributes existing
  score + 150 per survivor + 400 when that Team has any survivor; allied
  contributions are summed and the Side total is shown on every allied row.
- `.TWN` MAP terrain is `tiles[y][x]` without flip/transpose. Homes derive from
  exact per-axis 6/8/12/16 thresholds; Dock is off-field state.
- Original movie choices are 20/15/12/10/6/5/4/3 fps with 12 fps default.

## Explicit scope boundary

- Phase 14 owns Stealth setup, visibility, Scan & Fire interactions,
  gameplay-facing asset use, and tests. Generic Stealth artwork may exist
  earlier, but no Stealth gameplay behavior belongs in Phase 1–11.
- Phase 15 owns Treasure Hunt, Capture the Flag, Hostage, Baseball, their setup
  objects/commands, and their scoring.
- Phase 11.6 owns 3-/4-player online FFA integration, explicit non-compacting
  Home slots, private orders/reconnect, and four-player tests. Phase 12 owns the
  later hot-seat adapter and already-closed alliance semantics.
- AI, complete formation rosters, point-buy source, and extra weapon grants are
  later parity work.
- Exact projectile screen travel speed is a renderer tuning value. Combat
  outcome is locked at fire and the main-game engine does not permit in-flight
  reroll, dodge, or retargeting.
