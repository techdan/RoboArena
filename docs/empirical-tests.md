# Empirical Test Cases — DOS RoboSport

Goal: dynamically cross-check rules that remain ambiguous after static analysis.
The 2026-07-15 binary completion pass supersedes the earlier timeline readings
below where they conflict with the command descriptor and live dispatcher.

For each test:
1. Set up the scenario in a Custom Game (Survival, Beginner formation, Melee length, Rubble Town).
2. Use 2 teams with **human Brains** so you control both sides.
3. Note timeline timestamps to 0.05 s precision.
4. For damage/RNG tests, run the same scenario **at least 5 times** (different seeds via reset) and tally outcomes.
5. Report results back into `docs/spec.md` for current mechanics, or `docs/priority-tests.md` / a new `docs/empirical-results.md` for raw research notes.

---

## Already confirmed (no need to re-test)

- Movement command cost: **30 ticks per one-tile command / 40 ticks per two-tile command**; no parity.
- Deployment cost: **2.0 s**.
- Any absolute posture change: **10 ticks (1/6 s)**.
- Any absolute scan-heading change: **5 ticks (1/12 s)**.
- Crouch traversal: only flat/grass; blocked by low walls, bushes, rough ground, crevices, fences.
- Standing vs ducking traversal: identical (no terrain restriction).
- Turn budget: **15.0 s hard cutoff** (planner shows overflow greyed out).
- Arena (Melee): **24 × 24**.
- Movie playback: 12 fps.

---

## P0 — Engine blockers

### T1. Movement timing regression (resolved statically)

Optional DOS regression only. The binary has fixed 30/40-tick movement
selectors and no stride-parity state; the former alternatives are rejected.

- **T1a**: Move 1 tile (cost 0.3) → change posture (cost 0.1) → move 1 tile. Is the next move 0.3 or 0.7?
- **T1b**: Move 1 tile (0.3) → scan rotate 1 step (0.05) → move 1 tile. 0.3 or 0.7?
- **T1c**: Move 1 tile → wait/idle for some time → move 1 tile. Same?
- **T1d**: Robot enters Playing Field (deploy 2.0 s) → first step. Is it 0.3 or 0.7?

**Resolved:** no `strideParity` exists; retain these only to diagnose the old
timeline-reading discrepancy if desired.

### T2. Aim & Fire timeline cost

- **T2a**: Single Aim & Fire shot at adjacent enemy. Time consumed?
- **T2b**: Single Aim & Fire at max range. Time consumed?
- **T2c**: Aim & Fire with each weapon (Rifle / Burst / Auto / Missile / Grenade). Per-weapon costs?
- **T2d**: Repeat-fire (Alt+click) with Rifle, 3 shots. Time per shot?
- **T2e**: Repeat-fire with Missile, 3 shots. Time per shot? Stops when out of ammo?

### T3. Scan & Fire timeline cost

- **T3a**: Scan & Fire with default settings, no enemy ever enters range. Does the full "Seconds" budget elapse?
- **T3b**: Scan & Fire with enemy entering at the 2-second mark of an 8-second budget. Does it cut off when fired, or run the full 8 s and fire automatically?
- **T3c**: Multiple enemies enter range during Scan & Fire. Does it shoot each one once, or focus on one?
- **T3d**: Min vs max distance settings — does the time cost change with the distance setting?

### T4. Damage values per weapon

Park a target in the open with known armor (use 140-armor Rifle robot):

- **T4a**: Aim & Fire with Rifle, 1 shot. Did it hit? If yes, how much damage (check Team Data)?
- **T4b**: Repeat until destroyed. Total shots to kill 140 armor?
- **T4c**: Same with Burst / Auto. Shots-to-kill?
- **T4d**: Single Missile direct hit on 140 armor. Damage / shots-to-kill?
- **T4e**: Single Grenade direct hit. Damage?

### T5. Hit accuracy vs distance

Same Rifle shooter, same Rifle target (standing, open ground):

