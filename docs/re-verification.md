# Reverse-engineering verification protocol

The selector-range bug found on 2026-07-12 showed that reading the right bytes
is insufficient: we must also prove that the live code reaches those bytes with
the indices and meanings we claim.

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
- the **reachable live selector rows**, rather than an assumed table start;
- fingerprints for the code slices that establish hit, damage, blast, timing,
  and cover behavior;
- extracted arena dimensions.

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
one input changes and one observable output distinguishes competing mappings:

- one shot per named weapon to map selector, cadence, projectile type, and roll
  family;
- Upright/Ducking/Crouching on open, bush, and low wall to confirm the cover
  table and explosive cuts;
- one- and two-tile moves separated by non-move commands to resolve parity;
- deploy/posture/scan commands read directly from the displayed 60ths clock;
- scan-angle boundary probes at known bearings;
- same setup replayed twice to distinguish game RNG from cosmetic RNG.

Record the exact setup, save/replay artifact when possible, observed clock and
damage values, binary version hash, and which competing hypothesis was rejected.

## Engine transcription gates

Before Phase 1R closes:

- every binary-derived TypeScript table has a matching claim-ledger assertion;
- every provisional named mapping is centralized in `catalog.ts` and tagged
  with its RE §20 item;
- exact transformations have boundary tests (mask maxima, shift truncation,
  score clamps, selector limits, Euclidean diagonals);
- exporter output and independent verifier agree;
- `npm test`, typecheck, and RE verification all pass.
