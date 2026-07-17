# RoboArena Implementation Plan

This is the action-focused execution roadmap from "engine primitives exist" to "v1 ships". It complements but does not replace `docs/spec.md` (the canonical current spec / constants) or `docs/priority-tests.md` (empirical research log). `docs/initial-plan.md` is historical planning context only.

**Audience**: any agent (human or AI) picking up a phase cold. Each phase is self-contained enough to execute independently once dependencies land.

**Main-game scope reminder (Phases 1-12)**: 2-4 humans on separate
internet-connected devices play free-for-all Survival, with one Team and one
unique Side per player. There is no AI. Three postures (Upright, Ducking,
Crouching) remain in scope. Hot-seat play, multiple Teams on one Side/alliance
logic, Stealth, and every non-Survival sport begin only after the online
free-for-all v1 gate. Reserved enum/catalog data for deferred modes must not
create v1 implementation dependencies.

**MVP trim decisions**:

- Internet-room Survival is the v1 finish line: 2, 3, or 4 human players,
  separate devices, one Team per player, and unique Sides (1v1, 1v1v1, or
  1v1v1v1). Hot-seat and allied/multi-Team Sides move to v2.
- Import Rubble Two and Rubble Three from the verified row-major `.TWN` MAP
  payloads. Generate home rectangles with the exact dimension thresholds in
  `src/engine/arena.ts`; Dock is off-field state.
- Hit/damage lock at fire time. Exact projectile travel duration is renderer
  presentation tuning and no longer blocks the deterministic gameplay engine.
- Scan & Fire duration, reacquisition loop, maximum-distance filter, and named
  repeat intervals are path-confirmed. Seconds is duration only and no separate
  numeric scan-length/target-speed term reaches live fire. Equal adjusted
  distances prefer higher scan-sight strength, then canonical candidate order.
- v1 includes durable asynchronous turns: private planning, ready/lock status,
  leave-and-return room recovery, independently watched resolved turns,
  deterministic replay, and a concise post-turn causality log. Accounts, push
  notifications, full contextual-help corpus, deployment automation, and
  production observability remain post-v1.

---

## 1. Architecture overview

```text
Browser (one Team/player)                    Authoritative room service
┌──────────────────────────────┐            ┌────────────────────────────┐
│ Next.js/React UI             │            │ server/ room phase machine │
│ ├─ planner: own draft orders │──WSS──────▶│ validate + lock orders     │
│ ├─ renderer: authorized movie│◀──WSS──────│ visibility projection      │
│ └─ net: room/rejoin protocol │            │ canonical replay/state     │
└──────────────┬───────────────┘            └──────────────┬─────────────┘
               │ shared pure helpers                         │ only resolver
               ▼                                             ▼ authority
        ┌─────────────────────────────────────────────────────────────┐
        │ src/engine/ — pure deterministic TypeScript, no I/O         │
        │ resolveTurn(MatchState, all TurnOrders, seed)               │
        │   → { nextState, ResolutionEvent[] }                        │
        └─────────────────────────────────────────────────────────────┘
```

**Boundary rules** (enforced by directory layout, later by ESLint config):

- `src/engine/` imports nothing from any other `src/` directory. No React, no DOM, no `Math.random`, no `Date.now`, no `window`. Pure deterministic TS.
- `src/renderer/` imports `engine/` types and consumes `ResolutionEvent[]`. Doesn't run the engine itself.
- `src/planner/` imports `engine/` types and produces `TurnOrders`. May call lightweight engine helpers (path validity, scan-cone math) but does not run a full turn.
- `src/app/`, `src/components/` are React UI. They orchestrate planner/renderer.
- `src/lib/net/` is the v1 room protocol and WebSocket client. The server is
  authoritative: clients never resolve shared turns or receive opponents'
  unsubmitted plans or hidden state.

**Determinism contract**: every probabilistic decision in the engine goes
through a seedable RNG (`createRng(seed)`). Replay =
`{ initialMatchState, turns: { seed, orders }[] }` → identical event stream on
any machine.

---

## 2. Repository layout

```
RoboArena/
├── src/
│   ├── engine/             pure-TS simulation (Phase 1-5)
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   ├── rng.ts
│   │   ├── geometry.ts
│   │   ├── movement.ts
│   │   ├── firing.ts
│   │   ├── blast.ts
│   │   ├── catalog.ts
│   │   ├── resolver.ts             (Phases 2-4)
│   │   ├── visibility.ts           (Phase 4)
│   │   ├── replay.ts               (Phase 5)
│   │   ├── index.ts
│   │   └── *.test.ts
│   ├── renderer/           PixiJS arena & movie player (Phase 6-7)
│   ├── planner/            turn-programming logic (Phase 9-10)
│   ├── ai/                 (deferred — AI = post-v1)
│   ├── lib/
│   │   ├── arenas/         generated row-major Rubble Two/Three arena data
│   │   ├── net/            v1 WebSocket room client + shared protocol
│   │   └── replay/         save/load helpers for browser
│   ├── app/                Next.js 16 routes
│   │   ├── setup/
│   │   ├── match/[id]/
│   │   ├── replay/[id]/
│   │   └── layout.tsx
│   └── components/         React UI components
├── server/                 v1 authoritative room + resolver service
├── docs/                   specs and plans
├── screenshots/            DOS reference captures
├── references/             source matrix
├── tests/                  empirical-test plan
└── public/                 static assets
```

Some directories don't exist yet — they appear in their phase. The plan says where things go before they're built.

---

## 3. Tooling & CI

| Concern      | Choice                                                                                               | Rationale                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language     | TypeScript 5.6 strict                                                                                | Already configured. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`, ESM throughout.                                            |
| Test runner  | Vitest 4.1                                                                                           | Already configured. Fast, ESM-native, plays well with pure-TS engine.                                                                                       |
| Linter       | ESLint (flat config)                                                                                 | Standard for Next.js; large plugin ecosystem; widely understood by AI coding agents.                                                                        |
| Formatter    | Prettier                                                                                             | Standard. `format:check` in CI is enough for v1; pre-commit hooks are optional later.                                                                       |
| E2E test     | Playwright                                                                                           | Added with the room flow, then expanded through the full 2-4 player online turn loop.                                                                       |
| CI           | GitHub Actions                                                                                       | Repo will eventually live on GitHub. Workflow: typecheck + lint + test on push to main; build joins once Next.js lands.                                     |
| Deploy       | Vercel web client + long-lived WebSocket service + Supabase Postgres                                 | Vercel does not provide the sticky process ownership or persistent SQLite filesystem assumed by the room service. Validate the split deployment in Phase 8. |
| Branching    | **Trunk with frequent commits** (current). PR-based later when multi-agent review is needed.         |
| Commit style | Conventional-ish; first line ≤ 72 chars; bodies describe _why_ + tests. Co-authored where AI-paired. |

**CI workflow (to land in Phase 2)**:

```yaml
# .github/workflows/ci.yml — sketch
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

---

## 4. Phased PR plan

**Status legend**: ✅ DRAFT COMPLETE · 🟡 IN PROGRESS · ⬜ NOT STARTED · ⏸ DEFERRED

**Effort legend**: S = ≤ 1 session · M = 2-3 sessions · L = a week of evenings · XL = multi-week

### Phase 1 — Engine primitives [✅ DRAFT COMPLETE / OBSOLETE MODEL]

**Goal**: pure-TS deterministic simulation primitives — RNG, geometry, movement costs, single-shot firing resolution, blast resolution, weapon/robot catalogs.

**Status**: shipped in commit `8fb5028`, then superseded by Phase 1R. This
section records the original skeleton only; none of its former numerical model
or API examples are current mechanics authority.

**Files** (all under `src/engine/`):

- `constants.ts` — initial centralized numerical tables
- `types.ts` — core structural engine types and discriminated unions
- `rng.ts` — mulberry32 seedable RNG
- `geometry.ts` — initial distance, bearing, scan, and line helpers
- `movement.ts` — initial movement cost and traversal helpers
- `firing.ts` — `resolveFire`: pure function from `(shooter, target, weapon, terrain, rng)` → discriminated outcome
- `blast.ts` — `resolveBlast`: per-target damage rolls in radius
- `catalog.ts` — `WEAPONS`, `ROBOT_DEFINITIONS`, `DEFAULT_ROSTER_BY_LENGTH`
- `index.ts` — public exports

**Supersession rule**: use Phase 1R below, `docs/spec.md`, and the current
`src/engine/constants.ts` / `catalog.ts` for every mechanic and public API.
The discarded BLACK/GREY probability model, damage brackets, terrain
multipliers, Chebyshev combat range, and stride parity are historical only.

**Effort**: M (delivered).

---

### Phase 1R — Binary-truth engine realignment [✅ DRAFT COMPLETE]

**Goal**: replace the obsolete playtest-derived timing/combat model with the
reproduced binary tables and mechanisms before downstream engine work begins.

**Dependencies**: Phase 1 draft plus the timeboxed RE mapping pass in
`tasks/core-build-plan.md` Milestone 0.

**Execution and acceptance**: `tasks/engine-realignment-plan.md`. Confidence and
reproducibility findings: `tasks/reverse-engineering-audit.md`.

This phase owns 60 units/s, floored Euclidean combat distance, three postures,
height/cover classes, live-fire hit scoring, wide damage rolls, exact blast
tables, and synchronization of `docs/spec.md` with code/tests.

**Effort**: M.

---

### Phase 1.5 — Toolchain & determinism enforcement [✅ COMPLETE]

**Goal**: lock in the dev toolchain so every Phase 2+ commit lands against a polished pipeline.

**Dependencies**: Phase 1R.

**Files**:

- `eslint.config.mjs` — flat config; recommended TS + import-order; **custom rule** banning `Math.random` / `Date.now` / `setTimeout` / `setInterval` inside `src/engine/`
- `.prettierrc.json` — defaults
- `.nvmrc` — `22`
- `package.json` — add `"engines": { "node": ">=22" }`; new scripts: `lint`,
  `lint:fix`, `format`, `format:check`. Dev/build/start wait for Next.js.
- `.github/workflows/ci.yml` — typecheck + lint + test on push (Next.js build joins when UI lands)
- `.husky/pre-commit` + `lint-staged` config — optional post-v1 convenience; do not block Phase 1.5 on hooks

**Acceptance criteria**:

- [x] `npm run lint` green on existing engine code
- [x] `npm run format:check` green
- [ ] CI workflow runs and passes on push (workflow committed locally; remote run pending)
- [x] Adding `Math.random()` to any `src/engine/*.ts` fails lint
- [ ] Pre-commit hook formats and lints staged files (optional; defer if it slows the MVP)

**Effort**: S (~30-60 min).

---

### Phase 2 — Turn resolver core [✅ DRAFT COMPLETE]

**Goal**: orchestrate per-tick simulation. Consume `MatchState + TurnOrders + seed`, emit `ResolutionEvent[]` and a new `MatchState`. Implements movement, posture, scan rotation, command timing, simultaneous damage, and death cleanup. Aim & Fire locks and applies its result at the fire boundary; Phase 3 adds the corresponding deterministic presentation cues and explosive dispatch.

**Dependencies**: Phase 1R and Phase 1.5.

**Files**:

- `src/engine/commandInterpreter.ts` — pure posture, scan-rotation, movement-step, deployment, and firing duration helpers
- `src/engine/resolver.ts` — `resolveTurn({ state, orders, seed }) → Resolved | MalformedOrders`
- `src/engine/__fixtures__/` — small canned `MatchState` builders for tests
- `src/engine/resolver.test.ts`
- `src/engine/commandInterpreter.test.ts`

**Time-boundary phase order** (implemented in `resolver.ts`; full decisions in
`tasks/phase2-resolver-design.md`):

```
for boundary in 0..TURN_DURATION_UNITS:
  1. gather due command completions from a boundary-start snapshot
  2. apply deploy/move completions (robots may stack)
  3. apply posture / scan-direction completions
  4. resolve Aim & Fire and emit presentation cues in canonical actor order
  5. batch damage and deaths
  6. start each surviving robot's next command
```

**Public API contract**:

```ts
export interface TurnResult {
  readonly outcome: "resolved";
  readonly nextState: MatchState;
  readonly events: readonly ResolutionEvent[];
}

export function resolveTurn(input: {
  state: MatchState;
  orders: TurnOrders;
  seed: string;
}): TurnResult | MalformedOrders;
```