- **T5a**: Distance 2 tiles, 10 shots. Hit count?
- **T5b**: Distance 8 tiles, 10 shots.
- **T5c**: Distance at max range (just inside the dialog's max), 10 shots.

The pointer-color hint (dark sight = optimum, light sight = low accuracy) suggests there's a sharp falloff — try to find where it switches.

### T6. Hit accuracy vs posture

Distance fixed at mid-range; vary target posture:

- **T6a**: Target standing. 10 shots, hit count.
- **T6b**: Target ducking. 10 shots.
- **T6c**: Target crouching. 10 shots.

### T7. Cover damage reduction

Target with known posture (standing); vary cover between shooter and target:

- **T7a**: No cover. 10 shots.
- **T7b**: Bush in line of fire. 10 shots, count hits + damage per hit.
- **T7c**: Blue crate in line of fire. 10 shots.
- **T7d**: Low wall in line of fire. 10 shots.

Tells us whether cover reduces hit chance, reduces damage on hit, or blocks LoS entirely.

### T8. Missile blast radius — falloff curve in one shot

**Layout** (Sitting Ducks stationary on open ground, all standing):

| Robot | Coord | Radius from impact |
|---|---|---|
| Rifle SD | (10, 12) | 0 — impact tile |
| Burst SD | (11, 12) | 1 |
| Auto SD | (12, 12) | 2 |
| Missile SD | (13, 12) | 3 |

Hunter Missile bot at e.g. (10, 19) facing N. Aim & Fire at **(10, 12)**.

After the turn, Ctrl+D and compute `armor − HP` per Sitting Duck → that's the per-radius damage. With 3 missile rounds available, fire all 3 at the same impact tile across 3 turns to get min/max/avg per radius.

### T8b. Optional radial-symmetry / diagonal-vs-Euclidean check (1 match)

| Robot | Coord | Direction |
|---|---|---|
| Rifle SD | (12, 12) | impact |
| Burst SD | (12, 11) | 1 N (cardinal) |
| Auto SD | (13, 12) | 1 E (cardinal) |
| Missile SD | (13, 11) | 1 NE (diagonal) |

Hunter Missile fires at (12, 12). Burst SD and Auto SD damage values should be equal (cardinal symmetry); Missile SD's value vs theirs distinguishes Chebyshev (equal) from Euclidean (less). Default to Chebyshev if skipped.

### T8e. Grenade blast (only if Custom Game / formation includes Grenade)

Same layout as T8. Replace Hunter Missile with Grenade Launcher.

### TEST V — Damage validation (REPLACES informal T4) — *highest priority*

The earlier Rifle / Auto / Burst damage numbers were measured non-systematically (multiple shooters, mid-distance, small samples). This test cleanly isolates one shooter against one target per pair, with all 4 weapon pairs measured in **a single match** (independent because there are no collisions).

**Setup — Match V1: Point-blank damage baseline**

1. Quick Start, Beginner, Melee, Rubble. Two **Human-Brain** teams.
2. **Sitting Ducks**: place all 4 robots stationary on open ground, spaced at least 4 tiles apart from each other so blasts don't bleed:
   - Rifle target at, e.g., (8, 8)
   - Burst target at (16, 8)
   - Auto target at (8, 16)
   - Missile target at (16, 16)
3. **Hunters**: pair each Hunter with the *opposite* Sitting Duck (i.e., Hunter Rifle shoots at Sitting Duck Rifle). Move each Hunter to **distance 1** (one tile away — point-blank but not stacked).
4. Each Hunter: **repeat-fire (Ctrl+Shift)** at the target's tile for the rest of the turn.
5. End turn. Watch the movie once for atmosphere.
6. **Ctrl+D Team Data** at end of turn. Record each Sitting Duck's remaining HP.
7. Replay the movie and pause at each hit on each target — record the **per-shot damage values** (HP delta between pauses). Aim for 5+ samples per weapon.

**Yield (single match):**

| Weapon | Total damage | Hits in turn | Per-hit damage range | Avg |
|---|---|---|---|---|
| Rifle | 140 − Rifle_target.HP | (count Ha/Ow/Aaargh bubbles in Rifle target's column) | min, max from movie pauses | total ÷ hits |
| Burst | 120 − Burst_target.HP | (count) | … | … |
| Auto | 100 − Auto_target.HP | (count) | … | … |
| Missile | 100 − Missile_target.HP | (count) | … | … |

This gives **damage baseline per weapon** at near-100% hit rate (point-blank).

If a target dies before the turn ends, you still have its full HP-delta = total damage from N hits before kill. That's enough.

**Setup — Match V2: Mid-range hit-rate validation**

Same setup, but move all 4 Hunters to **distance 6** before they start firing. Repeat-fire for the rest of the turn.

**Yield:**
- HP delta per target → total damage at mid-range.
- Combined with V1's per-hit damage, hit rate at d=6 = `(V2 total ÷ V1 avg per hit) ÷ (shots fired)`.
- Compare across weapons: locks the 3-tier accuracy model (Rifle High, Burst/Missile Medium, Auto Low) with one quantitative anchor.

**Why this is more trustworthy than the first round:**
- One shooter ↔ one target per pair (no cross-attribution).
- Same posture, same terrain, same distance for all measurements.
- Many shots per pair (point-blank repeat-fire = 20–30 shots per Rifle, 40+ per Burst).
- Two distances cover the whole accuracy curve enough to fit the `baseTier × max(0.1, 1 − D × falloffTier)` formula.

**Estimated time**: 2 matches × 10 min including movie review = ~20 minutes.

---

### T9. Collision rules (RESOLVED — no collision system)

User-confirmed: robots pass through each other freely and can stack on the same tile. T9a–T9e (same-destination / swap / follow / chain / cycle) are no-ops; engine has no conflict-resolver.

**Remaining sub-test:**

- **T9f — Stacked-tile firing**: position 2 robots on the same tile (one of them yours, one enemy). Aim & Fire at that tile with Rifle.
  - Does both robots take damage per shot, or just one?
  - If just one, which? (your robot? enemy? oldest? random?)
  - Log damage to each robot in Team Data after the turn.

### T10. Friendly fire (line-of-sight blocking)

- **T10a**: Friendly robot stands in line between Rifle shooter and enemy. Does the bullet pass through, hit the friendly (no damage but stops), or miss the enemy?
- **T10b**: Same with Missile (already known to harm friendlies — measure damage).

### T11. Stealth visibility — POST-MAIN-GAME PHASE 14

Do not run this as a main-game blocker. Resume only after the Phase 11 complete
Survival match and Phase 14 begins.

Use 4-team Custom Game (Stealth in one team's roster):

- **T11a**: Stealth stationary at distance 5 from observer. Visible?
- **T11b**: Stealth stationary at distance 1 (adjacent). Visible?
- **T11c**: Stealth moving at distance 5. Visible?
- **T11d**: Stealth in someone's Scan & Fire range, stationary, distance 4. Does Scan & Fire trigger?
- **T11e**: Stealth becomes adjacent during a turn, stationary the whole time. When does it become visible — only during the adjacent tick, or for the whole turn after?

---

## P1 — Fidelity refinements

### T12. Scan geometry

Figure out the shape and range of the scan box:

- **T12a**: Park enemy at varying angles from the scan-direction center. Where does it fall out of view?
- **T12b**: Enemy at increasing distances along the scan center axis. At what range does visibility end?
- **T12c**: Wall between observer and enemy. Does the scan see through? (Should not, for opaque walls.)

### T13. Last-known X markers

- **T13a**: Spot enemy in scan range, then enemy moves out of sight. Does an X appear at the last-seen tile? When does it appear (end of turn? mid-turn movie?)?
- **T13b**: Multiple turns: do old Xs disappear when a new one is placed?

### T14. Sides / alliance semantics

**CLOSED STATICALLY.** The executable resolves the 4-team/2-per-Side cases:

- **T14a**: direct fire and Scan & Fire skip same-Side A2.
- **T14b**: missile/grenade blast damage still applies to same-Side A2.
- **T14c**: allied robots are always visible, but A2 does not inherit A1's
  visible-enemy contacts or last-known markers.
- **T14d**: each Team contributes points, then every allied Team row receives
  the aggregated Side total.

Keep this setup as an optional end-to-end regression for Phase 11.6, not as a
remaining research blocker.

### T15. Per-formation weapon loadouts

Open Custom Game in each formation, look at default rosters:

- **T15a**: Standard formation — robot count? classes? secondary weapons?
- **T15b**: Fire Fight — same questions.
- **T15c**: Missile Fest — same.
- **T15d**: Beat the Clock — what's the turn time? roster?

### T16. Arena dimensions per Game Length

For each Game Length, start a match and check the coordinate range:

- **T16a**: Skirmish — arena W×H?
- **T16b**: Battle — W×H?
- **T16c**: Campaign — W×H?

Compare to confirmed Melee = 24×24.

### T22. Slow-terrain step costs — CLOSED STATICALLY

There is no 0.3/0.7 alternation or terrain multiplier. The original path
compressor pairs two entered Open Ground tiles into a 40-tick two-tile command.
Rough, Bush, and Low Wall carry movement property 1 rather than full-speed 2,
so the compressor retains each as a 30-tick one-tile waypoint. Two consecutive
slow entries cost 60 ticks. Mixed and diagonal routes use the same selected
unit-waypoint rule (`seg87:0x2901`, `0x0BF6..0x0D3D`).

T22a-d remain optional display-clock regressions, not audit blockers.

### T23. Rough Ground "vulnerable" modifier

Help text: "Rough ground makes a robot vulnerable to attack."

- **T23a**: Park target on rough ground vs same target on open ground at the same distance, same posture. Fire 10 Rifle shots each. Compare hit count and damage.

### T24. Cover stacking and "on or behind" semantics

- **T24a**: Target standing on a bush. 10 Rifle shots from open ground. Hit/damage.
- **T24b**: Target standing on open ground, with bush between shooter and target. 10 shots.
- **T24c**: Target standing on open ground, with low wall between shooter and target. 10 shots.
- **T24d**: Target on bush AND low wall in the line. Cover stack?

### T17. Combat speech-bubble taxonomy

While running other tests, log every speech-bubble string you see:

- "Ha!" / "Aaargh!" already confirmed.
- Any others? (Spotted? Surrendered? Low health? Out of ammo?)

### T18. Aim & Fire on a moving target

- **T18a**: Aim & Fire at coords (X,Y). Target moves to (X+3, Y) before the shot lands. Does the bullet hit (X,Y) or track the target?

(Original is almost certainly fixed-target — just lock down behavior.)

---

## P2 — Polish, can wait

### T19. Sport-mode rules (only if testing modes other than Survival)

- **T19a — Treasure Hunt**: where do treasures spawn? scoring?
- **T19b — Hostage**: how is rescue performed? what command is used?
- **T19c — Capture the Flag**: flag positions? scoring?
- **T19d — Baseball**: bases? scoring?

### T20. AI tier observation

- **T20a**: Watch a Stupid AI play 2–3 turns. Note movement/firing patterns.
- **T20b**: Higher formations — does the AI label change to "Smart" or similar?

### T21. Final Ceremony scoring

- **T21a**: Win a Survival game; record the points + bonus breakdown shown.
- **T21b**: Show Stats — what fields are displayed per team?

---

## How to report results

After each test, append raw findings to `docs/priority-tests.md` or create `docs/empirical-results.md` with one bullet per test. If the result changes the current model, update `docs/spec.md` and the relevant engine tests in the same change. Include:

- Test ID (e.g. `T2a`)
- Setup (who, where, what postures/weapons)
- Observed result (timestamps, damage values, hit/miss counts)
- Trial count for stochastic tests
- Any surprises that contradict the plan
