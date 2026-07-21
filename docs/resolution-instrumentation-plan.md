# Resolution & Playback Instrumentation Plan

> **Status:** ⬜ NOT STARTED — approved plan, implement later.
> **Scope:** developer-facing instrumentation to verify turn resolution and movie
> playback. Not a gameplay feature; the visual surface lives behind `/dev/` and is
> never linked from the game UI.
> **Related:** `docs/spec.md` §8 (resolver) / §10 (replay); `docs/implementation-plan.md`
> Phase 5, Phase 8, Phase 11.5; `docs/priority-tests.md`.
> **Build order:** Phase 0 → 1 → 2 → 3 → 4, each independently committable.

## Context

You can evaluate the planner by eye, but once you press resolve the turn becomes a
black box: a movie plays and there is no way to confirm that what you watched is what
the engine actually computed. Two distinct failure classes hide in that box:

1. **Engine-resolution bugs** — `resolveTurn` produces wrong events/state for given orders.
2. **Playback-fidelity bugs** — the engine is right, but the movie you watch disagrees
   with engine truth.

A key finding reshapes the effort: **the engine's determinism is already triple-checked
in production.** `server/matches.ts` `resolvePendingTurn` resolves a turn once, then
`createReplayLog` re-resolves it, then `verifyReplay` re-resolves *again* and byte-compares
events + `nextStateDigest` before committing. So "is a single resolve reproducible and
self-consistent?" is already guaranteed on every real turn. The genuine gaps are:

- **Legibility** — nothing lets you *see* the authoritative per-tick state, the full
  (un-redacted) event stream, or the RNG draws. The only existing inspector
  (`EventInspector`/`explainEvents`) shows the *redacted, player-facing* log.
- **Playback fidelity** — the movie is rebuilt by *folding events*, and that fold exists
  **three independent times** (`snapshotState` in the resolver, `updateRobotState` in
  `server/view.ts`, `applyMovieEvent` in `src/renderer/animations.ts`). The engine's
  ground-truth `nextState` never reaches the client, and only one weak test
  (`animations.test.ts:28`, **position-only**) checks the fold against truth.
- **Breadth + semantics** — digests catch drift but not *meaning*: they won't tell you hp
  went negative, a dead robot fired, or a robot stands on a wall. And nothing exercises the
  engine across many seeds/scenarios.

**Goal:** produce plenty of analyzable data — a visual authoritative turn inspector *and*
headless trace/fuzz tooling — so you can confirm resolution and playback are behaving as
expected, and localize any bug to a tick, a robot, and RNG-vs-logic.

## Approach

Two inspection surfaces over one shared **trace core**:

- **Visual dev route** (`/dev/trace`) — plays the *authoritative, all-teams, un-redacted*
  turn using the existing PixiJS renderer, with a synced event log, a per-tick state table
  (hp / position / posture / heading / ammo / stagger for every robot), RNG draw counts,
  and running digests. Exportable as JSON. It renders from authoritative per-tick state, so
  it doubles as a by-eye fidelity oracle against the production (event-fold) movie.
- **Headless tooling** (`tools/`) — a turn-trace dump, a full-match fuzz harness with
  semantic invariants, and a golden-replay regeneration script. Emits JSON for analysis.

**Overriding constraint — instrumentation must be observational only.** The engine RNG is
a single linear stream per turn (draw order == resolution order); anything that perturbs
draw order or event order is itself a bug. Every hook is behind an optional `trace?` sink,
guarded so that when it is absent the production path is **byte-identical**. This is proved
by a test (`trace.test.ts`), not asserted.