**Tests required**:

- single-robot move along open path → emits `move-step` events at exact fixed
  30/40-tick one-/two-tile boundaries
- posture change → `posture-changed` event at the realigned completion boundary
- scan rotation → `scan-rotated` event at the realigned completion boundary
- 2 robots stack on same tile (no collision) — both end positions correct
- crouching robot tries to walk onto bush → command rejected at planner; resolver receives only legal moves (negative test: malformed orders trigger `MalformedOrders` error, not silent corruption)
- Aim & Fire on stationary target → emits `hit` or `miss` correctly at the canonical fire boundary
- two robots fire at each other on the same tick, both die from the exchange → both `destroyed` events emitted (simultaneous-damage rule)
- 30-shot full turn with same seed → exact same `events` array twice
- command completing exactly at the 900-unit boundary executes; later work does not
- frozen input state/orders remain unchanged

**Acceptance criteria**:

- [x] `resolveTurn` is a pure function (no side effects, no mutation of inputs)
- [x] Determinism: same `(state, orders, seed)` → byte-equal `events` and `nextState` across runs
- [x] All commands in `RobotCommandSegment` union are handled or explicitly rejected with typed errors
- [x] Robot HP can never go negative or above `armor`
- [x] 33 focused command/resolver tests cover single-robot, multi-robot, and edge cases
- [x] `npm test`, typecheck, lint, and format-check green locally

**Risks**:

- Multi-step move chunking: planner submits a `move` segment with a path;
  resolver charges 30 ticks for each one-tile command and 40 for each two-tile
  command. **Closed:** `chunkMovementPath` pairs two unit steps only when both
  entered tiles are full-speed Open Ground; Rough/Bush/Low-wall retain
  30-tick one-tile waypoints. Encoded two-tile steps retain their selected
  intermediate `via` waypoint, and the resolver rejects imported steps whose
  exact route crosses slow or blocked terrain.
- Tick assignment: if a command segment spans multiple ticks, where exactly do its events emit? Convention: events emit at tick the action _completes_ (e.g. arrival tile), with `tick: number` the integer index.

**Effort**: L. This is the keystone phase.

---

### Phase 3 — Projectile and blast event semantics [✅ DRAFT COMPLETE]

**Goal**: add missile/grenade blast resolution and emit deterministic projectile
launch/impact cues. Aim & Fire locks hit and damage when fire resolves. The
renderer may animate travel afterward, but movement during that animation never
rerolls, retargets, or dodges a locked result.

**Dependencies**: Phase 2.

**Files**:

- `src/engine/resolver.ts` — resolve the locked direct/blast result and emit
  launch/impact presentation events at a stable command boundary
- `src/engine/blast.ts` — apply named Missile category 1 and, when later
  granted by setup, Grenade category 0
- `src/engine/projectiles.test.ts` — event/result-lock semantics

Do not add a gameplay `projectileTilesPerTick` constant. Visual travel speed is
a Phase 7 renderer setting; the original binary confirms result locking but the
exact screen duration is not required state for replay determinism.

**Strict-impact decision analysis (not yet adopted):**

| Model                 | State mutation                                          | Strength                                                                                               | Cost / fidelity risk                                                                                                                            |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Current MVP           | fire boundary                                           | simplest resolver and replay                                                                           | movie can show a projectile travelling toward a robot already damaged/destroyed; later same-turn commands differ from impact-authoritative play |
| Strict original-timed | verified original impact tick                           | strongest parity and audiovisual causality                                                             | exact bullet/missile/grenade travel ticks are not yet audited; pending-impact queue and simultaneous-impact rules required                      |
| Optional hybrid       | fire-time roll, clone-defined deterministic impact tick | causal movie, shooter death cannot cancel a locked shot, renderer and engine share one event authority | deliberate timing deviation until original travel constants are traced                                                                          |

Phase 3 adopts the current MVP rule: state mutation and both presentation cues
share the fire boundary. The hybrid remains a possible later rules change, not
unfinished Phase 3 work. Any future adoption must revise the spec first and add
`PendingImpact`, explicit travel constants, impact batching, and tests for
actions between fire and impact. Under either model, never reroll, retarget, or
let renderer completion mutate engine state.

**Tests required**:

- target moves after the fire-time roll → pre-rolled result is unchanged
- destroying the shooter after fire does not cancel the locked result
- missile triggers named category-1 `resolveBlast` at the command boundary
- simultaneous missiles both apply in canonical batched order
- launch/impact presentation events are deterministic and do not alter state

**Risks**:

- Presentation events must never become a second combat authority. Engine state
  changes only from the locked resolver result.

**Effort**: M.

---

### Phase 4 — Scan & Fire mode + ordinary visibility [✅ DRAFT COMPLETE]

**Goal**: implement the "wait-and-shoot" Scan & Fire firing mode and ordinary
per-team visibility for the four main-game Survival classes. Stealth is an
explicit post-main-game phase and must not be implemented here.

The static trace locks the implementation shape: evaluate at the scheduled
command tick, reacquire after each named repeat interval, filter by maximum
distance, choose nearest adjusted-distance candidate, decrement ammo when the
shot is emitted, and lock the aimed tile/result at fire time (no impact-time
tracking). Equal adjusted distances prefer the exact scan-grid sight strength,
then stable original candidate order. The Seconds field is duration only; no
separate numeric scan-length or target-speed term reaches the live hit resolver
beyond the confirmed off-aimed-tile halving.

For a stationary scanner versus a runner, movement completion is processed
before a firing opportunity at the same tick. Acquisition observes the
runner's resulting tile and current distance/scan-sight strength/terrain/cover. There is
no speed statistic. A runner can cross the cone between weapon opportunities
without being acquired; after acquisition, leaving later does not reroll the
locked shot.

These are bundled because both need scan-cone calculations against moving targets per tick. Splitting into two phases would duplicate the per-tick visibility-against-cone logic.

**Dependencies**: Phase 3.

**Files**:

- `src/engine/visibility.ts` — `computeVisibility(state, observingTeamId): VisibilityState` — set of tiles + visible-enemy-robot-ids, plus last-known markers
- `src/engine/scanAndFire.ts` — per-tick check: does any enemy enter scan range
  × cone of a robot in S&F mode? If yes, lock its current tile/result and emit
  the normal projectile presentation event
- `src/engine/resolver.ts` — extend per-tick to call S&F watchdog and update visibility
- `src/engine/types.ts` — add `VisibilityState` and typed visibility/acquisition events; active Scan & Fire runtime state remains resolver-local
- tests

Last-known X markers: at the _end of each turn_, for every team, record tiles where they last saw any enemy that's no longer visible to them. Engine emits `last-known-marker` events; renderer draws Xs in Edit mode of the next turn.

**Public API contract**:

```ts
export interface VisibilityState {
  readonly visibleTiles: ReadonlySet<string>; // "x,y" keys
  readonly visibleEnemies: ReadonlySet<string>; // robotIds
  readonly lastKnownMarkers: readonly TileCoord[];
}

export function computeVisibility(state: MatchState, teamId: string): VisibilityState;
```

**Tests required**:

- upright target at d=10 inside the scan cone with clear LoS → visible
- target behind a wall → NOT visible
- target behind one Low Wall or Bush → still visible with scan-sight strength 13
- six endpoint-inclusive Low Wall/Bush samples → strength exhausted, NOT visible
- Scan & Fire watchdog: enemy enters scan cone at tick 80 → current target tile
  and result lock at tick 80
- S&F runs out of `secondsRemaining` → mode terminates, no shot fired

**Risks**:

- Visibility is computed per-team-per-tick → potentially expensive. v1 ships the naive O(robots × tiles-in-cone) approach; optimization later if profiling shows hot spot.
- Visibility and Scan & Fire acquisition must use the same endpoint-inclusive
  0..16 scan-sight-strength path; do not substitute boolean terrain opacity.

**Effort**: L.

---

### Phase 5 — Replay format [✅ DRAFT COMPLETE]

**Goal**: serialize a `ReplayLog` to JSON; deserialize and re-run; verify byte-equal event stream. Replays are the foundation for movie sharing, multiplayer sync verification, and debugging.

**Dependencies**: Phases 2, 3, 4.

**Files**:

- `src/engine/replay.ts` — `serializeReplay`, `deserializeReplay`, `verifyReplay` (re-runs and compares events)
- `src/engine/replay.test.ts`

**Public API contract**:

```ts
export function serializeReplay(log: ReplayLog): string;
export function deserializeReplay(json: string): ReplayLog;
export function verifyReplay(
  log: ReplayLog,
): { ok: true } | { ok: false; firstDivergenceTick: number };
export function createReplayLog(input: {
  initialState: MatchState;
  turns: readonly { seed: string; orders: TurnOrders }[];
}): ReplayLog;
```

**Tests required**:

- round-trip: serialize → deserialize → byte-equal
- re-run: take a `ReplayLog`, run `resolveTurn` for each turn with that turn's
  recorded seed and orders, compare events to the recorded events → byte-equal
- intentional corruption: flip one byte in either turn seed → verify re-run
  diverges and `verifyReplay` returns the absolute divergent tick
- malformed nested replay data is rejected before a typed `ReplayLog` is
  returned; `verifyReplay` never throws for bad imported data
- schema versioning: replays carry a `formatVersion: 1` field; deserializer rejects unknown versions

**Implemented contract**: replay authority is initial state plus ordered
per-turn `{ seed, orders }` entries.
Derived events are retained for direct movie playback and exact comparison;
deterministic event and complete next-state digests detect corruption. Version 1
embeds arena tiles. The Phase 6 named/checksummed arena library is now present,
but moving existing replay storage to references still requires a later
versioned migration.

**Effort**: S.

---

### Phase 6 — Next.js scaffold + arena renderer [✅ DRAFT COMPLETE]

**Goal**: initialize Next.js 16 app, integrate PixiJS, render an arena (tiles, walls, bushes, etc.) statically. No robots, no animation yet. Just "I can load the page and see Rubble Three".

**Arena data policy**: generate Rubble Two and Rubble Three JSON from the
verified row-major `.TWN` MAP payload (`tiles[y][x]`; no flip/transpose).
Generate homes with `createHomeAreas(width,height)`; Dock remains off-field.
Keep a visual review page as import QA.

**Dependencies**: Phase 1 (types).

**Files**:

- `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx` (redirects to usable preview)
- `tools/re/export_data.py` — source-locked `.TWN` MAP exporter
- `src/lib/arenas/` — generated `rubble-two.json`, `rubble-three.json`
- `src/lib/arenas/index.ts` — `loadArena(name): Promise<Arena>` + JSON schema validator
- `src/renderer/PixiArena.tsx` — React component wrapping a Pixi `Application` that renders an `Arena`
- `src/renderer/assets.ts` — SVG asset registry (terrain × 7 + crate; see §5 Asset inventory)
- terrain SVG sprites under `public/assets/terrain/`
- `src/components/ArenaPreview.tsx` — `<ArenaPreview arenaName="rubble-three" />`
- `src/app/preview/page.tsx` — temporary debug page that shows all extracted arenas side-by-side

**Arena verification**: compare generated dimensions/checksums with the claim
ledger and review the rendered map once. Do not hand-transcribe terrain.

**Art**: terrain SVGs are the first deliverable from §5 Asset inventory. 7 simple SVGs (open / rough / low-wall / wall / bush / crevice / outer-wall) plus the crate obstacle. Hand-author or AI-generate to a coherent palette.

**Public API contract**:

```tsx
export function PixiArena({ arena }: { arena: Arena }): JSX.Element;
export function loadArena(name: ArenaName): Promise<Arena>;
```

**Tests required**:

- arena JSON files validate against `Arena` type (write a `validateArena(arena): void` helper + tests)
- `loadArena('rubble-two').width === 24` and `.height === 24`
- Playwright production smoke test: load `/preview`, confirm both canvases mount,
  capture the visual baseline, and fail on browser errors

**Acceptance criteria**:

- [x] Visiting `/preview` shows Rubble Two and Rubble Three rendered as Pixi canvases
- [x] Tiles render with correct visual styles per terrain type
- [x] No console errors / type errors

**Sub-deliverables added in this phase**:

