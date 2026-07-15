# Reverse-engineering audit

**Audit date:** 2026-07-12  
**Binary:** `ROBO.EXE`, SHA-256
`513E48101C373ECCBFD141D6B54F8B9FAE7559EAA87A01A8757DDB736329A9D4`

## Conclusion

The reverse-engineering work is reproducible and reliable enough to drive the
engine realignment, with one important qualification: several **raw tables and
mechanisms are confirmed while their game-facing labels/inputs remain
provisional**. Implement the confirmed structure now, but do not present the
remaining mappings as exact RoboSport behavior.

## Reproduction performed

- Regenerated `robosport-data.json` from the local binary and three `.TWN`
  files with `tools/re/export_data.py`.
- Before the selector correction, regeneration was byte-identical to the
  existing extract. After fixing live selectors from rows 0..7 to 5..12, the
  corrected regenerated extract has SHA-256
  `DD9FBB63B11C58DFF876466898E39E6AC97EE48C327922AF509E9C39E8FE4A05`.
- Parsed the NE header independently enough to confirm 101 segments, autodata
  segment 101, and the documented segment layout.
- Used the relocation-aware disassembler to inspect the live-fire resolver,
  damage jump tables, blast roller, command-duration lookup, and Euclidean
  distance entry point.
- Added an independent claim-ledger verifier; it currently checks 15 data,
  selector, code-fingerprint, and arena claims without importing the exporter.
- Ran the current baseline: 6 test files / 75 tests pass; strict TypeScript
  typecheck passes.

## Confirmed for immediate engine use

| Mechanic | Evidence checked | Confidence |
|---|---|---|
| Robot accuracy/armor rows | DGROUP `0x0CA8`; extract reproduces `2/140`, `1/120`, `0/100`, `1/100`, `1/120` | CONFIRMED |
| Live-fire threshold table | `seg6:0x3820..0x3837` indexes word table at `0x156E` after `rand & 0xff` | CONFIRMED |
| Hit thresholds | `0,4,8,16,24,32,40,48,64,80,96,112,128,144,160,176,192,208,224,240` over 256 | CONFIRMED |
| Hit score clamp | `seg6:0x37C4..0x37F4` clamps to `0..19` | CONFIRMED |
| Off-aimed-tile penalty | second conditional right shift at `seg6:0x380A`; source trace documented through `seg21:0x0F0A` | CONFIRMED in RE trace |
| Bullet roll families | `seg6:0x384D..0x3876`: `10+(rand&7)`, `8+(rand&15)`, `6+(rand&15)` | CONFIRMED |
| Cover-class damage adjustment | `seg6:0x3878..0x3892`: class 1 `-4`, class 4 `+4`, middle classes `0` | CONFIRMED |
| Distance damage adjustment | `seg6:0x3892..0x389F`: distance `>12 => -4`, `<5 => +4` | CONFIRMED |
| Blast rolls | `seg6:0x5F7E..0x5FFB` uses documented base/mask tables and radii | CONFIRMED |
| Blast reductions | `seg6:0x5FFD..0x6025`: `1/2`, `3/4`, `7/8`, or full | CONFIRMED |
| Weapon-selector command cost | `seg13:0x0947..0x0954` returns byte `[selector*4 + 0x7F5]`; live-fire selectors are `5..12` | CONFIRMED mechanism/table |
| 60-unit parameter timing | `seg13:0x0928..0x0946` multiplies timed command parameters by `0x3c` | CONFIRMED |
| Floored Euclidean distance | `seg56:0x02A0` absolute-delta routine and documented startup isqrt table | CONFIRMED |
| Extracted arena dimensions | `.TWN` INF arrays, including Rubble Two `24x24` | CONFIRMED |

The regenerated live-fire and preview tables match the values printed in
`docs/reverse-engineering.md` exactly.

## Confirmed mechanism, unresolved mapping

These should be table-driven and tagged until the named mapping is traced:

1. **Named weapon -> bullet roll family** (RE §20 #1). The three roll families
   are exact; Rifle/Auto/Burst labels remain inferred.
2. **Named weapon -> selector(s) and fire interval** (RE §20 #10). The previous
   audit incorrectly read rows `0..7`. Live fire uses selectors `5..12`, whose
   exact intervals are `30,30,20,15,20,20,10,10` units. A named weapon may map
   to more than one selector, so “fixed per weapon at only 20/30” was too strong.
3. **Full path sampling around corners/adjacent tiles** (RE §20 #3). The final
   posture/terrain cover table is now decoded, but the trace samples beside the
   Bresenham line as well as the center path; reproduce those edge cases later.
5. **First hit-score halving flag** (RE §20 #2). The shift exists; its gameplay
   meaning remains unknown.
6. **Terrain/weapon additions to hit score.** The disassembly confirms that a
   target-terrain branch uses values at `0x15A2/0x15AA/0x15B2`, while the
   fallback uses a weapon-indexed word table at `0x1596`. The engine plan must
   include that fallback; robot accuracy alone is not the entire term.

## Newly resolved in the focused mapping pass

- Robot posture field `+0x50` uses `1=Upright`, `2=Ducking`, `3=Crouching`.
  There is no need to invent posture heights `4/3/2`.
- The cover classifier's final table is:
  - exposed/open: Upright `4`, Ducking `4`, Crouching `3`;
  - bush/partial height 2: Upright `4`, Ducking `3`, Crouching `2`;
  - low wall/height 3: Upright `3`, Ducking `2`, Crouching `1`;
  - complete wall protection is rejected by the separate LoS gate.
- Selector rows `5..12` at DGROUP `0x7F4` are
  `[category, interval, b2, flag]`:
  `[[3,30,96,0],[3,30,112,0],[1,20,28,0],[3,15,96,0],`
  `[3,20,112,0],[1,20,32,0],[3,10,96,0],[3,10,112,0]]`.
  The zero-damage jump slots are selectors `7` and `10`, matching category `1`;
  category `1` is therefore the explosive path and category `3` the direct-fire
  path for these live selectors. The older opposite label was incorrect.

## Still provisional and phase-gated

- Move alternation and move cost (Phase 1R/2 blocker).
- Deploy, posture-step, and scan-rotation costs (Phase 2 blocker).
- Scan cone hard gate (combat can proceed with a tagged provisional cone; must
  be resolved before claiming parity).
- Scan & Fire trigger/tracking (Phase 4 blocker).
- Arena orientation and Dock/Home metadata (renderer/setup blocker).
- Stealth rule (Phase 4; currently review-derived rather than binary-derived).

## Corrections to apply to existing plans

- The current Phase 2 design's collision winner rule conflicts with the locked
  no-collision/stacking mechanic and must be removed.
- Projectile impacts and Scan & Fire evaluation do not belong in Phase 2; those
  remain Phase 3 and Phase 4 gates.
- The event stream is the derived movie. Replay truth remains initial state +
  seed + turn orders; events may be verified with a digest.
- `tasks/engine-realignment-plan.md` must include the weapon-table fallback in
  the hit-score formula and must not call provisional cover interpolation
  “exact binary truth.”
- `tools/re/export_data.py` had a stale comment naming robot field `+0x5C` as
  the weapon selector even though the code and RE document correctly identify
  the `seg13:0x060E` weapon-property chain.

## Recommended next RE session

Trace only the remaining mappings that unblock Phase 1R/2: named weapon
selectors and command-duration cases. The posture/cover table is resolved; only
diagonal beside-line sampling remains provisional. Stop after the ledger can
mark the remaining mappings CONFIRMED or deliberately PROVISIONAL.
