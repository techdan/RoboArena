# Reverse-engineering verification protocol

The selector-range bug found on 2026-07-12—and the command-byte semantic
correction on 2026-07-15—show that reading the right bytes is insufficient: we
must prove that live code reaches them with the indices and meanings claimed.

## Confidence levels

Use these labels literally:

1. **BYTES CONFIRMED** — a value is reproduced at a version-locked offset.
2. **PATH CONFIRMED** — call sites, argument flow, selector range, and branch
   reachability show how the live game uses those bytes.
3. **SEMANTICS CONFIRMED** — the code path is mapped to a named game concept,
   supported by strings/UI/manual or a controlled original-game test.
4. **ENGINE VERIFIED** — a focused TypeScript test checks the transcribed value
   and the implemented transformation.

Only levels 2–4 may be summarized as `CONFIRMED` without a qualifier. A raw
table with unresolved labels must say `BYTES CONFIRMED / MAPPING PROVISIONAL`.

## Automated checks

Run the independent verifier:

```powershell
& 'C:\Users\manhe\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' `
  tools/re/verify_claims.py 'RoboSport (1991)/games/RoboSpor/ROBOWIN'
```

It does not import the exporter. It independently verifies:

- exact `ROBO.EXE` SHA-256;
- NE segment count and dynamically derived DGROUP location;
- committed data claims and encodings;
- all **77 command descriptor rows**, not only a presumed live-fire range;
- fingerprints for the code slices that establish hit, damage, blast, timing,
  command-record decoding, named weapon mapping/dispatch, the hard scan gate,
  endpoint cover sampling, damage stagger, named blast dispatch, Survival
  scoring, row-major arena access, home-area derivation, movie FPS, Scan & Fire
  behavior, terrain movement classification, and slow-terrain path chunking;
- extracted dimensions for all Rubble, Suburbs, and Computer Town arenas.

The claim ledger is `references/re-claims.json`. Every new engine-relevant
binary claim should be added there before being called confirmed.

## Static-analysis review checklist

For every new table or constant:

1. Locate all readers, not only the table.
2. Trace the index/selector backward to its producer.
3. Record the reachable index range at the gameplay call site.
4. Decode jump-table targets and default/out-of-range behavior.
5. Identify RNG consumption order and mask/reduction semantics.
6. Trace the result forward to state mutation or projectile/event creation.
7. Cross-check the proposed name against resource strings, help text, UI fields,
   struct context, and at least one empirical observation when feasible.
8. Have a second pass reproduce the trace without relying on the prose summary.

## Dynamic differential tests

Static analysis cannot safely name every argument. Use small DOSBox tests where
one input changes and one observable output distinguishes competing mappings.
The first four items below are now static-path and engine verified; retain them
as optional differential regression tests rather than audit blockers:

- one shot per named weapon to regress selector, cadence, projectile type, and
  roll family;
- Upright/Ducking/Crouching on open, bush, and low wall to confirm the cover
  table and explosive cuts;
- one- and two-tile moves separated by non-move commands to confirm fixed costs
  and absence of parity;
- mixed Open→Rough/Bush/Low-wall→Open routes to regress that slow entries retain
  30-tick single selectors rather than receiving a numeric multiplier;
- deploy/posture/scan commands read directly from the displayed 60ths clock;
- exact perpendicular and just-behind scan-angle probes;
- same setup replayed twice to distinguish game RNG from cosmetic RNG.

Stealth and non-Survival sport logic are intentionally outside the main-game
audit. Add their claims only when post-main-game Phases 14/15 begin; do not make
their absence block the online free-for-all Survival build.

Three-/four-player online FFA remains a separate Phase 11.6 implementation
gate, but the full original 2-4 Team trace is closed. Re-verification must
preserve the code
fingerprints for Side-based direct/Scan fire, blast friendly damage, allied
robot visibility with per-Team enemy contacts, Side-aggregated ceremony totals,
and non-compacting Team Name box/Home slots for the post-v1 alliance phase too.

Record the exact setup, save/replay artifact when possible, observed clock and
damage values, binary version hash, and which competing hypothesis was rejected.

## Engine transcription gates

Before Phase 1R closes:

- every binary-derived TypeScript table has a matching claim-ledger assertion;
- every still-provisional mapping is isolated and tagged with its RE §20 item;
- the named v1 weapon mappings and action timings have catalog/constants tests;
- scan-angle tests include exact boundaries for cardinal and diagonal headings;
- cover tests include y-major ties, near-diagonal corner inclusion, and
  non-near-diagonal corner exclusion;
- exact transformations have boundary tests (mask maxima, shift truncation,
  score clamps, selector limits, Euclidean diagonals);
- damage-stagger tests halve the next 1–4 firing actions and consume one count
  per action, not per burst bullet;
- exporter output and independent verifier agree;
- `npm test`, typecheck, and RE verification all pass.