- **Loading splash + asset preload progress bar**. PixiJS `Assets.load` for all SVGs in the Asset inventory (§5); show a branded splash with a progress bar while loading. Once cached by the browser, subsequent loads are instant.
- **Skeleton states** for routes that load match/replay data from server.
- **Visual regression test scaffolding** — Playwright config with screenshot snapshot helper. Ship one test (the `/preview` page screenshot) so the harness is in place; expand coverage in Phase 13.

**Risks**:

- PixiJS + React + Next.js SSR plays poorly out of the box (Pixi requires window/canvas). Mitigation: dynamic import with `ssr: false` for the Pixi component.
- Tile sprites: ship the SVG terrain set from §5; if AI-generation produces inconsistent style, hand-author 7 simple tiles in Inkscape.

**Effort**: M.

---

### Phase 7 — Movie playback [✅ DRAFT COMPLETE]

**Goal**: render robots and animate `ResolutionEvent[]` as a movie — play,
pause, scrub, step forward/backward, compress idle spans, and select
0.5x/1x/2x/4x speed. Preserve the original's readable movie idea while making
presentation time independent from deterministic simulation ticks.

**Dependencies**: Phases 1, 2 (so we have `MatchState` + events to render).

**Files**:

- `src/renderer/MoviePlayer.tsx` — React component that owns the playback state machine (playing / paused / current tick)
- `src/renderer/animations.ts` — pure per-event snapshot reducer plus exhaustive visual-cue mapping
- `src/renderer/RobotSprite.tsx` — compact layered Pixi container per robot with posture scale and team color
- `src/renderer/effects/` — sprite-life-cycle helpers for projectiles, impacts, hit bursts, and explosions
- `src/components/MovieControls.tsx` — play / pause / step / speed controls (mirrors original DOS transport bar)
- `src/app/movie/[id]/page.tsx` — debug route that runs a canned event sequence
- layered Pixi robot/effect primitives implement the smaller equivalent allowed by §5

**Animation pipeline**: `buildMovieTimeline` reduces all events into immutable
event-boundary snapshots up front and provides an exhaustive cue mapping for
every `ResolutionEvent.kind`. React selects the authoritative snapshot; Pixi
applies it and GSAP runs decorative, non-awaited tweens. Playback never waits on
animation completion and speed/idle controls only change wall-clock delays.

**Public API contract**:

```tsx
export function MoviePlayer({
  initialState,
  events,
  fps?: number; // default 12 to match original
  initialTick?: number; // optional deep-link/scrub starting point
}): JSX.Element;
```

**Tests required**:

- step forward through a 10-tick movie → final robot positions match `nextState.teams[*].robots[*].position`
- step backward returns the player to the previous state correctly (idempotency)
- speed multiplier doesn't change which events fire, only their wall-clock pacing
- idle compression and scrubbing reach the same tick snapshots as uninterrupted
  playback; neither can affect server phase or game outcome

**Acceptance criteria**:

- [x] Hand-crafted `ResolutionEvent[]` sequence (a robot walks 5 tiles east) renders correctly
- [x] Speech-bubble replacement (small explosion on hit, larger on destroyed) visible
- [x] Play / pause / scrub / step / speed / skip-idle all work; no off-by-one on
      step direction

**Risks**:

- React state for "current tick" + Pixi's animation loop → easy to desync. Use a single source of truth (React state for tick; Pixi just reads).
- Backward step and scrubbing read the immutable event-boundary snapshot cache;
  they never re-run or mutate the resolver.

**Effort**: L.

---

### Phase 8 — Online room foundation + match setup [🟨 LOCALLY COMPLETE — HOSTING GATE OPEN]

**Goal**: establish the internet-first v1 architecture before planner work. A
host creates a private room, 1-3 other humans join from separate devices, and
the room starts a 2-4 player free-for-all Survival match. Each participant owns
exactly one Team and every Team has a unique Side.

**Dependencies**: Phases 1, 5, 6.

**Files**:

- `server/index.ts` — long-lived HTTP/WebSocket room service
- `server/rooms.ts` — authoritative room lifecycle and participant ownership
- `server/storage.ts` — transactional durable room/match/replay persistence
- `src/lib/net/protocol.ts` — versioned, runtime-validated messages
- `src/lib/net/client.ts` — typed WebSocket client and connection state
- `src/app/page.tsx` — Create Room / Join Room / Replay
- `src/app/room/[code]/page.tsx` — room roster, setup, readiness, share link
- `src/components/setup/TeamRow.tsx` — own team name/color and assigned slot
- `src/lib/setup/validate.ts` — shared `GameConfig` validation
- `deploy/room-service.Dockerfile`, `docs/room-service-deployment.md` — portable
  room service and Vercel/Supabase/external-WSS verification runbook

**Room contract**:

- short room code plus shareable deep link; no account required;
- opaque participant/rejoin token proves ownership of exactly one Team and is
  stored only in that player's browser;
- the home page remembers room URLs/tokens locally and shows asynchronous room
  status on return; closing the tab never withdraws locked orders;
- 2-4 players, unique names/colors, and at least two players; the server assigns
  unique Sides and non-compacting Home slots when the match starts;
- host chooses the supported Survival length; Melee/Battle select their verified
  Rubble Two/Three arena defaults and v1 uses Beginner formation; all players
  can see configuration and ready status;
- starting freezes configuration and creates the canonical server MatchState;
- server is the only authority for room membership, match state, seeds, order
  validation, resolution, visibility filtering, and turn advancement.

**Protocol minimum**:
`CreateRoom`, `JoinRoom`, `ResumeRoom`, `UpdatePlayer`, `UpdateConfig`, `SetReady`,
`StartMatch`, `RoomSnapshot`, `ProtocolError`. Every message carries a protocol
version and request ID. After Create/Join issues a seat, every mutation is
authenticated by its opaque rejoin token.

**Tests required**:

- runtime schemas reject unknown versions, oversized text, invalid enum values,
  duplicate Sides/colors, and a fifth player;
- integration test: four clients join one room, receive the same public room
  snapshot, ready, start, and receive unique server-assigned Home slots/Sides;
- a non-host cannot alter host configuration or start early;
- refresh/reconnect with the valid token restores the same player seat; a
  different token cannot claim it;
- restart the room service after setup and after locked orders; durable state,
  ownership, and request idempotency recover without duplicate resolution;
- Melee/Battle defaults select the verified arena and formation data.

**Acceptance criteria**:

- [x] Two, three, or four browsers can create/join a room by URL/code
- [x] Each browser controls one Team; v1 exposes no alliance/Side-sharing UI
- [x] Starting produces one canonical server match and navigates every client
      to its private planning view
- [x] All clickable controls are keyboard reachable and use `cursor-pointer`

**Hosting gate**: before the phase closes, deploy the Next.js application to
Vercel, the room service to a long-lived container/VM host, and the durable
database to Supabase Postgres; then verify two real networks/devices. Keep each
room owned by one server process in v1. Cross-process distribution is post-v1,
but ordinary process/deploy restart recovery is required for asynchronous play.

**Current gate state**: the portable service image, health endpoint, SQLite WAL
local/test adapter, graceful shutdown, local restart/idempotency tests, and
four-browser flow are verified. The Supabase Postgres adapter/migrations,
deployment credentials, and two external devices remain open; therefore the
real WSS/two-network restart check is not yet claimed.

**Effort**: L.

---

### Phase 9 — Planner UI: movement + posture + scan [✅ DRAFT COMPLETE]

**Goal**: turn programming for the simplest commands. Player drags / clicks to plan a movement path; toggles posture; sets scan direction. The planner shows the timeline at the top and validates each command (path validity, scan-cone bounds) live.

**Dependencies**: Phases 1, 6, 7, 8.

**Files**:

- `src/app/match/[id]/edit/page.tsx` — Edit Mode (planning)
- `src/components/planner/Timeline.tsx` — top bar with cumulative time
- `src/components/planner/CommandPanel.tsx` — Tools panel: Posture, Scan, Weapon, Fire buttons
- `src/components/planner/ArenaCanvas.tsx` — interactive Pixi arena that handles clicks
- `src/planner/state.ts` — immutable reducer for current `TurnOrders` and conflict recovery
- `src/planner/pathfind.ts` — A* on the arena tile grid for movement paths
- `src/planner/segments.ts` — helpers to append/edit/delete `RobotCommandSegment`s
- `src/planner/history.ts` — bounded undo/redo history for the local draft

**Tests required**:

- A* pathfinding: valid path between two open tiles, around a wall, respecting
  posture restrictions, and preferring the lowest 30/40-tick selector cost
- click a wall tile → cursor shows "blocked" state (mirrors DOS UX)
- click outside Home Area on first move → "out of home" error
- timeline updates correctly when adding/deleting commands using fixed 30/40
  tick one-/two-tile move costs
- route compression calls the shared `chunkMovementPath`: Open+Open may become
  one 40-tick double, while entering Rough/Bush/Low-wall retains a 30-tick
  single; include straight, mixed, and diagonal route tests
- undo/redo restores byte-equivalent orders and projected positions; movement
  previews apply each selector at its own completion boundary
- server snapshots never overwrite a newer unsent local draft without an
  explicit conflict/recovery path

**Acceptance criteria**:

- [x] Player can deploy a robot, walk it across the arena, change posture, set scan direction, all visible on the timeline
- [x] Multi-robot timeline preview works: planning robot B at tick X shows robot A's projected position at tick X (DOS-confirmed UX)
- [x] "Out of home", "blocked", "out of bounds" cursor states all surface
- [x] Every segment shows exact start/end ticks, route cost, remaining horizon,
      and whether it creates a scan opportunity
- [x] Commands remain editable; undo/redo works until orders are locked

**Implementation note**: the authenticated `GetMatchState` request supplies the
canonical setup snapshot without exposing another player's draft. Browser-local
drafts use a versioned, failure-safe envelope. Reloading a prior-turn draft
preserves it behind an explicit recover-compatible/use-server choice; same-turn
server revision conflicts retain the keep-local/use-server choice. Direct edits
and deletions retain only the resolver-legal command prefix.

**Risks**:

- Pixi click handling vs. React state — same risk as Phase 7
- A* searches legal one-/two-tile selectors using their fixed 30/40-tick costs,
  returns the selected unit waypoints, and shared exact chunking retains each
  chosen `via` without jumping over slow terrain or inventing stride state.

**Effort**: L.

---

### Phase 10 — Planner UI: firing dialogs [✅ DRAFT COMPLETE]

**Goal**: Aim & Fire (with repeat-fire variant via Ctrl+Shift) and Scan & Fire (with Maximum Distance + Seconds dialog).

**Dependencies**: Phase 9.

**Files**:

- `src/components/planner/AimAndFireDialog.tsx`
- `src/components/planner/ScanAndFireDialog.tsx`
- `src/components/planner/FireBox.tsx` — buttons that open dialogs
- `src/planner/firingHelpers.ts` — inclusive scan-gate visualization and authorized hit-score preview

**Tests required**:

- Aim & Fire dialog: target outside cone shows "angle blocked"; target out of weapon range shows "out of range"
- Scan & Fire dialog: Max Distance defaults to the weapon's confirmed maximum
  range (18 tiles in v1); Seconds defaults to the remaining budget
- Ctrl+Shift+click on target tile creates a `repeat: true` Aim & Fire segment
- hit preview uses only information currently authorized for that player; it
  never reveals an unseen robot, hidden enemy order, or unrevealed RNG result

**Acceptance criteria**:

- [x] Both fire modes can be programmed; commands appear on timeline with correct durations
- [x] Visual scan-gate overlay distinguishes eligible and angle-blocked tiles;
      authorized previews use the score table rather than BLACK/GREY combat zones
- [x] Targeting explains deterministic geometry/cover factors and labels
      probabilistic outcomes as estimates, without previewing the actual roll

**Implemented contract**: planner-side firing helpers mirror the locked
range/cone/line-of-sight, endpoint-cover, and 20-entry live-fire score rules
without importing authoritative state or consuming RNG. Aim previews use only
explicitly authorized contacts; when none are supplied, the dialog presents
labeled hypothetical posture estimates for direct-fire weapons; explosive
weapons instead explain their deterministic impact and blast model without a
fictitious direct-hit score. Repeat fire is terminal for the remaining turn
budget, finite-ammo validation reserves the possible runtime consumption of
repeat/scan commands, and Scan & Fire defaults to the selected weapon's v1
range plus the robot's remaining whole-second budget. Planner dialogs contain
focus, own Escape, restore their opener, and suspend global shortcuts.