The work is split into independently-committable phases (respecting the repo's "break large
tasks into smaller ones" rule). Build order is 0 → 1 → 2 → 3 → 4; each phase is useful alone.

---

### Phase 0 — Enablers (~15 min)

- **Edit `src/engine/replay.ts`** — add `export` to `digest`, `digestState`, and
  `serializeState` (currently module-private). No behavior change; lets tooling and tests
  digest states without re-implementing FNV-1a. Do **not** import these into `resolver.ts`
  (replay.ts already imports resolver.ts — would create a cycle); digest on the caller side.
- **New `src/engine/trace.ts`** (leaf module; type-only imports of `./rng`, `./types` — no
  cycle):
  ```ts
  export interface RngDraw { readonly ordinal: number; readonly value: number; readonly tick: number; readonly phase?: string; }
  export interface TurnTraceEntry {
    readonly tick: number;
    readonly label: "open" | "bootstrap" | "tick" | "final";
    readonly rngState: number;    // rng.snapshot()
    readonly drawsSoFar: number;  // derived from rngState (see helper)
    readonly eventCount: number;  // events.length so far
    readonly state: MatchState;   // authoritative working state (snapshotState())
  }
  export interface TurnTraceSink { onTick(e: TurnTraceEntry): void; onRngDraw?(d: RngDraw): void; }
  export const createRecordingRng: (inner: Rng, onDraw: (value: number) => void) => Rng;
  // wrapper: nextUint32 logs+delegates; next/intInRange/chance reimplemented over the wrapper's
  // own nextUint32 (identical values to rng.ts, so every draw is logged, zero behavior change);
  // snapshot/restore delegate to inner.
  export const drawsBetween: (before: number, after: number) => number;
  // mulberry32 advances state by a constant 0x6d2b79f5 per draw (verified rng.ts:41), which is
  // odd => invertible mod 2^32. draws = ((after - before) * modInverse(0x6d2b79f5)) >>> 0.
  // This yields exact per-tick draw counts from snapshots alone — no rng wrap, no perturbation.
  ```

---

### Phase 1 — Trace core + both inspectors

**Trace hook in `src/engine/resolver.ts`** (the only hot-path edit; must stay byte-identical when untraced):
- Add `readonly trace?: TurnTraceSink;` to `ResolveTurnInput` (`resolver.ts:68`). Backward-compatible — every existing caller omits it.
- After `const rng = createRng(input.seed)` (`resolver.ts:256`): keep the raw rng; if
  `input.trace?.onRngDraw` is set, wrap via `createRecordingRng`. Add inert locals
  `let currentTick = 0;` and a draw ordinal.
- Add `const traceBoundary = (tick, label) => input.trace?.onTick({ tick, label, rngState: rng.snapshot(), drawsSoFar: drawsBetween(seed0, rng.snapshot()), eventCount: events.length, state: snapshotState() });`
  (`snapshotState` at `resolver.ts:790` is in scope). `snapshot()`/`snapshotState()` neither
  advance RNG nor mutate.
- Call sites: `traceBoundary(0,"open")` before the bootstrap (`~843`); `traceBoundary(0,"bootstrap")`
  after it (`~851`); `currentTick = tick` at the top of the loop body (`~854`);
  `traceBoundary(tick,"tick")` at the end of the loop body (after `994`);
  `traceBoundary(turnDuration,"final")` before the `nextState` build (`~1019`).
- **Determinism-safety:** when `trace` is `undefined`, every added line is a `?.` no-op plus
  two unused local assignments that never touch `rng`/`events` → production path byte-identical.

**New `src/engine/traceTurn.ts`** (imports resolver + trace; resolver does not import it — no cycle):
```ts
export interface TracedTurn { readonly result: ResolveTurnResult; readonly ticks: TurnTraceEntry[]; readonly draws: RngDraw[]; }
export const traceTurn: (input: ResolveTurnInput) => TracedTurn;  // collects sink output into arrays
```

**New `src/engine/trace.test.ts`** — *instrumentation of the instrumentation.* Resolve several
fixtures with and without a collecting sink (and with `onRngDraw` active); assert identical
`events` and identical `digestState(nextState)`. This is the single most important test in the
plan: it proves the sink cannot perturb resolution.

**Headless dump — new `tools/trace/dump-turn.ts` + `tools/trace/format.ts`:**
- `dump-turn.ts` (`tsx tools/trace/dump-turn.ts --scenario firing --seed phase5-golden [--json] [--state]`):
  builds a scenario from `src/engine/__fixtures__/match.ts`, calls `traceTurn`, and prints per
  tick: label, tick, rngState, draws-this-tick (snapshot delta), formatted events, and optionally
  a robot table (hp/pos/posture/heading/ammo/stagger). `--json` emits the full `TracedTurn`.
- `format.ts`: `formatResolutionEvent(e: ResolutionEvent): string` — the **un-redacted** analogue
  of `explainEvents`. Mirror the `src/lib/explain/events.ts` switch over raw `ResolutionEvent`,
  covering kinds the redacted explainer drops (`command-start`, `projectile-*`, `turn-*`) and
  always showing `sourceId`/`score`. Lives in `tools/` so it never ships.

**Visual dev route — new `src/app/dev/trace/` + `src/renderer/traceMovie.ts`:**
- `src/renderer/traceMovie.ts`: `traceToMovieTimeline(traced: TracedTurn): MovieTimeline` — adapts
  each authoritative per-tick `MatchState` (from `traced.ticks[].state`) into a `MovieSnapshot`
  (reuse `MovieRobotSnapshot`/`MovieTimeline` from `animations.ts`; convert like `initialRobots`
  but over *all* teams and real hp/pos/etc.), and groups the full events by tick for effect cues.
  Renders **truth**, not a re-fold — so it sidesteps the per-viewer fold entirely and works as a
  fidelity oracle. (One-way deps preserved: renderer imports engine.)
- `src/app/dev/trace/page.tsx` (+ a dynamically-imported, `ssr:false` client component like the
  existing `MovieExperience`): scenario picker (built-in fixtures + optional pasted-orders JSON),
  reuses `MoviePlayer`/`MovieControls` for scrub/step/speed, and adds three data panels synced to
  the current tick — **event log** (`formatResolutionEvent`), **state table** (every robot's full
  fields), **RNG/digest** (draws this tick, cumulative, `rngState`, running `digestState`). An
  "Export trace JSON" button reusing the Blob-download pattern from
  `src/components/replay/ObservedTurnExport.tsx`. All interactive controls get `cursor-pointer`.
- The route builds fixtures and runs `traceTurn` client-side (pure engine, no server), matching
  the existing local `/movie/[id]` canned-route precedent. Never linked from the game UI.

---

### Phase 2 — Playback-fidelity verification

The naive property "movie snapshot == `nextState` for all fields" is **false** and must be
scoped: destroyed robots become `"dock"` in `nextState` but no event carries their position
(`view.ts:102` sets hp:0 only); the movie models 5 fields (no `ammo`/`stagger`); and
`enemy-lost` *deletes* a robot from the movie (visibility, not state). So:

- **P1 — authoritative modeled-field fidelity.** Fold authoritative events over the 5 modeled
  fields (a small fold equivalent to `view.ts:83` `updateRobotState`, whose `default` already
  ignores `enemy-spotted/lost` — **not** `buildMovieTimeline`, which is a per-viewer construct)
  and compare to `nextState`: for **living** robots all 5 fields match; for **destroyed** robots
  assert `{hp:0, destroyed:true}` and pin the position rule (movie keeps last tile; `nextState`
  is `"dock"`).
- **P2 — per-viewer end-to-end (the path you actually fear).** For each team `t`:
  `buildMovieTimeline(deserialize(projectTurnResult(turn,t).initialState), projectTurnResult(turn,t).events).snapshots.at(-1)`
  must match `projectMatchState(nextState, t)` on modeled fields for robots present in both.
  This exercises redaction **and** the real client fold together — the highest bug-value check
  (covers `contact` materialization, `damaged` redaction, and `enemy-lost` deletion interacting).

**Files:**
- **Edit `src/renderer/animations.test.ts:28`** — broaden the assertion from `.position` only to
  all 5 modeled fields for living robots; add a dying-robot scenario (pins the destroyed→dock gap)
  and a spotted-then-lost enemy.
- **New `src/renderer/playbackFidelity.test.ts`** — P1 over several fixtures.
- **New `server/view.test.ts`** (or extend) — P2, importing `projectMatchState`/`projectTurnResult`
  (server) + `buildMovieTimeline` (renderer) + `digestState`.

**Note-only, do not build now:** collapsing the three folds into one shared production utility
would force a common shape and destroy their intentional differences (authoritative vs. redacted,
full vs. 5-field). Verify their *agreement* via P1/P2 instead. Also **cut**: adding
`nextStateDigest` to `ParticipantTurnResult` for a client self-check — the client only holds the
redacted subset, so a full digest match is unreachable and a coarse one gives false confidence;
P2 covers the risk server-side.

---

### Phase 3 — Semantic invariants + fuzz harness

**New `src/engine/invariants.ts`** (pure, ships safely, reusable as an optional server dev-assert):
```ts
export interface InvariantViolation { readonly code: string; readonly message: string; readonly tick?: number; readonly robotId?: string; }
export const checkTurnInvariants: (input: {
  readonly initialState: MatchState; readonly nextState: MatchState;
  readonly events: readonly ResolutionEvent[]; readonly ticks?: readonly TurnTraceEntry[];
}) => InvariantViolation[];
```
Checks:
- **HP bounds** `0 <= hp <= definition.armor` for every robot in `nextState` (and, if `ticks`
  given, at every tick boundary).
- **Ammo** every entry `"unlimited"` or integer `>= 0`.
- **Position legality** living robots on an in-bounds, traversable tile for their posture
  (reuse `canTraverseTile` from `movement.ts`); every `hp===0` robot at `"dock"`.
- **No zombie actions** after a `destroyed` event for R, no later event names R as actor/shooter/source
  (except a same-tick `command-aborted`).
- **Event ordering** `seq` contiguous from 0; `tick` non-decreasing with `seq`.
- **RNG accounting (flagship).** Predict draw count purely from events and compare to actual
  (`drawsBetween` over first/last `rngState`, or `ticks` deltas):
  `expected = #(projectile-impacted hit) [hit-roll] + #(shot-missed reason=hit-roll) [hit-roll]
  + #(projectile-impacted hit) [damage] + #(damaged kind=blast) [blast] + #(damaged) [stagger]`.
  (Trajectory failures and `no-target` return *before* the draw, so miss-reason cleanly separates
  drew-vs-didn't.) This proves the RNG stream matches what the events claim — and that
  instrumentation didn't perturb it.
- **Round-trip** `verifyReplay(createReplayLog(...)) === {ok:true}`.

**New `src/engine/invariants.test.ts`** — good state passes; deliberately corrupted inputs
(negative hp, zombie event, shuffled seq, wrong draw count) each produce the right violation.

**Fuzz harness — new `tools/harness/run-match.ts` + `tools/harness/orders.ts`:**
- `run-match.ts` (`tsx`): builds a match (fixtures or scenario JSON), plays to a survival outcome
  or N turns chaining `nextState`; each turn runs `checkTurnInvariants` + `verifyReplay`; on any
  violation, dumps the failing turn via `format.ts` and prints the reproduction seed. Emits a JSON
  report (per-turn digests, draw counts, violations) to the scratchpad / a gitignored dir for
  analysis.
- `orders.ts`: deterministic pseudo-random legal-order generator seeded by its **own**
  `createRng(fuzzSeed)` (distinct from the engine seed; reproducible). Feed schema-valid arbitrary
  orders and assert `resolveTurn` either resolves or returns a typed `MalformedOrders` and **never
  throws** — a strong invariant on its own.

**Config:**
- **Edit `eslint.config.mjs`** — add a `files: ["tools/**/*.ts","scripts/**/*.ts"]` override with
  node globals (today only `scripts/**/*.mjs` has them).
- **Edit `package.json`** — add `"trace": "tsx tools/trace/dump-turn.ts"`,
  `"harness": "tsx tools/harness/run-match.ts"`, `"fuzz": "tsx tools/harness/run-match.ts --fuzz"`.
  Harness stays out of the shipped bundle (nothing in `src/app` imports `tools/`).

---

### Phase 4 — Polish / deeper data

- **New `tools/harness/regen-golden.ts`** — fills the missing golden-regeneration path: rebuilds
  the exact `firingReplay()` scenario and writes `serializeReplay(createReplayLog(...))` to
  `src/engine/__golden__/phase5-replay-v1.json`. Extract that fixture out of `replay.test.ts` into
  `src/engine/__fixtures__/` so the golden stays byte-stable against the test's
  `serializeReplay(...) === JSON.stringify(golden)` check. Add `"regen-golden"` script.
- **Phase-tagged per-draw RNG log** — extend the Phase-1 recording rng with a `currentPhase`
  cursor the resolver updates per sub-phase (guarded, trace-only) so each `RngDraw` is attributed
  to `hit-roll`/`damage`/`blast`/`stagger`. Surfaces in the dev route's RNG panel and the dump.
  Deferred to last because the per-tick draw count + RNG-accounting invariant already localize a
  divergence to a tick and tell you RNG-vs-logic.

---

## Determinism-safety guarantees (why this can't introduce a bug)

- Untraced path is byte-identical: all hooks are `input.trace?.…` no-ops when `trace` is absent
  (`trace.test.ts` proves identical events + `digestState`).
- The recording rng returns identical values in identical order (higher-level methods reimplemented
  over its own logged `nextUint32`); it only *observes*.
- Draw counting via `drawsBetween` uses `snapshot()` reads, which never advance the stream.
- No new engine imports from UI; `trace.ts`/`traceTurn.ts`/`invariants.ts` stay engine-pure and
  ESLint's `Math.random`/`Date.now`/timer bans still apply. Tooling and the dev route live outside
  the engine and outside the production bundle.

## Risks / what could break

- **`resolver.ts` edit is in the hot path** — mitigated by `trace.test.ts` (byte-identical when
  untraced) and the existing golden/`verifyReplay` tests continuing to pass unchanged.
- **RNG-accounting invariant could be miscalibrated** (false positives) — calibrate against known
  fixtures in `invariants.test.ts` before trusting it in the fuzzer.
- **Dev route running `traceTurn` client-side** is heavier (up to ~900 ticks) — acceptable for a
  dev tool; scenarios are small. Keep it behind `/dev/` and never link it from the game.
- **`format.ts` / `assertResolutionEvent` drift** if event kinds change — both are hand-maintained
  mirrors of the union; note them together.

## Verification (end-to-end)

1. `npm run typecheck` && `npm run lint` && `npm run format:check` — clean (incl. new tools override).
2. `npm test` — all green; specifically `trace.test.ts` (no perturbation), `playbackFidelity.test.ts`
   + broadened `animations.test.ts` + `server/view.test.ts` (P1/P2), `invariants.test.ts`, and the
   pre-existing golden/`verifyReplay` tests unchanged.
3. `npm run trace -- --scenario firing --seed phase5-golden --state --json` — inspect the per-tick
   state, events, and draw counts; sanity-check a shot lands where expected.
4. `npm run fuzz -- --seeds 200` — 0 invariant violations, no throws; reproduce any failure by its
   printed seed.
5. `npm run regen-golden` — golden file is byte-unchanged (confirms nothing drifted).
6. `npm run dev`, open `/dev/trace` — pick the firing scenario, scrub the timeline, confirm the
   state table / event log / RNG panel agree with the headless dump, export the trace JSON. Cross-check
   by eye that the authoritative dev movie and the normal (event-fold) movie for the same scenario
   look identical — a live fidelity check.

## File inventory

**New:** `src/engine/trace.ts`, `src/engine/traceTurn.ts`, `src/engine/trace.test.ts`,
`src/engine/invariants.ts`, `src/engine/invariants.test.ts`, `src/renderer/traceMovie.ts`,
`src/renderer/playbackFidelity.test.ts`, `server/view.test.ts`, `src/app/dev/trace/page.tsx`
(+ client component), `tools/trace/dump-turn.ts`, `tools/trace/format.ts`,
`tools/harness/run-match.ts`, `tools/harness/orders.ts`, `tools/harness/regen-golden.ts`.

**Edited:** `src/engine/replay.ts` (export digests), `src/engine/resolver.ts` (optional `trace?`
hook), `src/renderer/animations.test.ts` (broaden fidelity assertion), `eslint.config.mjs` (tools
override), `package.json` (scripts), `src/engine/__fixtures__/match.ts` (extract golden scenario).

**Reuse map:** `digest`/`digestState`/`serializeState` (replay.ts, post-Phase-0) ·
`snapshotState` (resolver.ts:790) · `createReplayLog`/`verifyReplay` (replay.ts) ·
`buildMovieTimeline`/`applyMovieEvent`/`MovieTimeline` (animations.ts) ·
`projectMatchState`/`projectTurnResult`/`updateRobotState` (view.ts) · `explainEvents` pattern
(lib/explain/events.ts) · `ObservedTurnExport` download pattern · `MoviePlayer`/`MovieControls`
(renderer) · `makeMatch`/`makeRobot`/`makeFfaMatch` (__fixtures__/match.ts) ·
`requireResolved`/`eventsOf` (resolver.test.ts) · `canTraverseTile` (movement.ts) · `tsx` runner.