**Effort**: M.

---

### Phase 11 — Authoritative online turn loop + results [✅ DRAFT COMPLETE]

**Goal**: complete the asynchronous private plan → lock → leave if desired →
server resolve → return/watch → next-plan loop. The server receives immutable
orders, resolves exactly once after every player locks, stores the canonical
result durably, and sends each client only the state/events that player is
allowed to know.

**Dependencies**: Phases 7-10.

**Files**:

- `server/matches.ts` — authoritative phase machine, validation, resolution
- `server/view.ts` — participant-specific state/event projection
- `src/app/match/[id]/edit/page.tsx`
- `src/app/match/[id]/movie/page.tsx`
- `src/app/match/[id]/results/page.tsx`
- `src/components/match/TeamDataPanel.tsx` — authorized HP/score/contact data
- `src/components/match/ReadyPanel.tsx` — submitted/waiting status only
- `src/components/match/RoomStatus.tsx` — your-turn/waiting/result-ready state
- `src/components/match/ConnectionOverlay.tsx` — reconnect/resume UX
- `src/components/match/TurnExplanation.tsx` — concise post-turn causality log
- `src/engine/survival.ts` — last-Side-standing and exact ceremony scoring

**Turn protocol**:

- a client may submit/replace its own draft until `LockOrders`; after lock the
  orders are immutable and only ready/not-ready is public;
- the server validates ownership, command legality, budget, and current phase;
- after all locks, the server draws/records the turn seed, resolves once, stores
  the full canonical replay entry, and projects authorized results per player;
- movie playback is local and does not control simulation. Each client may
  pause, step, scrub, or select 0.5x/1x/2x/4x. Resolution opens turn N+1 on the
  server immediately; `TurnResultAcknowledged(N)` unlocks only that player's
  N+1 planner, so playback never needs a synchronized global gate;
- the player may close the app after locking. Resume sends the canonical room
  turn, authorized snapshot, own locked/draft state, every unseen resolved turn,
  and playback position. No AI takes over an absent player in v1;
- the home/room status view derives `your turn`, `waiting for N`, `turn ready`,
  or `finished` from durable server state. Optional push/email notification is
  not required for v1.

**Security/hidden-information gates**:

- never broadcast opponents' orders before or after resolution unless an event
  made the action observable under the visibility rules;
- never send full enemy state as a convenient client payload;
- do not disclose the current turn seed before resolution; validate all message
  sizes and rates; reject duplicate/stale requests idempotently;
- clients may simulate planner hints locally but never author shared outcomes.

**Tests required**:

- two-client integration: private drafts remain private, both lock, disconnect,
  server emits one canonical resolution, and each returns/watches/plans on an
  independent schedule;
- simultaneous duplicate submissions/resolution triggers are idempotent;
- close/reopen during planning, waiting, and movie restores the correct seat,
  unseen-result queue, and per-player acknowledgement without advancing twice;
- service restart after one lock and after resolution restores the room and
  never duplicates RNG consumption, events, score, or replay entries;
- visibility projection snapshots prove no unseen robot/order/seed leaks;
- playback speeds and skip-idle produce the same final rendered state;
- exported replay re-runs to byte-identical canonical events.

**Acceptance criteria**:

- [x] A complete two-player internet match is playable end to end
- [x] Final Ceremony uses exact Survival points and returns to the room/menu
- [x] Ready state reveals no plan details; leave/return recovers current progress
- [x] A player can submit, close the browser, later see “turn ready,” watch it,
      and submit the next turn without requiring simultaneous presence
- [x] Persistent Team Data and explanation panels show only authorized facts
- [x] The server stores and verifies the canonical replay through the Phase 5
      format; participant UI never exports private opposing orders

**Implemented contract**: `server/matches.ts` persists private drafts, current
locks, a seed/nonce/combined-order resolution record, canonical replay turns,
per-player acknowledgement, and per-player playback position. Resolution is a
single-process compare-by-state transition: a crash after the resolving record
is stored simply re-runs the pure engine with the same seed. Exact request
retries are no-ops even if the response cache was not committed. `server/view.ts`
removes unseen enemy robots and filters events at visibility boundaries. A newly
visible contact carries only the state needed to materialize its movie sprite;
the outbound step that loses visibility is suppressed, and damage to an owned
robot retains its observable amount while an unseen source is redacted. Neither
orders, seeds, nonces, nor hidden projectile details cross the participant
boundary. The WebSocket edge caps raw payloads and rate-limits each connection.
The planner saves or atomically locks its current draft, readiness shares status
only, recent-room cards show participant-specific match status, each player
watches and acknowledges independently, and the Final Ceremony uses the locked
Survival scoring helpers. Resolution verifies the complete stored canonical
replay before appending a turn. The four-browser room test covers lock, one
canonical resolution, independent acknowledgement, and Turn 2 planning;
restart tests cover partial lock, result recovery, duplicate lock, playback
resume, replay verification, and final scoring.

**Effort**: XL.

**Milestone**: this is the two-player online vertical-slice alpha. It is not the
v1 finish line until Phase 11.6 proves three- and four-player free-for-all play.

---

### Phase 11.5 — v1 explainability, onboarding, replay UX, and iPad input [✅ DRAFT COMPLETE]

**Goal**: make the simultaneous-programming game understandable without
changing its combat balance. Ship the high-value slice in v1; defer the large
encyclopedic help corpus. Phase 11.5 includes a compact in-game Field Guide
with **Robots**, **Terrain**, and **Actions** tabs plus contextual mini-modals.

**Dependencies**: Phases 8, 9, 10, 11 (so the things being explained exist).

**Files** (full list in §10):

- `src/components/help/Tooltip.tsx`, `InfoPopover.tsx`, `FirstTimeHint.tsx`, `HelpProvider.tsx`
- `src/components/help/FieldGuideDialog.tsx` — Robots / Terrain / Actions tabs
- `src/lib/help/content.ts` — typed presentation copy derived from canonical engine tables
- `src/lib/input/pointerGestures.ts` — shared tap/drag/pinch/long-press gesture adapter
- existing posture/heading/fire controls — visible touch alternatives to modifier-key actions
- `src/components/help/FirstTimeHint.tsx` — localStorage-backed first-use dismissal
- `src/components/match/TurnExplanation.tsx`
- `src/components/MovieControls.tsx`, `src/components/replay/EventInspector.tsx`, `ObservedTurnExport.tsx`
- `src/lib/explain/events.ts` — engine-event-to-human-cause projection

**Acceptance criteria**:

- [x] Every unfamiliar/icon-only planner/setup control has an accessible name,
      concise tooltip or adjacent help affordance, and keyboard focus state
- [x] The Field Guide has Robots, Terrain, and Actions tabs; it exposes v1
      class stats/roles, traversal/cover/sight rules, and action timing/targeting
      without duplicating authoritative numerical constants
- [x] An explicit adjacent `?` control opens details for every action; visible
      robots and terrain tiles also open the same anchored info popover by
      right-click, keyboard context-menu activation, or touch long-press
- [x] Contextual help is an accessible mini-modal: focus enters it, Escape and
      outside click close it, focus returns to its trigger, and it remains
      usable near viewport edges without obscuring the selected board object
- [x] The complete setup, planner, movie, results, and reconnect loop has a
      touch-only iPad interaction path
      with touch in iPadOS Safari in landscape without a mouse or keyboard
- [x] Pointer gestures are unambiguous: tap selects/targets, empty-arena drag
      pans, pinch zooms, and long-press opens contextual help; movement, scroll,
      pinch, second-pointer, and pointer-cancel transitions cannot fire a stale tap
- [x] Actions previously exposed through Shift/Ctrl modifiers have visible
      44×44 CSS px touch controls with the same planner semantics
- [x] Robot popovers reveal only generic class facts plus state already
      authorized for that player; unseen contacts and hidden orders never enter
      help props, analytics, DOM, or accessibility text
- [x] First planning visit teaches move, scan, timeline, lock, and hidden-order
      concepts; hints are dismissible and do not recur
- [x] The timeline exposes exact tick costs, slow-terrain route boundaries,
      remaining horizon, and scan/fire opportunity windows
- [x] After a turn, a player can answer “why did this hit/miss/damage happen?”
      from authorized event causes without seeing hidden information
- [x] Replay viewer supports scrub, step, speed, idle compression, event filter,
      and export of the deterministic participant-observed turn file; private
      canonical orders remain server-side
- [x] Full topic pages, global help cursor, and illustrated manual remain explicitly v2+

**Touch tests required**:

- unit tests cover tap-versus-drag thresholds, long-press cancellation,
  second-pointer/pinch transitions, pointer cancellation, and prevention of
  synthetic click double-activation;
- Playwright’s touch-enabled iPad viewport covers room join, one complete
  planned turn (move, scan, aim/repeat fire, edit, lock), movie controls,
  contextual help, results, and reconnect;
- before v1 release, repeat the complete loop on a physical iPad in current
  iPadOS Safari, including rotation recovery and safe-area layout. Emulation is
  useful regression coverage but does not satisfy the real-device ship gate.

**Effort**: XL.

**Implemented contract**: stable typed topic ids drive a lazy Field Guide and
native top-layer info dialogs. Catalog facts come from dependency-free canonical
engine data plus timing/traversal constants; Stealth remains excluded. The
planner supports click/tap selection, one-finger pan, pinch zoom, right-click,
keyboard context menu, and cancellable 550 ms long-press without double-firing.
Movie pan/zoom and all transport controls are touch-capable. First-use guidance
persists locally. The authorized event inspector filters movement, contacts,
combat, and system events, explains redacted unseen sources without guessing,
and exports only the participant-observed initial state/events.

**Verification**: 248 Vitest tests, strict typecheck, ESLint, production build,
four visual/browser tests including a 1024×768 touch context, and the complete
four-browser authoritative room/planner/movie regression pass. A physical iPad
Safari room-to-results smoke match remains the Phase 12 release gate and is not
claimed by emulation.

---

### Phase 11.6 — Three-/four-player online FFA hardening [⬜ FUNCTIONAL GATE]

**Goal**: extend the proven two-player online loop to three and four independent
human players. v1 supports only unique Sides: 1v1v1 and 1v1v1v1. The audited
alliance rules below are preserved for v2 but do not create v1 UI/protocol paths.

**Original-code parity gates — ✅ CLOSED 2026-07-15**:

- `+0x28` is Side: direct fire and Scan & Fire exclude same-Side Teams;
- explosives still damage same-Side allies;
- allied robots are always visible, but enemy contacts and last-known markers
  remain per Team and are not pooled across the Side;
- each Team contributes its base/robot/survival points, then the Final Ceremony
  aggregates the total by Side and repeats it on every allied Team row;
- canonical actor/candidate order is non-compacting Team-box/Home-slot order,
  then roster order;
- Team Name boxes map NW/NE/SE/SW even when some boxes are empty.

**v1 implementation work**:

- carry the engine's explicit `homeSlot`/home-corner assignment through setup,
  persistence, planner, and replay state; never derive it from compacted
  `teams[]` index;
- require one unique Side per connected player and reject 2v2/3v1/allied
  configurations in the v1 room validator;
- keep every player's orders and hidden information private while exposing only
  connection and ready/locked status;
- implement four per-Team enemy-contact/last-known visibility sets; exercise
  four Home Areas, four-team deployment,
  crossfire, simultaneous elimination, draw, last-Side-standing, replay, and
  ceremony flows end to end.
- test staggered asynchronous submission, leave/return, per-player unseen-turn
  acknowledgement, resignation, and abandoned-room handling with three and four
  clients, including nonadjacent Home slots.

**Acceptance tests**: two-player regression, three-player free-for-all,
four-player free-for-all, alliance configuration rejection, private orders and
sensor contacts, nonadjacent occupied Home slots, same-tick four-way crossfire,
simultaneous last-robot draw, disconnect/rejoin in every phase, independent
unseen-turn playback without a global gate, durable restart recovery, and byte-identical
replay for every supported configuration.

**Functional gate**: run at least one full match on four separate browser
sessions. No result or visibility divergence is acceptable. Production hosting,
two-real-network validation, and physical-device release checks close together
in Phase 12.

**Effort**: L.

---

### Phase 12 — v1 production, resilience, and physical-device gate [⬜ V1 SHIP GATE]

**Goal**: close every environment-dependent and cross-cutting requirement needed
to call the online free-for-all Survival v1 complete. Phase 11.6 proves the game
logic with four clients; this phase proves that the same product survives real
hosting, real networks, real reconnects, and touch-only play on physical iPadOS
Safari. Placeholder/vector art is acceptable and does not block this gate.

**Dependencies**: Phase 11.6 functional gate. The locally complete Phase 8 work
may proceed in parallel, but its production hosting gate must close here.

**Production and network gate**:

- implement and migrate the Supabase Postgres production adapter while keeping
  SQLite as the local/test profile;
- deploy the Next.js client to Vercel and the single authoritative WebSocket
  room service to a long-lived container or VM;
- verify secure WSS, restart recovery, durable rejoin ownership, private orders,
  and unseen-turn playback across two real networks/devices;
- complete a full four-player match without state, result, replay, or visibility
  divergence.

**Resilience and trust-boundary gate**:

- wrap planner and movie sections in React Error Boundaries with a plain recovery
  action;
- schema-validate incoming and outgoing WebSocket payloads, orders, arena data,
  and replay data rather than trusting TypeScript casts;
- distinguish connecting, retrying, resumed, room-expired, seat-forfeited, and
  incompatible-protocol outcomes in the reconnect UI;
- provide an explicit reset path for corrupt local planner/room data;
- preserve the previous canonical room state when resolution fails and return a
  safe user-facing error id without leaking hidden data;
- audit idempotency for start, lock, resolve, acknowledge, and resume retries.

**Physical-device and accessibility gate**:

- complete one physical-iPad Safari room-to-results match in landscape using
  touch alone, including rotation recovery, safe-area layout, reconnect, Field
  Guide/context help, planning, movie controls, and results;
- verify no clipped controls, accidental page gestures, hover-only dependencies,
  or sub-44×44 CSS px touch targets at the supported 1024×768 CSS-pixel viewport;
- verify keyboard reachability, visible focus, and non-color-only connection,
  readiness, selection, and result states;
- repeat the complete loop with desktop mouse and keyboard and confirm acceptable
  planner/movie responsiveness on the supported iPad.

**Acceptance gate**: production storage and WSS restart/rejoin checks pass; a
full match passes across two real networks; the physical-iPad touch-only smoke
match passes; desktop regression passes; required resilience states fail safely
and do not expose private information. Passing this phase means **v1 complete**.

**Effort**: L.

---

### Phase 13 — post-v1 presentation polish, art, and expanded performance [⏸ POST-v1]

**Goal**: improve presentation after the functional v1 ships: replace or refine
vector placeholders where playtesting justifies it, broaden visual regression
coverage, tune animation and rendering performance beyond the Phase 12 floor,
and add nonessential responsive/connection-state polish.

**Dependencies**: shipped Phase 12 and playtest feedback.

**Nonblocking scope**: bespoke art, aesthetic refinement, expanded browser and
device coverage, and deeper performance optimization. Audio, phone layouts,
native app packaging, and full screen-reader game-board support remain later
work.

**Effort**: L.

**Note**: audio explicitly deferred per user direction. Existing intentional
SVG/vector art is sufficient for the v1 gate.

---

### Phase 14 — Stealth parity [⏸ POST-v1]

**Hard gate**: the Phase 12 online FFA v1 release must pass before any Phase 14
implementation begins. Phase 13 presentation polish is not a dependency.

**Goal**: add the original Stealth class end to end: Custom Game availability,
visibility behavior, ordinary/Aim/Scan interactions, last-known markers,
planner disclosure rules, gameplay-facing asset use, replay coverage, and
focused binary/dynamic verification. Generic Stealth art may already exist;
do not retrofit speculative Stealth gameplay branches during Phases 1–11.

**Acceptance criteria**:

- [ ] Stealth has an updated claim-ledger-backed behavior spec
- [ ] Ordinary four-class Survival replays remain byte-identical
- [ ] Setup, planner, resolver, renderer, and tests cover Stealth explicitly

---

### Phase 15 — Non-Survival sports [⏸ POST-v1]

**Hard gate**: the online FFA Survival v1 must ship before any Phase 15
implementation begins. This phase is independent of Stealth and hot-seat.

**Goal**: audit and implement Treasure Hunt, Capture the Flag, Hostage, and
Baseball, including their setup objects, planner verbs, resolver rules,
scoring, ceremony output, replay schemas, UI, and tests. Add one sport at a
time; Survival behavior must not be generalized speculatively beforehand.

**Acceptance criteria per sport**:

- [ ] Binary/manual claims and confidence labels are complete
- [ ] Setup → planning → resolution → scoring → ceremony works end to end
- [ ] Survival regression suite remains unchanged and green

---

### Phase 16 — v2 local/hot-seat and alliance modes [⏸ POST-v1]

**Goal**: add the modes intentionally excluded from the internet FFA v1:
multiple local players sharing a device and multiple Teams sharing one Side.
This phase consumes the original-code alliance audit without burdening the v1
protocol or UI with unused branches.

**Dependencies**: shipped Phase 12 and stable production telemetry from v1.

**Implementation work**:

- local/hot-seat room adapter that uses the same authoritative phase machine,
  with a privacy handoff screen and per-player lock-in;
- configuration UI for 2v2, 3v1, and other legal Side assignments;
- same-Side direct-fire and Scan & Fire exclusion; explosive friendly damage;
- allies always visible, but enemy contacts/last-known markers remain private to
  each Team and are never pooled by Side;
- Final Ceremony aggregates Team contributions by Side and repeats the shared
  total on allied rows;
- replay/protocol versioning that represents Team ownership separately from
  Side without breaking v1 FFA files.

**Acceptance tests**: v1 online FFA regression, 2v2 and 3v1, allied direct-fire
immunity, allied blast damage, private allied contacts, Side-shared ceremony
totals, hot-seat information handoff, nonadjacent Home slots, and deterministic
replay for every configuration.

**Effort**: L.

---

## 5. Art & animation plan

### Style direction (locked: SVG vector)

**v1 ships SVG vector art** — clean modern shapes, top-down perspective, scalable, low file size, plays well with PixiJS. Looks intentional even at low effort. Pixel art is deferred to v2; bespoke commissioned art is post-v1.

Why SVG for v1:

- Scalable rotation without sprite-sheet variants (Pixi rotates via `sprite.rotation` so we draw 1 robot, not 8 facings)
- Small file size (a robot is ~1 KB SVG vs ~10-40 KB rasterized)
- Easy to author or AI-generate; clean palette by construction
- Crisp at any zoom level for the planner UI

### Asset inventory (v1)

**Terrain** (7 tile types — see §"Engine constants" §"Terrain"):

- `open-ground.svg` · `rough-ground.svg` · `low-wall.svg` · `wall.svg` · `bush.svg` · `crevice.svg` · `outer-wall.svg`

**Obstacle**:

- `crate.svg` (the blue obstacles in Rubble arenas)

**Robots** (4 main-game classes × 3 postures; prefer shared/layered SVG parts
where this avoids duplicate files; rotation done programmatically by Pixi):

- `rifle-standing.svg` · `rifle-crouching.svg`
- `burst-standing.svg` · `burst-crouching.svg`
- `auto-standing.svg` · `auto-crouching.svg`
- `missile-standing.svg` · `missile-crouching.svg`

Stealth gameplay belongs to post-main-game Phase 14. Forward-compatible Stealth
art may be generated and wired through the generic renderer, but it is not part
of the four-class main-game roster or any Phase 7/11 acceptance gate.

Each robot SVG includes a directional indicator (small arrow or "muzzle") so rotation is meaningful. Color is applied via Pixi `tint` per team — SVG drawn in neutral grey, tinted at runtime to team color.

**Projectiles**:

- `bullet.svg` (small, fast)
- `missile.svg` (longer, with smoke-trail anchor point)
- `grenade.svg` (round)

**Effects** (sprite sheet or animated SVG sequence):

- `explosion-small.svg` (hit feedback — replaces "Ha!"/"Ow!" speech bubbles per user direction)
- `explosion-large.svg` (destruction)
- `blast-radial.svg` (missile/grenade blast wave)
- `smoke-trail.svg` (missile particle)

**UI / icons**:

- Posture icons (standing / crouching) for the Tools panel
- Weapon icons (5 weapons)
- Scan-cone overlay (drawn with Pixi shapes, no SVG needed)
- Last-known-marker X (drawn with Pixi shapes)

### Production approach

For v1: AI-assisted authoring. Generate concept SVGs or hand-draw in a vector
tool, then iterate to a coherent palette. Stealth art may be present in the
shared asset set, but is not included in the main-game class count.

Asset directory: `public/assets/`. Loaded via a single `assets.ts` registry that maps semantic names to URLs. Pixi's `Assets.load` handles the rest.

### Animation handlers (per-event)

Implementation: `animations.ts` exhaustively maps every event kind and reduces
state-changing events into immutable snapshots. Pixi/GSAP visual handlers cover
the cue-producing rows below; all other event kinds intentionally have no visual cue.

| Event kind                              | Animation                                                  | Tools                              |
| --------------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| `deployed` / `move-step`                | place or tween the robot to its event-boundary tile        | GSAP tween on `container.position` |
| `posture-changed`                       | scale the layered robot silhouette for its posture         | GSAP scale tween                   |
| `scan-rotated`                          | smooth heading-needle rotation                             | GSAP tween on the scan needle      |
| `fired`                                 | short muzzle flash oriented toward the target              | sprite life cycle                  |
| `scan-target-acquired`                  | transient scan-lock reticle                                | sprite life cycle                  |
| `projectile-launched` (bullet/burst)    | short-lived straight tracer                                | temporary Pixi `Graphics`          |
| `projectile-launched` (missile)         | warm straight-line tracer from source to target            | temporary Pixi `Graphics`          |
| `projectile-impacted` (bullet)          | small explosion sprite at impact tile, fades over ~3 ticks | sprite life cycle                  |
| `projectile-impacted` (missile/grenade) | larger explosion + radial blast wave sprite                | sprite life cycle                  |
| `shot-missed`                           | compact dust miss at the target tile                       | sprite life cycle                  |
| `damaged`                               | compact hit burst on the target                            | sprite life cycle                  |
| `destroyed`                             | rotating explosion + fade out + remove sprite              | composed tween chain               |
| `enemy-lost` / `last-known-marker`      | transient last-known glyph at the event tile               | sprite life cycle                  |

The transient last-known movie cue communicates the emitted event only. The
persistent last-known X glyph carried into the following turn remains an
Edit-phase responsibility. Other planning/metadata events have no movie cue.

**Determinism note**: animations are _visual representations of events_; they do not affect engine state or timing. Movie player advances ticks based on `events[i].tick`, not on animation completion. If an animation runs longer than its tick budget (e.g., explosion fade), the next tick can start before it finishes; sprites just keep rendering.

---

## 6. Arena import notes

### Main-game approach (locked: binary MAP import)

The audited `.TWN` MAP payload is already a row-major terrain grid. Export it
directly with `tools/re/export_data.py`; do not hand-transcribe it. The original
display adds an 8-tile border but performs no coordinate flip or transpose.

**Import process**:

1. Verify the source package hash through `tools/re/verify_claims.py`.
2. Export MAP cells as `tiles[y][x]` and validate dimensions/checksums.
3. Generate home rectangles from the exact 6/8/12/16 per-axis thresholds;
   represent Dock as off-field robot state.
4. Render one review view and inspect unknown/suspicious terrain codes.

### Post-v1 optional extraction script

The previous screenshot-classifier plan is deferred tooling. Revive it only if manual coordinate probes become more painful than maintaining the tool.

**Input**: 4 screenshots per arena, taken with the playing-field viewport scrolled to each corner (NW / NE / SE / SW). Each captures ~22×16 tiles of a 32×32 arena, with substantial overlap (~14 tiles each direction).

**Process** (if the optional `tools/extract-arena.ts` is revived):

1. **Auto-detect playing field bounds** in each screenshot via the red outer-wall color signature. Falls back to a hard-coded calibration for the DOS Windows UI if auto-detect fails.
2. **Identify tile pixel size** (typically 16 or 24 px depending on zoom level).
3. **Sample each tile**: take a 4×4 block at the tile center, compute average HSL.
4. **Classify** against a palette table:
   - Open ground: light grey-green dotted (low saturation, high lightness)
   - Rough ground: darker brown speckled
   - Bushes: high-saturation green
   - Walls: saturated red, solid
   - Low walls: red but narrower band
   - Crevices: dark gold zigzag (high saturation, low lightness)
   - Crates: bright blue
5. **Stitch quadrants**: each tile gets up to 4 votes (one per screenshot it appears in).
   - **Unanimous** → `confidence: high`
   - **Single source** → `confidence: medium`
   - **Disagreement** → `confidence: low`, flagged for manual review
6. **Output** `arena.json` to `src/lib/arenas/`.

### Calibration table (DOS Windows UI)

Hard-coded fallback values — verified against the user's existing screenshots:

```ts
// Battle / Rubble Three (32×32) at standard window size
const RUBBLE_THREE_CALIBRATION = {
  playingFieldOriginPx: { x: 4, y: 84 }, // pixel offset of playing-field top-left in screenshot
  tileSizePx: 24, // pixels per tile
};
```

These are verified once and reused; auto-detect re-confirms per screenshot in case the user resizes the window or zooms.

### Reviewing flagged tiles

A companion mode `--review-flagged` opens a small browser tool:

- Renders the current arena.json overlay on the source screenshots
- Highlights `low`-confidence tiles
- User clicks a tile → terrain palette → updates JSON
- Saves on disk

This tool could also become a scenario editor later. Original RoboSport had Scenarios as a first-class concept, but scenario authoring is not on the v1 path.

### Output schema

```ts
// src/lib/arenas/rubble-three.json (excerpt)
{
  "name": "Rubble Three",
  "type": "rubble",
  "size": "battle",
  "width": 32,
  "height": 32,
  "tiles": [
    [{"terrain":"outer-wall"}, {"terrain":"open"}, ...],  // y=0 row
    [{"terrain":"outer-wall"}, {"terrain":"open"}, ...],  // y=1 row
    ...
  ],
  "metadata": {
    "source": "version-locked TWN MAP export",
    "unknownTiles": [],
    "sourceSha256": "..."
  }
}
```

`loadArena` attaches `createHomeAreas(width,height)` after validating the JSON.
Dock remains `RobotState.position === "dock"`, not an arena tile list.

### Per-arena requirements

For each arena (Rubble Two/Three at minimum for v1; Suburbs/Computer Town deferred):

- Export MAP rows with `tools/re/export_data.py`.
- Validate exact dimensions and generate homes with `createHomeAreas`.
- Mark unknown tiles explicitly with notes; do not silently guess.
- Commit the generated arena JSON with source hash/provenance, but no original
  tile art.

---

## 7. State management architecture

**Locked for v1: the durable server owns all shared room/match state. Zustand owns only
client UI, local planner drafts, playback controls, settings, and connection
snapshots.**

### State boundaries

| State kind                                                          | Where it lives                                                                                               | Mutability                                     | Notes                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------- |
| **Engine state** (`MatchState`, accepted `TurnOrders`, `ReplayLog`) | Server room process                                                                                          | Immutable; engine returns new instances        | Canonical source of truth                                     |
| **Server-authoritative room/match state**                           | Server memory cache backed by transactional storage (SQLite local/test; Supabase Postgres production target) | Mutated only by validated protocol transitions | v1 authority, async recovery, and hidden-information boundary |
| **Client UI state** (planner draft, selected robot, dialog open)    | Zustand stores                                                                                               | Mutable; React subscribes via hooks            | Per-tab, per-session                                          |
| **Client persistent state** (settings, rejoin token)                | Zustand + localStorage (`zustand/middleware/persist`)                                                        | Mutable; auto-synced to localStorage           | Token restores only the owned room seat                       |
| **Renderer state** (Pixi sprite positions, tweens, current frame)   | Pixi-internal                                                                                                | Mutable; React reads only via refs             | Animation; not in Zustand                                     |

### Stores

```ts
// src/state/

useMatchStore        // latest authorized server snapshot + phase
usePlannerStore      // draft TurnOrders for current turn, selected robotId,
                     //   command-being-edited, scan-direction preview
useMoviePlayerStore  // currentTick, isPlaying, speed (.5x|1x|2x|4x), frame buffer
useSettingsStore     // user preferences (animation speed, hide/show paths, panel layout);
                     //   persisted via zustand/middleware/persist
useRoomStore         // roomCode, public players/readiness, connection, own role
FirstTimeHint local key // (Phase 11.5) whether planner basics were dismissed
```

### Sync patterns

- **Online v1**: server snapshots replace client shared state. A client submits
  only its own orders; the server validates and resolves once all players lock,
  then sends participant-specific events/state. Refresh or a later visit resumes
  with the rejoin token and unseen-turn cursor. The client never treats a local
  simulation as a shared result.
- **Optimistic UI during planning**: `usePlannerStore` holds the draft `TurnOrders`. Lightweight engine helpers (path validity, scan-cone classification) run on the client to give live feedback without round-trips.

### Time-travel / debugging

- Zustand has Redux DevTools middleware — straightforward integration in dev builds, stripped in prod.
- Replay format (Phase 5) is the production-quality time-travel mechanism — any past match can be re-run tick-by-tick.

### Files (introduced in Phase 8)

- `src/state/useMatchStore.ts`
- `src/state/usePlannerStore.ts`
- `src/state/useMoviePlayerStore.ts`
- `src/state/useSettingsStore.ts` (with `persist` middleware)
- `src/state/useRoomStore.ts` (Phase 8)
- `src/components/help/FirstTimeHint.tsx` localStorage key (Phase 11.5)

---

## 8. Routing & URL design

### URL space

| Path                      | Purpose                                          | Auth                         | Notes                                                |
| ------------------------- | ------------------------------------------------ | ---------------------------- | ---------------------------------------------------- |
| `/`                       | Create room / join room / open replay            | none                         | v1 entry                                             |
| `/room/:code`             | Join or resume room; setup and readiness         | participant token after join | v1 deep link                                         |
| `/setup/custom`           | Custom Game team builder                         | none                         | Post-v1                                              |
| `/match/:matchId`         | Active match (entry; redirects to current phase) | participant only             |                                                      |
| `/match/:matchId/edit`    | Edit phase (turn programming)                    | participant only             |                                                      |
| `/match/:matchId/movie`   | Movie playback for the just-resolved turn        | participant only             | `?t=N` deep-links to a tick                          |
| `/match/:matchId/results` | Final Ceremony / scoring screen                  | participant only             |                                                      |
| `/replay/:replayId`       | Replay viewer                                    | none                         | v1 imports local replay data; public IDs are post-v1 |
| `/replay/:replayId/share` | Embeddable share card / OG metadata              | none                         | Post-v1                                              |
| `/teams`                  | Saved team library                               | library token                | Post-v1                                              |
| `/settings`               | User preferences                                 | none                         | Persisted to localStorage                            |
| `/help/:topic`            | Static help articles (terrain, weapons, etc.)    | none                         | Post-v1 full help                                    |

### ID conventions

- **Match IDs**: 10-character `nanoid` slug (e.g., `ZbV2Ch9rQp`). Private — only participants get the URL.
- **Replay IDs**: 10-character `nanoid` slug. Public; URLs are shareable.
- **Room codes**: 6-character uppercase alphanumeric (e.g., `ABC123`). Memorable and verbal-shareable; maps internally to a match after 2-4 players start.
- **Tick deep-links**: query string `?t=N` on movie or replay routes; player loads paused at that tick.

### Sharing patterns

- **Room invite**: full URL like `/room/ABC123` is shareable; alternatively the 6-character code is verbal.
- **Replay share**: full URL like `/replay/ZbV2Ch9rQp` with optional `?t=` for paused-at-tick.
- Active matches are URL-private (only participants get the link).

---

## 9. Persistence model

**v1 locked**: no accounts, but asynchronous rooms require durable storage.
Use Supabase Postgres for production and local Supabase Postgres for the normal
development profile. SQLite WAL remains a local/test adapter while the Postgres
adapter lands; it must not be deployed inside a Vercel Function. Store room
configuration/state, token hashes, accepted orders, per-player
`seenThroughTurn`, canonical turn results, and replay digests transactionally.
The browser stores only settings, room references, and opaque rejoin tokens;
completed replays can be exported as JSON.

The authoritative long-lived room service is the only database client. The
Vercel browser application receives only its public WSS URL; database URLs and
service credentials are server-only. Room semantics must remain independent of
the selected storage adapter.

### What lives where

| Kind                                        | Where                                                                        | Lifetime                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------- |
| Active rooms/matches                        | Supabase Postgres + room-service memory cache (SQLite in local/test profile) | Until finished/abandoned and retention cleanup runs |
| Own room rejoin token                       | Client localStorage                                                          | Until room expires or storage is cleared            |
| Canonical turn/replay data                  | Supabase Postgres; completed export JSON                                     | Room lifetime; export is player-owned               |
| Saved teams                                 | v1 built-in presets; post-v1 local/shared library                            | Presets only in v1                                  |
| User settings                               | Client localStorage (`useSettingsStore` with `persist` middleware)           | Until cleared                                       |
| Participant token (anonymous room identity) | Client localStorage                                                          | Per room; opaque and server-issued                  |
| Last-played-config                          | Client localStorage                                                          | Until overwritten                                   |

### Post-v1 shared-storage schema sketch

```sql
CREATE TABLE replays (
  id            TEXT PRIMARY KEY,            -- 10-char nanoid
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  config        JSONB NOT NULL,              -- GameConfig
  data          JSONB NOT NULL,              -- ReplayLog
  format_version INT NOT NULL DEFAULT 1,
  owner_token   TEXT,                        -- anonymous identity
  team_names    TEXT[] NOT NULL              -- denormalized for listing
);

CREATE TABLE teams (
  id          TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  name        TEXT NOT NULL,
  data        JSONB NOT NULL,                -- team composition
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_replays_owner ON replays(owner_token);
CREATE INDEX idx_teams_owner   ON teams(owner_token);
```

### v1 exactly-once resolution storage rule

The final lock transaction stores every order, a chosen turn seed, and a unique
resolution nonce before marking the turn `resolving`. Resolution may run outside
the database transaction. Committing `{ nextState, events, digest }` uses a
compare-and-set on that nonce and creates turn N+1 atomically. If the service
crashes while `resolving`, restart re-runs the pure engine from the already
stored state/orders/seed; deterministic output and the unique turn key prevent
double RNG consumption, score, or replay entries.

### v1 local database setup

The Supabase CLI reports the local connection string after `npx supabase start`.
The default is:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Keep SQL migrations in `supabase/migrations/`. The room service reads
`DATABASE_URL` only on the server. Local and hosted Supabase projects use the
same migrations; only the connection string changes.

### Post-v1 shared-library API endpoints

| Method   | Path                      | Purpose                                         |
| -------- | ------------------------- | ----------------------------------------------- |
| `POST`   | `/api/replays`            | Save a finished match's replay → `{ replayId }` |
| `GET`    | `/api/replays/:id`        | Fetch replay JSON                               |
| `GET`    | `/api/replays?owner=mine` | List replays I own                              |
| `POST`   | `/api/teams`              | Save a team                                     |
| `GET`    | `/api/teams`              | List my teams                                   |
| `DELETE` | `/api/teams/:id`          | Delete a team (owner check)                     |

Server reads `X-Browser-Token` header; passes through on reads, requires on mutations. No real auth in the first shared-persistence pass — token is honor-system anonymous identity.

### Replay format versioning

Serialized replays carry `formatVersion`; the SQL storage column remains
`format_version`. Version 1 rejects unknown versions. When a version 2 format
actually exists, add a migration entry to a small table:

```ts
const replayMigrations: Record<number, (data: any) => ReplayLog> = {
  // 1: identity
};
```

CI must then gate a corpus of version 1 replays through migration and
`verifyReplay`. Do not build the migration framework before a second format
exists.

### Post-v1 shared-library API endpoints (detailed auth)

| Method   | Path                      | Purpose                                         | Auth                        |
| -------- | ------------------------- | ----------------------------------------------- | --------------------------- |
| `POST`   | `/api/replays`            | Save a finished match's replay → `{ replayId }` | browser-token               |
| `GET`    | `/api/replays/:id`        | Fetch replay JSON                               | none (public)               |
| `GET`    | `/api/replays?owner=mine` | List my replays                                 | browser-token               |
| `POST`   | `/api/teams`              | Save a team                                     | browser-token               |
| `GET`    | `/api/teams`              | List my teams                                   | browser-token               |
| `DELETE` | `/api/teams/:id`          | Delete a team                                   | browser-token (owner check) |

### Browser-token identity

- Generated on first visit (`crypto.randomUUID()`); stored in localStorage.
- Sent as `X-Browser-Token` header on all API calls.
- Server treats it as anonymous identity — not linked to email, no signup. Clearing localStorage = "forget me".
- This is good enough for friend-scale shared persistence (no accounts, no recovery); promotable to real accounts later.

---

## 10. Onboarding, explanation, and help

**v1 locked**: concise tooltips, a compact Robots/Terrain/Actions Field Guide,
contextual info popovers, first-use planning guidance, exact timeline feedback,
post-turn cause explanations, and replay inspection are part of the main-game
finish line. The global help cursor, full illustrated article library, and
interactive tutorial are post-v1.

### Component split

1. **v1 tooltips** — brief, non-interactive hover/focus labels for every
   non-obvious control.
2. **v1 contextual info** — an anchored accessible mini-modal for detailed bot,
   terrain, or action facts. Explicit `?` buttons are the universal trigger;
   right-click, keyboard context-menu activation, and touch long-press are
   additional triggers where an object exists on the board.
3. **v1 Field Guide** — one dialog with Robots, Terrain, and Actions tabs. It is
   the complete compact v1 reference, not an illustrated encyclopedia.
4. **v1 first-time hints** — small dismissible guidance for planning, locking,
   ready status, hidden orders, and movie controls.
5. **v1 explanations** — authorized event causes translate hit, miss, damage,
   cover, timing, and elimination events into concise text.
6. **post-v1 help cursor/articles** — indexed illustrated reference material.

### Files

- `src/components/help/Tooltip.tsx` — brief hover/focus primitive
- `src/components/help/InfoPopover.tsx` — anchored accessible mini-modal with
  click/context-menu/long-press trigger adapters
- `src/components/help/FieldGuideDialog.tsx` — v1 Robots / Terrain / Actions reference
- `src/components/help/HelpDialog.tsx` — post-v1 full-article dialog
- `src/components/help/HelpCursorToggle.tsx` — post-v1 button + `?` key handler
- `src/components/help/FirstTimeHint.tsx` — dismissible planner-basics card with a localStorage key
- `src/components/help/HelpProvider.tsx` — context that exposes `useHelp()`
- `src/lib/help/content.ts` — typed v1 reference content derived from
  `ROBOT_CATALOG_DATA`, `WEAPON_CATALOG_DATA`, timing constants, and
  terrain/traversal helpers
- `src/components/match/TurnExplanation.tsx` — v1 authorized cause log
- `src/lib/explain/events.ts` — v1 structured explanation projection
- `src/lib/help/topics/`, `src/app/help/[topic]/page.tsx`, and
  `public/assets/help/` — post-v1 illustrated reference

### Contextual-help interaction contract

- `?` is always rendered as a real keyboard-reachable button next to an action
  label; contextual gestures are never the only way to discover help.
- Right-click suppresses the browser menu only on a recognized bot or terrain
  target. Keyboard users receive the same behavior from the Context Menu key or
  Shift+F10 on that target.
- Touch long-press opens help after 550 ms and cancels if the pointer moves more
  than 8 px, scrolling begins, a second pointer appears, or the pointer ends.
  It shares the v1 Pointer Events gesture adapter with supported iPad gameplay,
  so long-press never also selects, targets, pans, or zooms.
- The popover uses dialog semantics, names the selected object, moves focus to
  its close control, closes on Escape/outside press, and restores focus.
- Board help receives only the participant-projected robot/tile data already in
  the renderer. Generic Field Guide class entries may describe every shipped
  non-Stealth v1 class, but never reveal an unseen live robot or private order.
- Rich content is loaded only when the Field Guide or a contextual popover is
  opened; stable typed ids (`robot:rifle`, `terrain:bush`, `action:scan-fire`)
  select content without passing the whole match state through React context.

### Field Guide content

- **Robots**: class art, armor, accuracy, rating, weapons/ammo, posture behavior,
  and a short tactical role. Stealth is omitted until Phase 14.
- **Terrain**: sprite, posture traversal, one-/two-tile movement behavior,
  endpoint cover, scan-sight effects, and blocking behavior.
- **Actions**: exact tick cost or cadence, prerequisites, targeting/acquisition,
  deterministic versus probabilistic factors, timeline behavior, and shortcut.

Numerical facts come from `src/engine/constants.ts`, `src/engine/catalog.ts`, or
pure terrain/action helpers. `content.ts` adds labels and prose but must not
redeclare armor, range, timing, ammo, cover, or damage tables.

### Content — terrain info example

```md
# Bushes

[bush sprite]

Bushes can contribute endpoint cover from the target tile or a sampled neighbor
toward the shooter. Upright / Ducking / Crouching resolve to cover class 4 / 3 / 2.

**Movement**: Upright and Ducking robots may cross bushes, but bush waypoints
cannot participate in a 40-tick two-tile command. Crouching is blocked.

**Cover**: cover class feeds the exact live-fire score table and damage
adjustments. It is not a separate flat evasion percentage.

Tip: only the confirmed target-end samples matter; a remote bush elsewhere on
the shot line is not generic path cover.
```

(All copy short, scannable, paired with sprite + a screenshot when useful.)

### Tutorial deferred

A proper interactive tutorial is a v2 deliverable. v1 should teach the actual
online FFA loop in place and avoid copying original scenario content or assets.

---

## 11. Error handling & resilience

Scoped for friend-group internet play. Pragmatic failure handling, with room
integrity and hidden-information boundaries treated as correctness requirements.

**Required v1 patterns**:

- **React Error Boundaries** wrap major UI sections (planner, movie). Fallback = error message + reload button.
- **Schema validation at every trust boundary** including WebSocket messages,
  orders, arena JSON, and replay JSON.
- **Discriminated unions for outcome types** (`FireResolution` etc.) — no silent failures, no `null`-means-"failed".
- **localStorage corruption fallback**: parse errors on hydrate → prompt user to reset; wipe key.
- **Engine errors** (`resolveTurn` throws): the server stops the room transition,
  preserves the previous canonical state, returns a safe error ID, and logs the
  structured cause without leaking hidden data.
- **Reconnect state machine** distinguishes connecting, retrying, resumed,
  room-expired, seat-forfeited, and incompatible-protocol outcomes.
- **Idempotency** protects start, lock, resolve, acknowledge, and resume from
  retries/duplicate messages.

**Out of v1 scope** (deferred to post-v1):

- Sentry / third-party error reporting
- multi-instance room migration and distributed-state repair
- Tab-collision detection ("match open in another tab")
- push/email notifications and background service workers

Transient connection failure and ordinary infrastructure restart must recover
in v1. Missing/corrupt durable state is a fatal room error and must be reported
plainly rather than guessed or reconstructed from a client.

**Files**:

- `src/components/errors/ErrorBoundary.tsx`
- `src/lib/net/protocol.ts` (Phase 8)
- `src/lib/net/reconnect.ts` (Phase 11)

---

## 12. Browser, input, and device matrix

### v1 target (locked)

- **Desktop**: minimum viewport **1280×720**, mouse + keyboard. Smaller desktop
  viewports show "Please use a larger screen for the best experience."
- **iPad**: browser-based iPadOS Safari in landscape at **1024×768 CSS px** or
  larger, using touch alone. Portrait shows a rotate-device prompt. Phones and
  native-app packaging remain post-v1.
- **Browsers**: desktop Chrome 110+, Edge 110+, Firefox 115+, Safari 16.5+;
  current and previous major iPadOS Safari. Test desktop Chrome/Firefox and real
  iPad Safari at minimum; other iPad browsers are best-effort.
- **OS**: Windows / macOS / Linux desktops plus iPadOS. Browser handles
  abstraction; no native platform code.
- **Input architecture**: Pointer Events provide shared tap/click, drag, and
  long-press arbitration. Touch gameplay must not depend on hover, right-click,
  keyboard modifiers, or Apple Pencil.

### Mouse interactions

| Interaction                            | Action                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| Left click on tile                     | primary action (place / move / target)                                |
| Right click on a bot/terrain tile      | open its Phase 11.5 contextual info popover                           |
| Touch long-press on a bot/terrain tile | open its Phase 11.5 contextual info popover without also selecting it |
| Shift + left click                     | set scan direction (mirrors original)                                 |
| Ctrl + Shift + left click              | repeat-fire (mirrors DOS shortcut)                                    |
| Mouse drag on empty area               | pan camera                                                            |
| Mouse wheel                            | zoom camera (Phase 9+)                                                |
| Hover                                  | tooltip / cursor state (target sight / blocked / out of range)        |

### iPad touch interactions

| Interaction                   | Action                                                        |
| ----------------------------- | ------------------------------------------------------------- |
| Tap bot/tile/control          | select or perform the current primary action                  |
| Drag from a movement endpoint | extend/edit the planned route                                 |
| Drag on empty arena           | pan camera                                                    |
| Two-finger pinch              | zoom camera around the gesture midpoint                       |
| Long-press bot/terrain        | open contextual info; cancel the pending tap                  |
| Touch action-bar button       | set scan direction, repeat-fire, and other modifier-key modes |
| Timeline tap/drag             | select or scrub a command/tick without page scrolling         |

All touch controls use at least 44×44 CSS px hit targets, respect safe-area
insets, and expose selected/disabled state without relying on hover. Canvas
gesture ownership uses deliberate `touch-action` regions: browser page scrolling
remains available outside the arena and timeline.

### Keyboard shortcuts

Ported from the original's keyboard reference where modern equivalents exist:

| Key            | Action                                                           |
| -------------- | ---------------------------------------------------------------- |
| `?` or `H`     | Open the v1 Field Guide; global help-cursor mode remains post-v1 |
| `Cmd/Ctrl + S` | Save match (manual save anchor)                                  |
| `Cmd/Ctrl + E` | End turn                                                         |
| `Cmd/Ctrl + D` | Toggle Team Data panel                                           |
| `Cmd/Ctrl + A` | Next robot                                                       |
| `1` … `8`      | Select robot by index                                            |
| `Space`        | Center on active robot / toggle to scanning range                |
| `Shift` (held) | Scanning-direction cursor mode                                   |
| `Esc`          | Cancel current action / close dialog                             |
| `←` `→`        | Movie playback: step backward / forward                          |
| `,` `.`        | Movie playback: slower / faster                                  |
| `Tab`          | Cycle UI focus (a11y)                                            |

Defer phone layouts, Android tablet certification, and native app packaging to
post-v1. iPad touch support is part of the v1 ship gate.

---

## 13. Cross-cutting concerns

### Determinism contract (engine)

- `Math.random()` and `Date.now()` are **forbidden** in `src/engine/`. Enforced by ESLint custom rule (lands in Phase 1.5).
- Only integer arithmetic on game-state values where possible. Distances and damage are integers. Projectile travel is renderer-only interpolation; the engine stores no authoritative mid-flight position.
- `verifyReplay` against canned replays runs in CI from Phase 5 onward.

### Testing strategy

| Layer             | Tool                      | Scope                                                                                     |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------------- |
| Unit              | Vitest                    | Pure functions (engine, planner helpers) — colocated `*.test.ts`                          |
| Integration       | Vitest                    | Full `resolveTurn` runs against canned `MatchState`s — `src/engine/__integration__/`      |
| Replay regression | Vitest                    | Curated `ReplayLog`s verify byte-equal across engine refactors — `src/engine/__golden__/` |
| Component         | Vitest + @testing-library | React components — colocated `*.test.tsx`                                                 |
| Protocol          | Vitest                    | Runtime schemas, authorization, idempotency, visibility projections                       |
| E2E               | Playwright                | Create/join plus full 2-4 browser online match flow — `e2e/` (Phases 8-11.6)              |

### Documentation conventions

- High-level: markdown in `docs/`. Locked numerical constants live in `docs/spec.md`; `src/engine/constants.ts` and `src/engine/catalog.ts` are the literal data tables.
- Module-level: top-of-file JSDoc block in each `src/engine/*.ts` citing the spec section it implements.
- Public APIs: JSDoc on exported functions/types.

---

## 14. Open questions & risks

| Question                                           | Impact                         | Resolution path                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projectile screen speed                            | Phase 7 presentation           | Tune animation without changing engine outcomes or replay state                                                                                                        |
| Stealth × Scan-and-Fire interaction                | Post-main-game Phase 14        | Do not introduce it into Phase 4 or any Phase 1-11 acceptance gate                                                                                                     |
| Arena import accuracy                              | Phase 6                        | Verify generated row-major MAP output and exact generated home rectangles                                                                                              |
| iPad touch playability                             | v1 ship gate (§12)             | Validate the complete loop on real iPadOS Safari in landscape; phones, Android tablets, and native apps remain post-v1                                                 |
| WebSocket hosting/reliability                      | Phase 8 onward                 | Validate the Vercel frontend + external long-lived WSS service + Supabase Postgres restart path on two real networks; keep one authoritative room process in v1        |
| Absent player stalls orders                        | Inherent asynchronous tradeoff | Show exactly who is pending; support voluntary resign/host abandonment; do not invent AI orders or silent auto-forfeits in v1                                          |
| Replay format breaking changes                     | Phase 5+                       | Version 1 rejects unknown versions; add migrations and old-fixture CI when version 2 exists (§9)                                                                       |
| Named weapon mapping for binary damage/fire tables | Closed in Phase 1R             | Selector dispatch and live callers are source-locked in the claim ledger                                                                                               |
| Sport modes beyond Survival                        | Out of v1                      | All non-Survival modes deferred; engine reserves `sportType` field                                                                                                     |
| AI tiers                                           | Out of main game               | Deferred until after the explicitly scheduled parity phases                                                                                                            |
| Audio / SFX / music                                | Out of v1                      | Deferred to post-v1 entirely                                                                                                                                           |
| Localization                                       | Out of v1                      | English only; not building i18n hooks                                                                                                                                  |
| Accessibility                                      | Partial v1                     | Keyboard-reachable controls, focus states, readable/non-color-only status, 44×44 touch targets, and iPad touch parity; full game-board screen-reader support later     |
| Security / abuse prevention                        | Bounded v1                     | Server validation, ownership checks, payload limits, basic rate limits, hidden-state filtering; DDoS/abuse operations remain post-v1                                   |
| Privacy / analytics / cookie policy                | Out of v1                      | No third-party analytics; participant tokens identify only a room seat                                                                                                 |
| License / legal disclaimers                        | Out of v1                      | Defer until shared publicly                                                                                                                                            |
| Production observability                           | Out of v1                      | Console logs are fine for personal use; no Sentry / metrics / alerts                                                                                                   |
| Full help/tutorial system                          | Post-v1                        | v1 includes tooltips, first-use loop guidance, event explanations, and replay inspection                                                                               |
| Account system                                     | Out of v1                      | No accounts; opaque server-issued rejoin token owns one room seat                                                                                                      |
| Achievements / progression                         | Out of v1                      | Original had none; matches are standalone                                                                                                                              |
| Visual regression testing                          | Out of v1                      | Add when art breakage actually causes pain                                                                                                                             |
| Server scaling                                     | Out of v1                      | Single authoritative room-service process, Supabase Postgres, and memory cache; friend-scale only                                                                      |
| Spectator / live spectating                        | Out of v1                      | Public replay URLs cover the main case                                                                                                                                 |
| Hosting platform choice                            | Phase 8                        | Vercel hosts Next.js; Supabase hosts Postgres; select a long-lived container/VM host for the single-process WSS service without coupling room semantics to that vendor |
| Original-game source files                         | Cleanup                        | Keep manual dumps, screenshots, and original packages local and gitignored; publish summarized research notes only                                                     |

---

## 15. Glossary & cross-references

- **`docs/spec.md`** — canonical current spec; locked rules, confidence labels, and numerical constants.
- **`docs/initial-plan.md`** — historical planning log; do not treat as canonical.
- **`docs/priority-tests.md`** — empirical research log; Match 1-7 results
- **`docs/empirical-tests.md`** — broader empirical-test catalog (T1-T24)
- **Local ignored source captures** — original-game manuals, screenshots, and packages used only for private empirical research
- **`references/source-matrix.csv`** — evidence map; useful for provenance, but may lag `docs/spec.md`
- **`tests/original-game-test-plan.md`** — original DOSBox empirical-test plan
- **`src/engine/`** — Phase 1 implementation; `constants.ts` and `catalog.ts` are the literal source of truth for values explained by `docs/spec.md`.

**Key terminology**:

- **Aim & Fire**: tile-targeted single-shot fire mode. Bullet flies to a fixed tile; doesn't track target.
- **Scan & Fire**: enemy-acquired wait-and-shoot mode. Robot watches a cone,
  selects an eligible enemy, then locks that enemy's current tile/result at the
  fire boundary.
- **Movement cost**: fixed 30-tick one-tile and 40-tick two-tile selector costs;
  the original movement resolver has no stride-parity state.
- **Scan sight strength**: the scan cone is the inclusive forward semicircle
  (`dot >= 0`). Terrain sight starts at 16, loses 3 per Low Wall/Bush sample,
  and becomes 0 at a Wall. Scan & Fire subtracts 4/2/0 from score at strengths
  `<=4` / `<=8` / `>8`; Aim & Fire passes 16.
- **Cover**: endpoint terrain samples plus posture produce cover class 1-4;
  that class contributes to live-fire hit score and damage adjustment.
- **Replay**: `{ initialState, turns: { seed, orders }[] }` — re-runs
  deterministically with the authoritative seed recorded per turn.
- **Tile locking**: Aim & Fire uses the programmed tile; Scan & Fire acquires a
  robot but snapshots its current tile when firing. Neither supports in-flight
  dodge or impact-time retargeting.

---

## 16. Visual style guide

A small palette + token table so UI chrome, SVG assets, and terrain rendering share the same source of truth. Lives in `src/lib/design-tokens.ts` and is referenced from §5 (asset authoring) and §6 (arena rendering).

### Palette

```ts
// src/lib/design-tokens.ts

export const PALETTE = {
  // App chrome
  appBg: "#1a1a1f",
  panelBg: "#272731",
  panelBorder: "#3a3a48",
  textPrimary: "#e8e8ee",
  textMuted: "#8a8a99",
  accent: "#5c8aff", // links, active state
  warning: "#ffb84d",
  danger: "#ff5c6a",

  // Team colors (4 distinct, colorblind-distinguishable)
  team1: "#e84a4a", // red
  team2: "#5c8aff", // blue
  team3: "#54c878", // green
  team4: "#ffd24a", // yellow

  // Terrain rendering
  terrain: {
    open: { fill: "#3d6a3d" },
    rough: { fill: "#6e5a3a" },
    bush: { fill: "#2e8c3e" },
    lowWall: { fill: "#a04040" },
    wall: { fill: "#e02828" },
    crevice: { fill: "#4a3a1a" },
    crate: { fill: "#3a6acc" },
    outerWall: { fill: "#7a2020" },
  },

  // Effects
  bulletColor: "#ffe680",
  missileColor: "#ffa64d",
  smokeColor: "#aaaab0",
  explosionColor: "#ff8a3a",
  lastKnownX: "#ff5c6a",
};
```

Numbers are starting points — tune in visual playtest. If the deferred extraction script returns later, add classifier metadata then.

### Typography

- **Body / UI**: `Inter` (Google Fonts) — neutral, readable at small sizes
- **Display / numbers**: `JetBrains Mono` for the timeline / coords / Team Data table — fixed-width keeps numerical UIs aligned

### Spacing

Tailwind v4 defaults (4 px base; `space-y-2` = 8px, etc.) — no custom scale.

### Animation timings

| Animation                          | Duration                                                   | Notes                                    |
| ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| Move-step lerp                     | matches the selector budget: 0.50 s single / 0.67 s double | Engine-driven                            |
| Posture sprite swap                | 100 ms cross-fade                                          | Decorative                               |
| Scan rotation                      | 5 ticks / 83 ms for any changed absolute heading           | Engine-driven                            |
| Bullet projectile                  | 1 ms per pixel × distance, capped 200 ms                   | Decorative; impact tick is engine-driven |
| Missile projectile + smoke trail   | 80 ms per tile traveled                                    | Smoke particles fade over 600 ms         |
| Hit flash (red tint on target)     | 150 ms                                                     | Decorative                               |
| Small explosion sprite (hit)       | 250 ms                                                     | 4 frames                                 |
| Large explosion sprite (destroyed) | 500 ms                                                     | 8 frames + fade                          |
| Robot return-to-dock fade          | 400 ms                                                     |                                          |

### SVG conventions

- All robot SVGs drawn pointing **East** (rotation = 0°). Pixi rotates at runtime per `scanHeading`.
- All robot SVGs use neutral grey for body; team color applied via Pixi `tint`.
- 24×24 viewport per tile sprite (matches default Pixi tile size).
- No drop shadows in source SVG; Pixi handles drop shadow via filter if desired.

---

## 17. Phase summary table

| Phase   | Status                             | Effort | Goal                                                                                                          |
| ------- | ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| 1       | ✅ DRAFT COMPLETE / OBSOLETE MODEL | M      | Engine skeleton and old-model primitives/tests                                                                |
| **1R**  | ✅ DRAFT COMPLETE                  | M      | Realign timing, geometry, posture, cover, fire, and blast to audited binary truth                             |
| **1.5** | ✅ COMPLETE                        | S      | ESLint nondeterminism bans, Prettier, GitHub Actions workflow; local and remote gates pass                    |
| 2       | ✅ DRAFT COMPLETE                  | L      | Turn resolver core — per-tick orchestration, immediate Aim & Fire, command interpretation                     |
| 3       | ✅ DRAFT COMPLETE                  | M      | Locked projectile/blast outcomes + deterministic presentation events                                          |
| 4       | ✅ DRAFT COMPLETE                  | L      | Scan & Fire mode + ordinary visibility resolver (no Stealth)                                                  |
| 5       | ✅ DRAFT COMPLETE                  | S      | Replay format (serialize/deserialize/verify)                                                                  |
| 6       | ✅ DRAFT COMPLETE                  | M      | Next.js + PixiJS scaffold; static renderer; verified row-major Rubble import                                  |
| 7       | ✅ DRAFT COMPLETE                  | L      | Movie playback — deterministic snapshots, Pixi/GSAP effects, transport controls                               |
| 8       | 🟨 LOCALLY COMPLETE / HOSTING OPEN | L      | Online room foundation and 2-4 player setup; deployed WSS/two-network gate remains                            |
| 9       | ✅ DRAFT COMPLETE                  | L      | Planner UI: movement / posture / scan, exact timeline, local draft recovery                                   |
| 10      | ✅ DRAFT COMPLETE                  | M      | Planner UI: firing dialogs (Aim & Fire, Scan & Fire), authorized score estimates, inclusive scan gate         |
| 11      | ✅ DRAFT COMPLETE                  | XL     | Authoritative online turn loop, private projections, reconnect/playback resume, results, canonical replay     |
| 11.5    | ✅ DRAFT COMPLETE                  | XL     | v1 Field Guide, contextual help, iPad touch input, onboarding, explanations, and replay inspection (§10, §12) |
| 11.6    | ⬜ FUNCTIONAL GATE                 | L      | Three-/four-player online free-for-all hardening                                                              |
| 12      | ⬜ V1 SHIP GATE                    | L      | Production hosting, resilience, real-network validation, and physical-iPad acceptance                         |
| 13      | ⏸ POST-v1                          | L      | Nonblocking presentation polish, art refinement, and expanded performance work                                |
| 14      | ⏸ POST-MAIN-GAME                   | L      | Stealth class gameplay, visibility, Scan & Fire interactions, setup, and tests                                |
| 15      | ⏸ POST-MAIN-GAME                   | XL     | Treasure Hunt, Capture the Flag, Hostage, Baseball and sport commands/scoring                                 |
| 16      | ⏸ POST-v1                          | L      | Hot-seat/local adapter and allied/multi-Team Side modes                                                       |

**Critical path to v1 online FFA**: RE mapping pass → 1R → 1.5 → 2 → 3 → 4 →
5 → 6 → 7 → 8 → 9 → 10 → 11 → 11.5 → 11.6 → 12. The concise gate-by-gate
sequence is in `tasks/core-build-plan.md`. Phase 13 presentation polish and
Phase 16 hot-seat/alliance work are post-v1 and are not on this path. Phases 14
and 15 are hard-gated on the shipped online Survival v1: neither Stealth nor any
non-Survival sport may enter the main-game critical path first.
