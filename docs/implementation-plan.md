# RoboArena Implementation Plan

This is the action-focused execution roadmap from "engine primitives exist" to "v1 ships". It complements but does not replace `docs/spec.md` (the canonical current spec / constants) or `docs/priority-tests.md` (empirical research log). `docs/initial-plan.md` is historical planning context only.

**Audience**: any agent (human or AI) picking up a phase cold. Each phase is self-contained enough to execute independently once dependencies land.

**v1 scope reminder**: human-vs-human hot-seat only, no AI. Survival sport mode only. 2 postures (Standing, Crouching). Stealth rules land with visibility; Quick Start does not need to expose every class until a preset requires it. Online lobby, other sport modes, Ducking, AI, audio, production persistence, and full help/tutorial systems are deferred.

**MVP trim decisions**:
- Hot-seat Survival is the v1 finish line. Online lobby is v1.1/post-MVP after resolver, replay, planner, and movie playback are stable.
- Rubble Two and Rubble Three should be hand-transcribed from DOS coordinate probes before renderer/planner work depends on arena data. Automated extraction is optional later tooling, not an MVP blocker.
- Projectile timing and moving-target behavior must be clarified before gameplay is called faithful. Phase 3 owns this gate.
- Scan & Fire trigger/tracking, scan length, and target-speed effects must stay PROPOSED/TBD until the focused DOS tests are run.
- Full contextual help, first-time hints, Postgres/Supabase, deployment automation, reconnection UX, and observability are post-MVP.

---

## 1. Architecture overview

```
                    ┌──────────────────────────────────────────────┐
                    │  src/app/  (Next.js 16 routes)               │
                    │  src/components/  (React UI)                 │
                    └─────────────────┬────────────────────────────┘
                                      │ uses
                ┌─────────────────────┼──────────────────────┐
                ▼                     ▼                      ▼
  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │  src/planner/    │  │  src/renderer/   │  │  src/lib/net/    │
  │  TurnOrders      │  │  PixiJS event    │  │  WebSocket lobby │
  │  builder + UI    │  │  timeline player │  │  (post-MVP)     │
  │  state           │  │                  │  │                  │
  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
           │ produces            │ consumes            │
           │ TurnOrders          │ ResolutionEvent[]   │ MatchState
           │                     │                     │ + TurnOrders
           ▼                     │                     │
  ┌────────────────────────────────────────────────────────────────┐
  │  src/engine/  (pure TypeScript, deterministic, no I/O)         │
  │                                                                │
  │  resolveTurn(MatchState, TurnOrders, seed)                     │
  │    → { nextState: MatchState, events: ResolutionEvent[] }      │
  │                                                                │
  │  Primitives: rng, geometry, movement, firing, blast,           │
  │  visibility, projectiles, command interpretation               │
  └────────────────────────────────────────────────────────────────┘
```

**Boundary rules** (enforced by directory layout, later by ESLint config):
- `src/engine/` imports nothing from any other `src/` directory. No React, no DOM, no `Math.random`, no `Date.now`, no `window`. Pure deterministic TS.
- `src/renderer/` imports `engine/` types and consumes `ResolutionEvent[]`. Doesn't run the engine itself.
- `src/planner/` imports `engine/` types and produces `TurnOrders`. May call lightweight engine helpers (path validity, scan-cone math) but does not run a full turn.
- `src/app/`, `src/components/` are React UI. They orchestrate planner/renderer.
- `src/lib/net/` is the post-MVP multiplayer transport layer (Phase 12).

**Determinism contract**: every probabilistic decision in the engine goes through a seedable RNG (`createRng(seed)`). Replay = `{ initialMatchState, seed, turnOrders[] }` → identical event stream on any machine.

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
│   │   ├── projectiles.ts          (Phase 3)
│   │   ├── visibility.ts           (Phase 4)
│   │   ├── resolver.ts             (Phase 2 core)
│   │   ├── replay.ts               (Phase 5)
│   │   ├── index.ts
│   │   └── *.test.ts
│   ├── renderer/           PixiJS arena & movie player (Phase 6-7)
│   ├── planner/            turn-programming logic (Phase 8-10)
│   ├── ai/                 (deferred — AI = post-v1)
│   ├── lib/
│   │   ├── arenas/         arena .json files (Rubble Two/Three transcribed)
│   │   ├── net/            WebSocket lobby client + protocol (post-MVP)
│   │   └── replay/         save/load helpers for browser
│   ├── app/                Next.js 16 routes
│   │   ├── setup/
│   │   ├── match/[id]/
│   │   ├── replay/[id]/
│   │   └── layout.tsx
│   └── components/         React UI components
├── server/                 (post-MVP Phase 12) tiny Node WebSocket relay
├── docs/                   specs and plans
├── screenshots/            DOS reference captures
├── references/             source matrix
├── tests/                  empirical-test plan
└── public/                 static assets
```

Some directories don't exist yet — they appear in their phase. The plan says where things go before they're built.

---

## 3. Tooling & CI

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.6 strict | Already configured. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`, ESM throughout. |
| Test runner | Vitest 2.1 | Already configured. Fast, ESM-native, plays well with pure-TS engine. |
| Linter | ESLint (flat config) | Standard for Next.js; large plugin ecosystem; widely understood by AI coding agents. |
| Formatter | Prettier | Standard. `format:check` in CI is enough for v1; pre-commit hooks are optional later. |
| E2E test | Playwright | Deferred to Phase 11 (after planner UI is partly working). |
| CI | GitHub Actions | Repo will eventually live on GitHub. Workflow: typecheck + lint + test on push to main; build joins once Next.js lands. |
| Deploy | Vercel | Default for Next.js 16. Preview deploys per branch. Post-MVP WebSocket server deploys separately (Vercel doesn't support persistent WS — see Phase 12 §"Hosting"). |
| Branching | **Trunk with frequent commits** (current). PR-based later when multi-agent review is needed. |
| Commit style | Conventional-ish; first line ≤ 72 chars; bodies describe *why* + tests. Co-authored where AI-paired. |

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

### Phase 1 — Engine primitives [✅ DRAFT COMPLETE]

**Goal**: pure-TS deterministic simulation primitives — RNG, geometry, movement costs, single-shot firing resolution, blast resolution, weapon/robot catalogs.

**Status**: shipped in commit `8fb5028`. 75 unit tests passing. `npm test` and `npm run typecheck` green.

**Files** (all under `src/engine/`):
- `constants.ts` — every locked numerical value
- `types.ts` — `TileCoord`, `Posture`, `Robot*`, `Weapon*`, `RobotCommandSegment` (discriminated union), `Projectile`, `ResolutionEvent`, `MatchState`, `Arena`, `ReplayLog`
- `rng.ts` — mulberry32 seedable RNG
- `geometry.ts` — `chebyshevDistance`, `bearingDegrees`, `classifyScanZone`, `tilesAlongLineExclusive`
- `movement.ts` — `moveStepCostTicks`, `flipParity`, `canTraverse`
- `firing.ts` — `resolveFire`: pure function from `(shooter, target, weapon, terrain, rng)` → discriminated outcome
- `blast.ts` — `resolveBlast`: per-target damage rolls in radius
- `catalog.ts` — `WEAPONS`, `ROBOT_DEFINITIONS`, `DEFAULT_ROSTER_BY_LENGTH`
- `index.ts` — public exports

**Public API contract**:
```ts
export const resolveFire: (ctx: FireContext) => FireResolution;
export const resolveBlast: (ctx: BlastContext) => BlastDamageRoll[];
export const moveStepCostTicks: (size: 1 | 2, parity: 0 | 1) => number;
export const canTraverse: (posture: Posture, terrain: Terrain) => boolean;
export const classifyScanZone: (from, heading, to) => 'black' | 'grey' | 'blocked';
export const createRng: (seed: string) => Rng;
```

**Acceptance criteria** (all met):
- [x] BLACK 100% / GREY ≈ 20% hit rate verified by ≥5000-trial Monte Carlo tests
- [x] Cover crouch+bush ≈ 30%, low-wall-in-path ≈ 90%, no-stack max-rule
- [x] Damage brackets at d=1 (mostly full), d=17 (always partial)
- [x] Crouching damage < standing damage on open ground
- [x] Rough-ground 1.2× multiplier
- [x] Missile blast curve 67.5/50/15 at radii 0/1/2; r≥3 excluded
- [x] Same-seed replay determinism verified for both `resolveFire` and `resolveBlast`
- [x] Bresenham line tracing exact for cardinal, diagonal, and reverse cases
- [x] All public exports `readonly` where appropriate; no mutation surfaces

**Effort**: M (delivered).

---

### Phase 1.5 — Toolchain & determinism enforcement [⬜ NEXT]

**Goal**: lock in the dev toolchain so every Phase 2+ commit lands against a polished pipeline.

**Dependencies**: Phase 1.

**Files**:
- `eslint.config.mjs` — flat config; recommended TS + import-order; **custom rule** banning `Math.random` / `Date.now` / `setTimeout` / `setInterval` inside `src/engine/`
- `.prettierrc.json` — defaults
- `.nvmrc` — `22`
- `package.json` — add `"engines": { "node": ">=22" }`; new scripts: `lint`, `lint:fix`, `format`, `format:check`, `dev`, `build`, `start`
- `.github/workflows/ci.yml` — typecheck + lint + test on push (Next.js build joins when UI lands)
- `.husky/pre-commit` + `lint-staged` config — optional post-MVP convenience; do not block Phase 1.5 on hooks

**Acceptance criteria**:
- [ ] `npm run lint` green on existing engine code
- [ ] `npm run format:check` green
- [ ] CI workflow runs and passes on push
- [ ] Adding `Math.random()` to any `src/engine/*.ts` fails lint
- [ ] Pre-commit hook formats and lints staged files (optional; defer if it slows the MVP)

**Effort**: S (~30-60 min).

---

### Phase 2 — Turn resolver core [⬜]

**Goal**: orchestrate per-tick simulation. Consume `MatchState + TurnOrders + seed`, emit `ResolutionEvent[]` and a new `MatchState`. Implements movement, posture, scan rotation, command timing, simultaneous damage, and death cleanup. Aim & Fire may be immediate only as a temporary internal scaffold; no playable milestone can depend on that behavior. Phase 3 must follow before UI gameplay is considered faithful.

**Dependencies**: Phase 1.

**Files**:
- `src/engine/commandInterpreter.ts` — `getActiveSegmentAt(timeline, tick) → segment | null` (with stride-parity tracking and command-time-cost arithmetic)
- `src/engine/resolver.ts` — `resolveTurn({ state, orders, seed }) → { state, events }`
- `src/engine/__fixtures__/` — small canned `MatchState` builders for tests
- `src/engine/resolver.test.ts`
- `src/engine/commandInterpreter.test.ts`

**Per-tick phase order** (implemented in `resolver.ts`):
```
for tick in 0..(turn ticks):
  1. read each robot's active command at this tick
  2. apply movement intents (no collision; each robot independent)
  3. apply posture / scan-direction changes
  4. apply Aim & Fire commands (temporary immediate scaffold only; Phase 3 replaces with projectile timing)
  5. apply damage simultaneously (sum hits per target before death check)
  6. cleanup deaths (move dead robots to dock, emit event)
  7. emit per-tick events
```

**Public API contract**:
```ts
export interface TurnResult {
  readonly nextState: MatchState;
  readonly events: ResolutionEvent[];
}

export function resolveTurn(input: {
  state: MatchState;
  orders: TurnOrders;
  seed: string;
}): TurnResult;
```

**Tests required**:
- single-robot move along open path → emits `move-step` events at correct ticks with alternating step costs
- posture change → `posture-changed` event at correct tick; cost 0.1 s/step
- scan rotation by 5 directional units → 5 `scan-rotated` events at 0.05s intervals
- 2 robots stack on same tile (no collision) — both end positions correct
- crouching robot tries to walk onto bush → command rejected at planner; resolver receives only legal moves (negative test: malformed orders trigger `MalformedOrders` error, not silent corruption)
- Aim & Fire on stationary target → emits `hit` or `miss` correctly under the temporary scaffold, with tests named so Phase 3 can replace them
- two robots fire at each other on the same tick, both die from the exchange → both `destroyed` events emitted (simultaneous-damage rule)
- 30-shot full turn with same seed → exact same `events` array twice
- `nextState.lastKnownMarkers` updated correctly for losing-sight cases (note: visibility happens in Phase 4; for Phase 2, leave markers identical)

**Acceptance criteria**:
- [ ] `resolveTurn` is a pure function (no side effects, no mutation of inputs)
- [ ] Determinism: same `(state, orders, seed)` → byte-equal `events` and `nextState` across runs
- [ ] All commands in `RobotCommandSegment` union are handled or explicitly stubbed with clear errors
- [ ] Robot HP can never go negative or above `armor`
- [ ] At least 15 unit tests covering single-robot, multi-robot, edge cases (mutual kill, missed shots, posture changes mid-walk)
- [ ] `npm test` green; `npm run typecheck` green

**Risks**:
- Stride parity edge cases (when does it reset? user observed quirks). Plan: ship strict alternation, document deviations as known.
- Multi-step move chunking: planner submits a `move` segment with a path; resolver must charge alternating costs across the path. Risk: off-by-one on parity at segment boundaries.
- Tick assignment: if a command segment spans multiple ticks, where exactly do its events emit? Convention: events emit at tick the action *completes* (e.g. arrival tile), with `tick: number` the integer index.

**Effort**: L. This is the keystone phase.

**Tooling deliverables this phase also adds**:
- `.eslintrc` + `eslint.config.mjs` (flat config) — minimal, mostly TS-recommended + no-unused-vars
- `.prettierrc.json` — single-quotes, no semis? trailing commas? (use boring defaults: prettier defaults are fine)
- `package.json` `lint` script
- `.github/workflows/ci.yml` — typecheck + lint + test on push

---

### Phase 3 — Projectiles in flight [⬜ MVP GATE]

**Goal**: model multi-tick projectile travel. Aim & Fire creates a `TileProjectile` that travels along its path and resolves at the impact tick (calculated from distance and weapon-specific projectile speed). This phase locks the moving-target "shot went past" behavior and replaces any Phase 2 immediate-fire scaffold.

**Dependencies**: Phase 2.

**Files**:
- `src/engine/projectiles.ts` — `advanceProjectiles(state, tick) → { hits, blastImpacts, stillInFlight }`
- `src/engine/types.ts` — extend `MatchState` with `projectilesInFlight: Projectile[]` and `Projectile` with `launchTick: number`
- `src/engine/resolver.ts` — call `advanceProjectiles` per tick
- `src/engine/projectiles.test.ts`

**Empirical gate before locking values**: run the priority projectile timing test. If the DOS test is skipped, mark projectile speed PROPOSED and keep the implementation table easy to tune.

**Per-weapon projectile speeds** (PROPOSED, tunable):
- Bullet: use a tile-by-tile schedule; exact ticks-per-tile TBD by DOS test
- Missile / Grenade: slower visible schedule; exact ticks-per-tile TBD by DOS test

These belong in `WEAPON_DEFINITIONS` as `projectileTilesPerTick: number` (add to Phase 1 catalog as part of this phase's setup).

**Public API contract**:
```ts
export function advanceProjectiles(input: {
  projectiles: readonly Projectile[];
  state: MatchState;
  tick: number;
  rng: Rng;
}): {
  remaining: Projectile[];
  events: ResolutionEvent[];
};
```

**Tests required**:
- bullet at d=4 launched at tick 50 impacts at tick 54 (1 tile/tick)
- missile at d=8 launched at tick 50 impacts at tick 66 (0.5 tile/tick)
- target moves out of impact tile before bullet arrives → bullet hits empty tile, emits `miss { reason: 'target-moved' }`
- target stacks on impact tile mid-flight → all robots there take damage (validates "tile-targeted" rule)
- missile blast triggers `resolveBlast` at impact tick
- two missiles collide at the same impact tile → both blast effects apply (simultaneous resolution)

**Risks**:
- Floating-point creep: projectile position must be tracked in *integer fractional ticks* (e.g., `tilesPerTick * 2 = whole number`) or via a tile-by-tile schedule, never as floats. Use `path: TileCoord[]` + `impactTick: number` to keep replay deterministic.

**Effort**: M.

---

### Phase 4 — Scan & Fire mode + visibility & stealth [⬜ MVP GATE]

**Goal**: implement the "wait-and-shoot" Scan & Fire firing mode and per-team visibility resolution including the Stealth class rule.

Before locking behavior, run the focused Scan & Fire DOS tests. Keep these as explicit TBDs until then: trigger tick, target selection when multiple enemies enter the cone, whether Scan & Fire tracks target tile through impact, ammo consumption timing, and whether scan length or target speed changes hit probability.

These are bundled because both need scan-cone calculations against moving targets per tick. Splitting into two phases would duplicate the per-tick visibility-against-cone logic.

**Dependencies**: Phase 3.

**Files**:
- `src/engine/visibility.ts` — `computeVisibility(state, observingTeamId): VisibilityState` — set of tiles + visible-enemy-robot-ids, plus last-known markers
- `src/engine/scanAndFire.ts` — per-tick check: does any enemy enter scan range × cone of a robot in S&F mode? if yes, emit `TrackingProjectile`
- `src/engine/stealth.ts` — `isStealthVisibleTo(stealthRobot, observerRobot, didMoveThisTick): boolean` — Compute! review rule
- `src/engine/resolver.ts` — extend per-tick to call S&F watchdog and update visibility
- `src/engine/types.ts` — add `VisibilityState`, `RobotState.scanAndFireConfig?: { weapon, maxDistance, secondsRemaining }`
- tests

**Stealth visibility rule** (locked from Compute! review):
```ts
isVisible(stealth, observer, stealthMovedThisTick) =
  observer can see stealth's tile AND
  (stealthMovedThisTick OR chebyshevDistance(observer.tile, stealth.tile) ≤ 1)
```

Last-known X markers: at the *end of each turn*, for every team, record tiles where they last saw any enemy that's no longer visible to them. Engine emits `last-known-marker` events; renderer draws Xs in Edit mode of the next turn.

**Public API contract**:
```ts
export interface VisibilityState {
  readonly visibleTiles: ReadonlySet<string>; // "x,y" keys
  readonly visibleEnemies: ReadonlySet<string>; // robotIds
  readonly lastKnownMarkers: readonly TileCoord[];
}

export function computeVisibility(state: MatchState, teamId: string): VisibilityState;
export function isStealthVisibleTo(stealth, observer, movedThisTick): boolean;
```

**Tests required**:
- standing target at d=10 in BLACK zone with clear LoS → visible
- target behind a wall → NOT visible
- target behind a low wall → still visible (low walls don't block sight, only weapons)
- target behind a bush → NOT visible if observer's view passes through the bush AND target is on the bush (matches "blocks visibility when on tile")
- stealth stationary at d=5 → invisible
- stealth stationary, observer adjacent (d=1) → visible
- stealth moves on tick X → visible to anyone with LoS during tick X
- Scan & Fire watchdog: enemy enters scan cone at tick 80 → `TrackingProjectile` launched
- S&F runs out of `secondsRemaining` → mode terminates, no shot fired

**Risks**:
- Visibility is computed per-team-per-tick → potentially expensive. v1 ships the naive O(robots × tiles-in-cone) approach; optimization later if profiling shows hot spot.
- "Behind cover" semantics for visibility (vs. weapons): weapons don't cover behind, but bushes DO block visibility from behind. This asymmetry is the trickiest part of this phase.

**Effort**: L.

---

### Phase 5 — Replay format [⬜]

**Goal**: serialize a `ReplayLog` to JSON; deserialize and re-run; verify byte-equal event stream. Replays are the foundation for movie sharing, multiplayer sync verification, and debugging.

**Dependencies**: Phases 2, 3, 4.

**Files**:
- `src/engine/replay.ts` — `serializeReplay`, `deserializeReplay`, `verifyReplay` (re-runs and compares events)
- `src/engine/replay.test.ts`

**Public API contract**:
```ts
export function serializeReplay(log: ReplayLog): string;
export function deserializeReplay(json: string): ReplayLog;
export function verifyReplay(log: ReplayLog): { ok: true } | { ok: false; firstDivergenceTick: number };
```

**Tests required**:
- round-trip: serialize → deserialize → byte-equal
- re-run: take a `ReplayLog`, run `resolveTurn` for each turn with the recorded seed and orders, compare events to the recorded events → byte-equal
- intentional corruption: flip one byte in the seed → verify re-run diverges and `verifyReplay` returns the divergent tick
- schema versioning: replays carry a `formatVersion: 1` field; deserializer rejects unknown versions

**Risks**:
- Big arena tile data inflates replays. Mitigation: arena referenced by name (`"Rubble Three"`) and tile data loaded from the arena library, not embedded in the replay. Replay = config + seed + orders, not initial tiles.

**Effort**: S.

---

### Phase 6 — Next.js scaffold + arena renderer [⬜]

**Goal**: initialize Next.js 16 app, integrate PixiJS, render an arena (tiles, walls, bushes, etc.) statically. No robots, no animation yet. Just "I can load the page and see Rubble Three".

**Arena data policy**: v1 uses hand-transcribed Rubble Two and Rubble Three JSON from DOS coordinate probes. Automated screenshot extraction is deferred tooling; do not block the renderer on classifier work.

**Dependencies**: Phase 1 (types).

**Files**:
- `next.config.ts`, `app/layout.tsx`, `app/page.tsx` (landing)
- `tools/extract-arena.ts` — deferred optional tooling, not part of the MVP path
- `tools/review-arena/` — deferred optional tooling
- `screenshots/arena-extraction/` — optional reference captures if extraction tooling is revived later
- `src/lib/arenas/` — `rubble-two.json`, `rubble-three.json` — hand-transcribed from DOS coordinate probes
- `src/lib/arenas/index.ts` — `loadArena(name): Promise<Arena>` + JSON schema validator
- `src/renderer/PixiArena.tsx` — React component wrapping a Pixi `Application` that renders an `Arena`
- `src/renderer/assets.ts` — SVG asset registry (terrain × 7 + crate; see §5 Asset inventory)
- `src/renderer/sprites/` — terrain SVG sprites under `public/assets/terrain/`
- `src/components/ArenaPreview.tsx` — `<ArenaPreview arenaName="rubble-three" />`
- `src/app/preview/page.tsx` — temporary debug page that shows all extracted arenas side-by-side

**Arena transcription**: see `docs/priority-tests.md` for the manual coordinate-probe workflow. A simple CSV/grid transcription is sufficient for v1; extraction scripts and companion review tools are post-MVP.

**Art**: terrain SVGs are the first deliverable from §5 Asset inventory. 7 simple SVGs (open / rough / low-wall / wall / bush / crevice / outer-wall) plus the crate obstacle. Hand-author or AI-generate to a coherent palette.

**Public API contract**:
```tsx
export function PixiArena({ arena }: { arena: Arena }): JSX.Element;
export function loadArena(name: ArenaName): Promise<Arena>;
```

**Tests required**:
- arena JSON files validate against `Arena` type (write a `validateArena(arena): void` helper + tests)
- `loadArena('rubble-two').width === 25` and `.height === 25`
- Playwright smoke test: load `/preview`, confirm canvas mounted (Phase 11)

**Acceptance criteria**:
- [ ] Visiting `/preview` shows Rubble Two and Rubble Three rendered as Pixi canvases
- [ ] Tiles render with correct visual styles per terrain type
- [ ] No console errors / type errors

**Sub-deliverables added in this phase**:
- **Loading splash + asset preload progress bar**. PixiJS `Assets.load` for all SVGs in the Asset inventory (§5); show a branded splash with a progress bar while loading. Once cached by the browser, subsequent loads are instant.
- **Skeleton states** for routes that load match/replay data from server.
- **Visual regression test scaffolding** — Playwright config with screenshot snapshot helper. Ship one test (the `/preview` page screenshot) so the harness is in place; expand coverage in Phase 13.

**Risks**:
- PixiJS + React + Next.js SSR plays poorly out of the box (Pixi requires window/canvas). Mitigation: dynamic import with `ssr: false` for the Pixi component.
- Tile sprites: ship the SVG terrain set from §5; if AI-generation produces inconsistent style, hand-author 7 simple tiles in Inkscape.

**Effort**: M.

---

### Phase 7 — Movie playback [⬜]

**Goal**: render robots and animate `ResolutionEvent[]` as a movie — play, pause, step forward/backward, change speed. Match the original's transport controls.

**Dependencies**: Phases 1, 2 (so we have `MatchState` + events to render).

**Files**:
- `src/renderer/MoviePlayer.tsx` — React component that owns the playback state machine (playing / paused / current tick)
- `src/renderer/animations.ts` — per-event animation handlers (full handler-per-event matrix in §5 Animation handlers)
- `src/renderer/RobotSprite.tsx` — Pixi container per robot with posture-aware sprite swap + `tint` for team color
- `src/renderer/effects/` — sprite-life-cycle helpers for explosions, smoke trails, blast waves
- `src/components/MovieControls.tsx` — play / pause / step / speed controls (mirrors original DOS transport bar)
- `src/app/movie/[id]/page.tsx` — debug route that runs a canned `ReplayLog` from disk
- `public/assets/robots/` — 10 robot SVGs (5 classes × 2 postures) + projectile/effect sprites per §5

**Animation pipeline**: GSAP for tweens, Pixi for sprite + container management. One handler per `ResolutionEvent.kind` per the matrix in §5. Each handler returns a `Promise<void>` so the player can await visual completion if needed, but the playback clock advances on engine ticks (determinism) — animations are decorative.

**Public API contract**:
```tsx
export function MoviePlayer({
  initialState,
  events,
  fps?: number; // default 12 to match original
}): JSX.Element;
```

**Tests required**:
- step forward through a 10-tick movie → final robot positions match `nextState.teams[*].robots[*].position`
- step backward returns the player to the previous state correctly (idempotency)
- speed multiplier doesn't change which events fire, only their wall-clock pacing

**Acceptance criteria**:
- [ ] Hand-crafted `ResolutionEvent[]` sequence (e.g., a robot walks 5 tiles east) renders correctly
- [ ] Speech-bubble replacement (small explosion sprite on hit, larger on destroyed) visible
- [ ] Play / pause / step / speed all work; no off-by-one on step direction

**Risks**:
- React state for "current tick" + Pixi's animation loop → easy to desync. Use a single source of truth (React state for tick; Pixi just reads).
- Backward step requires re-running `resolveTurn` from initial state up to (tick - 1). Cache snapshots every N ticks if perf bites.

**Effort**: L.

---

### Phase 8 — Match setup UI [⬜]

**Goal**: implement the Quick Start screen needed to launch a two-team hot-seat Survival match. v1 needs team names/colors, home corners, Beginner formation, game length, and Rubble arena selection. Custom Game, 2-4 team setup, AI brain selection, point-buy roster editing, and Team Rating budgets are post-MVP.

**Dependencies**: Phases 1, 6.

**Files**:
- `src/app/page.tsx` — main menu (Quick Start / Replay)
- `src/app/setup/quickstart/page.tsx`
- `src/app/setup/custom/page.tsx` — post-MVP
- `src/components/setup/TeamRow.tsx` — team name / color / side / home area
- `src/components/setup/RobotPicker.tsx` — post-MVP class picker with point-buy budget bar
- `src/lib/setup/validate.ts` — `validateMatchConfig(cfg): { ok, errors }`

**UX cues from screenshots** (preserve the layout but modernize):
- Quick Start: 2 columns, sport / formation / length / arena dropdowns on left; Team Roster on right
- Custom Game: post-MVP; team list at top with Rating column, robot list below with class+name editable
- Use modern Tailwind v4 styling, large touch targets, keyboard navigation

**Tests required**:
- form validation: empty team name rejected with helpful message
- Melee selects Rubble Two and the 4-robot Beginner roster
- Battle selects Rubble Three and the 6-robot Beginner roster
- unsupported options are hidden or disabled with a clear post-MVP label

**Acceptance criteria**:
- [ ] User can configure a 2-team Survival Beginner Rubble match and click Start Game
- [ ] State saved to URL or localStorage so refresh doesn't lose progress
- [ ] All clickable elements have `cursor-pointer` (per CLAUDE.md project rule)

**Effort**: M.

---

### Phase 9 — Planner UI: movement + posture + scan [⬜]

**Goal**: turn programming for the simplest commands. Player drags / clicks to plan a movement path; toggles posture; sets scan direction. The planner shows the timeline at the top and validates each command (path validity, scan-cone bounds) live.

**Dependencies**: Phases 1, 6, 7, 8.

**Files**:
- `src/app/match/[id]/edit/page.tsx` — Edit Mode (planning)
- `src/components/planner/Timeline.tsx` — top bar with cumulative time
- `src/components/planner/CommandPanel.tsx` — Tools panel: Posture, Scan, Weapon, Fire buttons
- `src/components/planner/ArenaCanvas.tsx` — interactive Pixi arena that handles clicks
- `src/planner/state.ts` — Zustand store (or Context) for current `TurnOrders` being built
- `src/planner/pathfind.ts` — A* on the arena tile grid for movement paths
- `src/planner/segments.ts` — helpers to append/edit/delete `RobotCommandSegment`s

**Tests required**:
- A* pathfinding: valid path between two open tiles, around a wall, respecting posture restrictions
- click a wall tile → cursor shows "blocked" state (mirrors DOS UX)
- click outside Home Area on first move → "out of home" error
- timeline updates correctly when adding / deleting commands; stride-parity computed live

**Acceptance criteria**:
- [ ] Player can deploy a robot, walk it across the arena, change posture, set scan direction, all visible on the timeline
- [ ] Multi-robot timeline preview works: planning robot B at tick X shows robot A's projected position at tick X (DOS-confirmed UX)
- [ ] "Out of home", "blocked", "out of bounds" cursor states all surface

**Risks**:
- Pixi click handling vs. React state — same risk as Phase 7
- A* with stride-parity-aware costs: if user wants to chunk into doubles, planner needs to find the cheapest stride pattern. v1 can use single-tile A* and skip optimization.

**Effort**: L.

---

### Phase 10 — Planner UI: firing dialogs [⬜]

**Goal**: Aim & Fire (with repeat-fire variant via Ctrl+Shift) and Scan & Fire (with Maximum Distance + Seconds dialog).

**Dependencies**: Phase 9.

**Files**:
- `src/components/planner/AimAndFireDialog.tsx`
- `src/components/planner/ScanAndFireDialog.tsx`
- `src/components/planner/FireBox.tsx` — buttons that open dialogs
- `src/planner/firingHelpers.ts` — scan-cone visualization (black/grey/blocked overlays on Pixi)

**Tests required**:
- Aim & Fire dialog: target outside cone shows "angle blocked"; target out of weapon range shows "out of range"
- Scan & Fire dialog: Max Distance defaults to weapon's `scanFireMaxDistance`; Seconds defaults to remaining-budget
- Ctrl+Shift+click on target tile creates a `repeat: true` Aim & Fire segment

**Acceptance criteria**:
- [ ] Both fire modes can be programmed; commands appear on timeline with correct durations
- [ ] Visual scan-cone overlay (black/grey/blocked zones) renders during targeting

**Effort**: M.

---

### Phase 11 — End-turn flow + Team Data + persistent panels [⬜]

**Goal**: glue the match loop together. Each player edits their team → end turn → resolve → movie → next turn. Persistent Team Data panel (per the user direction: replace modal with side panel since we have screen real estate). Final Ceremony at end of match.

**Dependencies**: Phases 7, 9, 10.

**Files**:
- `src/app/match/[id]/movie/page.tsx`
- `src/app/match/[id]/results/page.tsx` — Final Ceremony screen
- `src/components/match/TeamDataPanel.tsx` — sidebar: per-team HP + Score, per-robot Type/HP/Position
- `src/components/match/EndTurnDialog.tsx` — "Are you sure you want to generate the turn?"
- `src/match/loop.ts` — orchestrator: edit phase → resolve → movie → loop

**Acceptance criteria**:
- [ ] Full hot-seat match playable end-to-end
- [ ] Final Ceremony shows points, can return to main menu
- [ ] Persistent Team Data panel updates live
- [ ] Movie save/load works (via Phase 5 replay format)

**Effort**: M.

**Note**: this phase + Phase 9 + Phase 10 + Phase 6 + Phase 7 = a playable hot-seat MVP. Consider a soft-launch internal alpha at this point.

---

### Phase 11.5 — Onboarding, contextual help, tooltips [⏸ POST-MVP]

**Goal**: post-MVP help system. For v1, ship only minimal labels/tooltips needed to complete a hot-seat match.

**Dependencies**: Phases 8, 9, 10, 11 (so the things being explained exist).

**Files** (full list in §10):
- `src/components/help/Tooltip.tsx`, `HelpDialog.tsx`, `HelpCursorToggle.tsx`, `FirstTimeHint.tsx`, `HelpProvider.tsx`
- `src/state/useHelpStore.ts` (with localStorage persistence)
- `src/lib/help/topics/*.md` — markdown content per topic
- `src/app/help/[topic]/page.tsx` — static help routes
- `public/assets/help/` — sprites + screenshots embedded in dialogs

**Acceptance criteria**:
- [ ] `?` key toggles help cursor mode; click any tile → help dialog with content (post-MVP)
- [ ] Every clickable control in the planner / setup has a tooltip
- [ ] First-time entry to Edit Mode shows the "Click to plan a move; Shift+click for scan direction" hint, dismissible, never shown again
- [ ] `/help/bushes` (and ~20 other topics) renders correctly with sprite + description

**Effort**: M.

---

### Phase 12 — Online lobby (WebSocket relay) [⏸ POST-MVP / v1.1]

**Goal**: post-MVP remote play. One player creates a lobby with a 6-character code; the other joins by code. Server is a tiny Node WebSocket relay that holds match state and pumps `TurnOrders` between clients. Server runs the engine to prevent cheating (server-authoritative resolution).

**Dependencies**: Phases 1-11 and a stable replay format from real hot-seat play.

**Files**:
- `server/index.ts` — Node WebSocket server (using `ws` package). Routes: `/lobby/create`, `/lobby/join/:code`, `/match/:id` (WS).
- `src/lib/net/client.ts` — typed WebSocket client
- `src/lib/net/protocol.ts` — message schemas (host / join / submit-orders / turn-resolved / disconnect)
- `src/app/(lobby)/host/page.tsx` — create lobby, share code
- `src/app/(lobby)/join/page.tsx` — enter code, join

**Hosting**: Vercel doesn't support persistent WebSockets. Options:
- **Railway** or **Fly.io** for the WebSocket server (simple Node deploy)
- Or **Vercel Edge Functions** + Durable Objects (Cloudflare alternative) for serverless WS — more complex
- Default: Railway. Single small server handles many lobbies (each lobby ≪ 1 KB state).

**Protocol sketch**:
```
client → server: HostLobby { config: GameConfig }
server → client: LobbyCreated { code: 'ABC123' }
client → server: JoinLobby { code }
server → both:   LobbyReady { hostTeam, joinerTeam, matchId }
client → server: SubmitTurnOrders { matchId, orders }
server (when both submitted): runs resolveTurn, sends TurnResolved { events, nextState } to both
client → server: Disconnect
```

**Tests required**:
- unit-test `protocol.ts` schemas (zod or similar)
- integration: spin up server in test, two clients connect, run a 1-turn match, verify both received identical `events`
- player disconnect mid-match: server holds state for 5 minutes; reconnect with same code resumes

**Acceptance criteria**:
- [ ] User shares a lobby URL/code; second user joins; both can play a full match
- [ ] No client can cheat by lying about turn outcomes (server resolves)
- [ ] Reconnect works within a grace period

**Sub-deliverables added in this phase**:
- **Reconnection UX** (per §11): exponential-backoff retry; "Reconnecting…" overlay; resume from server state on success; abort with friendly explanation on permanent failure.
- **Schema validation** at server boundary using zod for all WebSocket messages and HTTP API requests (per §11).
- **Server deployment** to Railway or Fly.io. Dockerfile + GitHub Actions deploy pipeline triggered on `main` push for the `server/` directory. Vercel deploys the Next.js app separately on the same push.
- **Server monitoring**: structured logs to stdout (Pino); platform's log aggregation handles search. Sentry for error reporting (privacy-scrubbed — no IPs, no PII).
- **API persistence layer**: SQLite (`better-sqlite3` Node binding) for replays + teams; in-memory map for active matches and lobbies. Schema in §9.
- **Browser-token middleware**: read `X-Browser-Token` header; reject mutations if absent; pass through on read endpoints.

**Risks**:
- NAT / firewall / corporate proxies blocking WebSockets. Mitigation: server runs over HTTPS WSS on a standard port (443).
- State management in server: keep simple in-memory map; if server restarts, active matches are lost. Acceptable for the first post-MVP online pass.
- Cheating: server-authoritative resolution prevents most. The one residual concern: a malicious client could submit invalid `TurnOrders`. Server validates orders before resolving (path validity, scan-cone, etc.) and rejects malformed ones with `INVALID_ORDERS { reason }`.
- Server restart loses active matches. Mitigation for the first online pass: deploy strategy aims for low restart frequency; matches are short (~5 turns × 2 minutes each = 10 minutes typical). Promote to persistent state store later if needed.

**Effort**: XL.

---

### Phase 13 — Polish, accessibility, art, soundscape [⬜ ⏸ partly deferred]

**Goal**: ship-quality. Real art (replace vector placeholders), keyboard navigation, screen reader support for menus, mobile-friendly layouts (or graceful "desktop only" message), perf budget enforcement, optional audio.

**Dependencies**: all prior.

**Effort**: L.

**Note**: audio explicitly deferred per user direction. Real art likely deferred too — playtest with placeholders first.

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

**Robots** (5 classes × 2 postures = 10 SVGs; rotation done programmatically by Pixi):
- `rifle-standing.svg` · `rifle-crouching.svg`
- `burst-standing.svg` · `burst-crouching.svg`
- `auto-standing.svg` · `auto-crouching.svg`
- `missile-standing.svg` · `missile-crouching.svg`
- `stealth-standing.svg` · `stealth-crouching.svg`

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

For v1: AI-assisted authoring. Generate concept SVGs via Claude or Midjourney (or hand-draw in Figma / Inkscape), iterate to a coherent palette. Each asset is small and self-contained — total v1 inventory is ~25 SVGs.

Asset directory: `public/assets/`. Loaded via a single `assets.ts` registry that maps semantic names to URLs. Pixi's `Assets.load` handles the rest.

### Animation handlers (per-event)

Implementation: GSAP for tweens, Pixi sprite/container manipulation for state changes. One handler per `ResolutionEvent.kind` in `src/renderer/animations.ts`:

| Event kind | Animation | Tools |
|---|---|---|
| `move-step` | tile-to-tile lerp over the step's tick budget; sprite faces movement direction | GSAP tween on `sprite.position` |
| `posture-changed` | swap from `*-standing.svg` to `*-crouching.svg` (or reverse); brief scale tween for "feel" | sprite swap + GSAP scale tween |
| `scan-rotated` | smooth rotation tween (0.05 s per direction unit) | GSAP tween on `sprite.rotation` |
| `projectile-launched` (bullet/burst) | fast straight-line tween (1-2 ticks) | GSAP tween on a temporary sprite |
| `projectile-launched` (missile) | medium-speed tween + smoke-trail particle emitter along path | GSAP tween + Pixi `ParticleContainer` |
| `projectile-impact` (bullet) | small explosion sprite at impact tile, fades over ~3 ticks | sprite life cycle |
| `projectile-impact` (missile/grenade) | larger explosion + radial blast wave sprite | sprite life cycle |
| `hit` | red flash on target sprite (~3 ticks) | tween on `sprite.tint` |
| `miss` | optional small puff at impact tile | sprite life cycle |
| `destroyed` | rotating explosion + fade out + remove sprite | composed tween chain |
| `robot-returned-to-dock` | fade in at dock tile | tween on `sprite.alpha` |
| `last-known-marker` | static X glyph (drawn during planning, NOT during movie) | Pixi Graphics primitive |

**Determinism note**: animations are *visual representations of events*; they do not affect engine state or timing. Movie player advances ticks based on `events[i].tick`, not on animation completion. If an animation runs longer than its tick budget (e.g., explosion fade), the next tick can start before it finishes; sprites just keep rendering.

---

## 6. Arena transcription notes

### v1 approach (locked: manual coordinate probe)

Rubble Two and Rubble Three are small enough to hand-transcribe from the DOS game by clicking through x,y coordinates and recording terrain. This is lower risk than building a screenshot classifier before the renderer exists.

**Manual process**:

1. Open the target map in DOS RoboSport.
2. Probe coordinates in row-major order, y=0..height-1 and x=0..width-1.
3. Record compact rows with the terrain codes from `docs/priority-tests.md`.
4. Convert the row grid into `src/lib/arenas/<name>.json`.
5. Review only unknown or suspicious tiles. Do not require screenshots, classifiers, or a separate review app for v1.

### Post-MVP optional extraction script

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
  playingFieldOriginPx: { x: 4, y: 84 },  // pixel offset of playing-field top-left in screenshot
  tileSizePx: 24,                          // pixels per tile
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
  "homeAreas": [
    { "corner": "NW", "tiles": [{"x":1,"y":1}, ...] },
    ...
  ],
  "dock": [...],
  "metadata": {
    "source": "DOS coordinate probe",
    "unknownTiles": [],
    "reviewedAt": "2026-05-06T00:00:00Z"
  }
}
```

### Per-arena requirements

For each arena (Rubble Two/Three at minimum for v1; Suburbs/Computer Town deferred):
- Fill the row-grid template in `docs/priority-tests.md`.
- Convert the rows into `src/lib/arenas/<name>.json`.
- Mark unknown tiles explicitly with notes; do not silently guess.
- Commit the resulting arena JSON and the source transcription notes.

---

## 7. State management architecture

**Locked for v1: Zustand for client-side hot-seat state. Server-authoritative multiplayer state is post-MVP.**

### State boundaries

| State kind | Where it lives | Mutability | Notes |
|---|---|---|---|
| **Engine state** (`MatchState`, `TurnOrders`, `ReplayLog`) | Server (multiplayer) or client localStorage (hot-seat) | Immutable; engine returns new instances | Single source of truth for game progress |
| **Server-authoritative match state** | Server in-memory map keyed by matchId | Mutated only by `resolveTurn` on the server | Post-MVP multiplayer cheat-prevention |
| **Client UI state** (planner draft, selected robot, dialog open) | Zustand stores | Mutable; React subscribes via hooks | Per-tab, per-session |
| **Client persistent state** (settings, last config; browser-token post-MVP) | Zustand + localStorage (`zustand/middleware/persist`) | Mutable; auto-synced to localStorage | Survives tab close |
| **Renderer state** (Pixi sprite positions, tweens, current frame) | Pixi-internal | Mutable; React reads only via refs | Animation; not in Zustand |

### Stores

```ts
// src/state/

useMatchStore        // current MatchState + phase ('setup'|'edit'|'movie'|'results')
                     //   + history of completed turns; localStorage in hot-seat
usePlannerStore      // draft TurnOrders for current turn, selected robotId,
                     //   command-being-edited, scan-direction preview
useMoviePlayerStore  // currentTick, isPlaying, speed (1x|2x|4x), frame buffer
useSettingsStore     // user preferences (animation speed, hide/show paths, panel layout);
                     //   persisted via zustand/middleware/persist
useLobbyStore        // (post-MVP Phase 12) lobbyCode, players[], connectionStatus, hostFlag
useHelpStore         // (Phase 11.5) which first-time hints have been shown
```

### Sync patterns

- **Hot-seat**: state lives in stores; debounced auto-persist to localStorage on every change. Refresh recovers via store hydration.
- **Multiplayer** (post-MVP): server is authoritative. Client sends `TurnOrders` via WebSocket; server runs `resolveTurn`; broadcasts `{ events, nextState }` to both clients; both clients update `useMatchStore` from the broadcast. Client never trusts its own simulation result for shared state — only for optimistic UI hints during planning.
- **Optimistic UI during planning**: `usePlannerStore` holds the draft `TurnOrders`. Lightweight engine helpers (path validity, scan-cone classification) run on the client to give live feedback without round-trips.

### Time-travel / debugging

- Zustand has Redux DevTools middleware — straightforward integration in dev builds, stripped in prod.
- Replay format (Phase 5) is the production-quality time-travel mechanism — any past match can be re-run tick-by-tick.

### Files (introduced in Phase 8)

- `src/state/useMatchStore.ts`
- `src/state/usePlannerStore.ts`
- `src/state/useMoviePlayerStore.ts`
- `src/state/useSettingsStore.ts` (with `persist` middleware)
- `src/state/useLobbyStore.ts` (post-MVP Phase 12)
- `src/state/useHelpStore.ts` (post-MVP Phase 11.5)

---

## 8. Routing & URL design

### URL space

| Path | Purpose | Auth | Notes |
|---|---|---|---|
| `/` | Start game / browse local replays | none | v1 hot-seat entry |
| `/setup/quick` | Quick Start setup screen | none | Hot-seat or solo configuration |
| `/setup/custom` | Custom Game team builder | none | Post-MVP |
| `/lobby/host` | Create a multiplayer lobby | browser-token | Post-MVP |
| `/lobby/join/:code` | Join via code (deep-link friendly) | browser-token | Post-MVP |
| `/match/:matchId` | Active match (entry; redirects to current phase) | participant only | |
| `/match/:matchId/edit` | Edit phase (turn programming) | participant only | |
| `/match/:matchId/movie` | Movie playback for the just-resolved turn | participant only | `?t=N` deep-links to a tick |
| `/match/:matchId/results` | Final Ceremony / scoring screen | participant only | |
| `/replay/:replayId` | Replay viewer | none | v1 can load local replay data; public IDs are post-MVP |
| `/replay/:replayId/share` | Embeddable share card / OG metadata | none | Post-MVP |
| `/teams` | Saved team library | browser-token | Post-MVP unless local presets become needed |
| `/settings` | User preferences | none | Persisted to localStorage |
| `/help/:topic` | Static help articles (terrain, weapons, etc.) | none | Post-MVP full help |

### ID conventions

- **Match IDs**: 10-character `nanoid` slug (e.g., `ZbV2Ch9rQp`). Private — only participants get the URL.
- **Replay IDs**: 10-character `nanoid` slug. Public; URLs are shareable.
- **Lobby codes**: 6-character uppercase alphanumeric (e.g., `ABC123`). Memorable; verbal-shareable. Maps internally to the matchId once both players join.
- **Tick deep-links**: query string `?t=N` on movie or replay routes; player loads paused at that tick.

### Sharing patterns

- **Lobby invite**: full URL like `/lobby/join/ABC123` is shareable; alternatively the 6-char code is verbal.
- **Replay share**: full URL like `/replay/ZbV2Ch9rQp` with optional `?t=` for paused-at-tick.
- Active matches are URL-private (only participants get the link).

---

## 9. Persistence model (post-MVP shared persistence)

**v1 locked**: no database. Active hot-seat match state, settings, last-played config, and optional local replay/team data live in localStorage or exported JSON.

**Post-MVP proposal**: Postgres for shared/persistent data (eventual home: Supabase). Local dev can use local Postgres. Client localStorage holds settings and an anonymous browser-token.

### What lives where

| Kind | Where | Lifetime |
|---|---|---|
| Active match state (multiplayer) | Server in-memory | Post-MVP; match duration; lost on server restart |
| Active match state (hot-seat) | Client localStorage | Until user starts a new match |
| Replays | v1: exported JSON or localStorage; post-MVP: Postgres `replays` table | Local until shared persistence lands |
| Saved teams | v1: built-in presets or localStorage; post-MVP: Postgres `teams` table | Local until shared persistence lands |
| User settings | Client localStorage (`useSettingsStore` with `persist` middleware) | Until cleared |
| Browser-token (anonymous identity) | Client localStorage | Until cleared; generated on first visit |
| Last-played-config | Client localStorage | Until overwritten |

### Post-MVP schema (Postgres)

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

Active matches and lobbies live in server memory — no DB persistence. If the server restarts mid-match, the match is lost. Acceptable for post-MVP "fun game with friends" scope.

### Post-MVP local dev setup

Connection string from `.env.local`:
```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/roboarena
```

Schema migrations: simple `.sql` files in `db/migrations/` applied via `psql` or a tiny Node script. No migration framework needed for the first shared-persistence pass.

When shared persistence exists, local dev can use a local Postgres instance. Production hosting (Supabase) is a swap of `DATABASE_URL` once we get there.

### Post-MVP API endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/replays` | Save a finished match's replay → `{ replayId }` |
| `GET` | `/api/replays/:id` | Fetch replay JSON |
| `GET` | `/api/replays?owner=mine` | List replays I own |
| `POST` | `/api/teams` | Save a team |
| `GET` | `/api/teams` | List my teams |
| `DELETE` | `/api/teams/:id` | Delete a team (owner check) |
| `POST` | `/api/lobbies` | Create lobby → `{ code }` |
| `GET` | `/api/lobbies/:code` | Lobby info (for join UX) |

Server reads `X-Browser-Token` header; passes through on reads, requires on mutations. No real auth in the first shared-persistence pass — token is honor-system anonymous identity.

### Replay format versioning

Replays carry `format_version`. If/when the format changes, add a migration entry to a small table:
```ts
const replayMigrations: Record<number, (data: any) => ReplayLog> = {
  // 1: identity
};
```
CI gate: a few canned replays must still pass `verifyReplay` after migration. Don't build the full migration framework now; add it when needed.

### Post-MVP API endpoints (detailed auth)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/replays` | Save a finished match's replay → `{ replayId }` | browser-token |
| `GET` | `/api/replays/:id` | Fetch replay JSON | none (public) |
| `GET` | `/api/replays?owner=mine` | List my replays | browser-token |
| `POST` | `/api/teams` | Save a team | browser-token |
| `GET` | `/api/teams` | List my teams | browser-token |
| `DELETE` | `/api/teams/:id` | Delete a team | browser-token (owner check) |
| `POST` | `/api/lobbies` | Create lobby → `{ code }` | browser-token |
| `GET` | `/api/lobbies/:code` | Lobby info (for join UX) | none |

### Browser-token identity

- Generated on first visit (`crypto.randomUUID()`); stored in localStorage.
- Sent as `X-Browser-Token` header on all API calls.
- Server treats it as anonymous identity — not linked to email, no signup. Clearing localStorage = "forget me".
- This is good enough for friend-scale shared persistence (no accounts, no recovery); promotable to real accounts later.

### Replay format versioning

Replays carry `formatVersion: 1`. Engine ships with a migration table:
```ts
const migrations: Record<number, (replay: any) => ReplayLog> = {
  // 1: identity (current version)
};
```
When `formatVersion` advances:
- Add a `2:` entry that migrates from v1
- Old replays still play
- CI gates on a corpus of canned old replays passing `verifyReplay` after migration

---

## 10. Onboarding, contextual help, tooltips (post-MVP)

**v1 locked**: minimal labels and tooltips only where needed to complete a hot-seat match. Full contextual help, first-time hints, help cursor, and help articles are post-MVP.

### Post-MVP help system components

1. **Tooltips** — every non-obvious UI control has hover/focus tooltip. Build a `<Tooltip>` primitive that wraps content; positions via Floating UI.
2. **Help cursor** — replicate the original's "Cmd+click any element → help dialog" mechanic. Toggle via `?` key or button. Click any tile, robot, or control → modal with title, sprite, description, and rules.
3. **First-time hints** — small dismissible toasts that appear once per feature. E.g., "Hold Shift while clicking to set scan direction" the first time the player opens the planner.
4. **Help articles** — markdown-driven static pages at `/help/:topic`. Indexed by topic (terrain, weapons, postures, sport modes, etc.).

### Files (post-MVP Phase 11.5)

- `src/components/help/Tooltip.tsx` — primitive (Floating UI under the hood)
- `src/components/help/HelpDialog.tsx` — contextual help modal
- `src/components/help/HelpCursorToggle.tsx` — button + `?` key handler
- `src/components/help/FirstTimeHint.tsx` — toast component with auto-dismiss
- `src/components/help/HelpProvider.tsx` — context that exposes `useHelp()`
- `src/state/useHelpStore.ts` — tracks `hintsShown: Set<string>`, persists to localStorage
- `src/lib/help/topics/` — markdown files: `open-ground.md`, `bushes.md`, `low-walls.md`, `walls.md`, `crevices.md`, `rifle.md`, `burst-gun.md`, `auto-rifle.md`, `missile-launcher.md`, `grenade-launcher.md`, `standing.md`, `crouching.md`, `aim-and-fire.md`, `scan-and-fire.md`, `scan-cone.md`, `team-rating.md`, `formations.md`, `game-lengths.md`, `arena-types.md`
- `src/app/help/[topic]/page.tsx` — route for the help articles
- `public/assets/help/` — sprite + screenshot assets shown in dialogs

### Content — terrain help dialog example

```md
# Bushes

[bush sprite]

Bushes provide cover to **crouching** robots that are *on the bush tile*.
Standing robots see and shoot over bushes — no protection.

**Movement**: standing robots cross at full speed. Crouching is blocked.

**Cover**: a crouching target on a bush has a 30% chance of evading any
single shot. The cover does not reduce damage on a hit.

Tip: bush cover does *not* protect robots standing one tile behind a bush —
only robots directly on it.
```

(All copy short, scannable, paired with sprite + a screenshot when useful.)

### Tutorial deferred

A proper interactive tutorial (port of the original's Hunters vs. Sitting Ducks walkthrough) is a v2 deliverable. Post-MVP can ship the help system above plus a static `/help` index page. v1 should avoid building this unless the planner is otherwise unplayable.

---

## 11. Error handling & resilience

Scoped for "fun game with friends." Pragmatic failure handling, no production observability.

**Required v1 patterns**:
- **React Error Boundaries** wrap major UI sections (planner, movie). Fallback = error message + reload button.
- **Schema validation at local boundaries** using zod where data crosses storage/import boundaries, especially arena JSON and replay JSON.
- **Discriminated unions for outcome types** (`FireResolution` etc.) — no silent failures, no `null`-means-"failed".
- **localStorage corruption fallback**: parse errors on hydrate → prompt user to reset; wipe key.
- **Engine errors** (`resolveTurn` throws): try/catch around local resolution; stop the turn, show a clear error, and log to console.

**Out of v1 scope** (deferred to post-MVP):
- WebSocket reconnect and lobby recovery
- Schema validation for API requests and WebSocket messages
- Sentry / third-party error reporting
- Automatic retry for transient API failures
- Distinguishing "network down" vs "server down" vs "session expired"
- Match-state divergence detection / repair
- Tab-collision detection ("match open in another tab")

If something breaks in a friend match, the user reloads. That's fine for v1.

**Files**:
- `src/components/errors/ErrorBoundary.tsx`
- `src/lib/net/protocol.ts` (post-MVP Phase 12)
- `src/lib/net/reconnect.ts` (post-MVP Phase 12)

---

## 12. Browser, input, and device matrix

### v1 target (locked)

- **Desktop only**. Minimum viewport **1280×720**. Smaller viewports show "Please use a larger screen for the best experience." (Engine + replay still work; only the planner/movie UI is gated.)
- **Browsers**: Chrome 110+, Edge 110+, Firefox 115+, Safari 16.5+. Test in Chrome and Firefox at minimum; others best-effort.
- **OS**: Windows / macOS / Linux. Browser handles abstraction; no OS-specific code.
- **Input**: mouse + keyboard only. Touch not supported in v1; mobile/tablet = v2.

### Mouse interactions

| Interaction | Action |
|---|---|
| Left click on tile | primary action (place / move / target) |
| Right click | reserved for context menu (TBD per phase) |
| Shift + left click | set scan direction (mirrors original) |
| Ctrl + Shift + left click | repeat-fire (mirrors DOS shortcut) |
| Mouse drag on empty area | pan camera |
| Mouse wheel | zoom camera (Phase 9+) |
| Hover | tooltip / cursor state (target sight / blocked / out of range) |

### Keyboard shortcuts

Ported from the original's keyboard reference where modern equivalents exist:

| Key | Action |
|---|---|
| `?` or `H` | Toggle help cursor mode (post-MVP; v1 may reserve the shortcut) |
| `Cmd/Ctrl + S` | Save match (manual save anchor) |
| `Cmd/Ctrl + E` | End turn |
| `Cmd/Ctrl + D` | Toggle Team Data panel |
| `Cmd/Ctrl + A` | Next robot |
| `1` … `8` | Select robot by index |
| `Space` | Center on active robot / toggle to scanning range |
| `Shift` (held) | Scanning-direction cursor mode |
| `Esc` | Cancel current action / close dialog |
| `←` `→` | Movie playback: step backward / forward |
| `,` `.` | Movie playback: slower / faster |
| `Tab` | Cycle UI focus (a11y) |

Defer mobile / tablet / touch to v2 with explicit documentation: "v1 ships desktop only."

---

## 13. Cross-cutting concerns

### Determinism contract (engine)

- `Math.random()` and `Date.now()` are **forbidden** in `src/engine/`. Enforced by ESLint custom rule (lands in Phase 1.5).
- Only integer arithmetic on game-state values where possible. Distances / damage are integers. Projectile mid-flight positions are tile-by-tile schedules, never `number` floats.
- `verifyReplay` against canned replays runs in CI from Phase 5 onward.

### Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Pure functions (engine, planner helpers) — colocated `*.test.ts` |
| Integration | Vitest | Full `resolveTurn` runs against canned `MatchState`s — `src/engine/__integration__/` |
| Replay regression | Vitest | Curated `ReplayLog`s verify byte-equal across engine refactors — `src/engine/__golden__/` |
| Component | Vitest + @testing-library | React components — colocated `*.test.tsx` |
| E2E | Playwright | Full hot-seat match flow — `e2e/` (Phase 11) |

### Documentation conventions

- High-level: markdown in `docs/`. Locked numerical constants live in `docs/spec.md`; `src/engine/constants.ts` and `src/engine/catalog.ts` are the literal data tables.
- Module-level: top-of-file JSDoc block in each `src/engine/*.ts` citing the spec section it implements.
- Public APIs: JSDoc on exported functions/types.

---

## 14. Open questions & risks

| Question | Impact | Resolution path |
|---|---|---|
| Per-weapon projectile speed | Phase 3 numbers | Default values shipped; tune in playtest |
| Stealth × Scan-and-Fire interaction | Phase 4 edge case | Default: stealth that becomes visible mid-turn triggers S&F watchdogs that have LoS in that tick. Test in playtest. |
| Arena tile transcription accuracy | Phase 6 | Hand-probe Rubble Two and Rubble Three from DOS coordinates; automated extraction deferred |
| Mobile / tablet playability | Out of v1 (locked §12) | Desktop-only with mouse + keyboard for v1; tablet/touch in v2 |
| Server hosting cost | Post-MVP | Online lobby is v1.1/post-MVP; do not choose hosting before hot-seat is playable |
| Replay format breaking changes | Phase 5 | `formatVersion` + migrations table (§9); CI gates on canned old replays passing `verifyReplay` |
| Damage scaling with distance vs. binary hit/miss | Engine semantics | Currently: bracket model with `P(full)` over distance. Could prove false in playtest. Engine spec is testable; can swap without rewriting callers. |
| Sport modes beyond Survival | Out of v1 | All non-Survival modes deferred; engine reserves `sportType` field |
| AI tiers | Out of v1 | Deferred to post-v1; add Stupid AI in Phase 14, more later |
| Audio / SFX / music | Out of v1 | Deferred to post-MVP entirely |
| Localization | Out of v1 | English only; not building i18n hooks |
| Accessibility | Out of v1 | Not a priority for "fun with friends" scope |
| Security / abuse prevention | Out of v1 | Trust-based personal-use scope. Post-MVP server validates inputs (zod) but no rate limiting, DDoS protection, replay tampering checks, or abuse handling |
| Privacy / analytics / cookie policy | Out of v1 | No third-party analytics; no cookie banner. Browser-token appears only if post-MVP shared persistence lands |
| License / legal disclaimers | Out of v1 | Defer until shared publicly |
| Production observability | Out of v1 | Console logs are fine for personal use; no Sentry / metrics / alerts |
| Full help/tutorial system | Post-MVP | v1 only needs minimal labels/tooltips required to play |
| Account system | Out of v1 | No accounts in v1; browser-token honor-system identity is enough for post-MVP shared persistence |
| Achievements / progression | Out of v1 | Original had none; matches are standalone |
| Visual regression testing | Out of v1 | Add when art breakage actually causes pain |
| Server scaling | Out of v1 | Single-process Node, single-instance Postgres. Friend-scale only |
| Spectator / live spectating | Out of v1 | Public replay URLs cover the main case |
| Hosting platform swap | Phase 12+ | v1 = local dev only. Production shared persistence later = Vercel + Supabase. `DATABASE_URL` env-var swap |
| Original-game source files | Cleanup | Keep manual dumps, screenshots, and original packages local and gitignored; publish summarized research notes only |

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
- **Scan & Fire**: enemy-targeted wait-and-shoot mode. Robot watches a cone for an enemy; fires a tracking projectile.
- **Stride parity**: per-robot 0/1 flag that flips each move and determines step cost (0.3/0.7 alt single, 0.4/0.8 alt double).
- **BLACK / GREY zone**: scan-cone subdivision. Inner 90° = BLACK (1.0 hit chance); outer 45° each side = GREY (0.2 hit chance); outside 180° = "angle blocked".
- **Cover**: terrain-based miss chance, only applies to crouching targets. Bush = 30% on tile; low wall = 50% on tile, 90% in path.
- **Replay**: `{ initialState, seed, turnOrders[] }` — re-runs deterministically.
- **Tile-targeted vs. tracking projectile**: Aim & Fire creates the former (target tile fixed); Scan & Fire creates the latter (target robot tracked).

---

## 16. Visual style guide

A small palette + token table so UI chrome, SVG assets, and terrain rendering share the same source of truth. Lives in `src/lib/design-tokens.ts` and is referenced from §5 (asset authoring) and §6 (arena rendering).

### Palette

```ts
// src/lib/design-tokens.ts

export const PALETTE = {
  // App chrome
  appBg:        "#1a1a1f",
  panelBg:      "#272731",
  panelBorder:  "#3a3a48",
  textPrimary:  "#e8e8ee",
  textMuted:    "#8a8a99",
  accent:       "#5c8aff",  // links, active state
  warning:      "#ffb84d",
  danger:       "#ff5c6a",

  // Team colors (4 distinct, colorblind-distinguishable)
  team1: "#e84a4a",   // red
  team2: "#5c8aff",   // blue
  team3: "#54c878",   // green
  team4: "#ffd24a",   // yellow

  // Terrain rendering
  terrain: {
    open:      { fill: "#3d6a3d" },
    rough:     { fill: "#6e5a3a" },
    bush:      { fill: "#2e8c3e" },
    lowWall:   { fill: "#a04040" },
    wall:      { fill: "#e02828" },
    crevice:   { fill: "#4a3a1a" },
    crate:     { fill: "#3a6acc" },
    outerWall: { fill: "#7a2020" },
  },

  // Effects
  bulletColor:    "#ffe680",
  missileColor:   "#ffa64d",
  smokeColor:     "#aaaab0",
  explosionColor: "#ff8a3a",
  lastKnownX:     "#ff5c6a",
};
```

Numbers are starting points — tune in visual playtest. If the deferred extraction script returns later, add classifier metadata then.

### Typography

- **Body / UI**: `Inter` (Google Fonts) — neutral, readable at small sizes
- **Display / numbers**: `JetBrains Mono` for the timeline / coords / Team Data table — fixed-width keeps numerical UIs aligned

### Spacing

Tailwind v4 defaults (4 px base; `space-y-2` = 8px, etc.) — no custom scale.

### Animation timings

| Animation | Duration | Notes |
|---|---|---|
| Move-step lerp | matches the step's tick budget (e.g., 0.3 s for parity-0 single move) | Engine-driven |
| Posture sprite swap | 100 ms cross-fade | Decorative |
| Scan rotation | 50 ms per directional unit (matches engine cost) | Engine-driven |
| Bullet projectile | 1 ms per pixel × distance, capped 200 ms | Decorative; impact tick is engine-driven |
| Missile projectile + smoke trail | 80 ms per tile traveled | Smoke particles fade over 600 ms |
| Hit flash (red tint on target) | 150 ms | Decorative |
| Small explosion sprite (hit) | 250 ms | 4 frames |
| Large explosion sprite (destroyed) | 500 ms | 8 frames + fade |
| Robot return-to-dock fade | 400 ms | |

### SVG conventions

- All robot SVGs drawn pointing **East** (rotation = 0°). Pixi rotates at runtime per `scanHeading`.
- All robot SVGs use neutral grey for body; team color applied via Pixi `tint`.
- 24×24 viewport per tile sprite (matches default Pixi tile size).
- No drop shadows in source SVG; Pixi handles drop shadow via filter if desired.

---

## 17. Phase summary table

| Phase | Status | Effort | Goal |
|---|---|---|---|
| 1 | ✅ DRAFT COMPLETE | M | Engine primitives (RNG, geometry, movement, firing, blast, catalog) |
| **1.5** | ⬜ NEXT | S | Toolchain: ESLint flat config + custom no-Math.random rule, Prettier, basic GitHub Actions CI |
| 2 | ⬜ | L | Turn resolver core — per-tick orchestration, immediate Aim & Fire, command interpretation |
| 3 | ⬜ | M | Multi-tick projectiles in flight |
| 4 | ⬜ | L | Scan & Fire mode + visibility resolver + Stealth class rule |
| 5 | ⬜ | S | Replay format (serialize/deserialize/verify) |
| 6 | ⬜ | M | Next.js + PixiJS scaffold; static arena renderer; hand-transcribed Rubble arena JSON |
| 7 | ⬜ | L | Movie playback — animate `ResolutionEvent[]`; transport controls |
| 8 | ⬜ | M | Quick Start setup UI for two-team hot-seat Survival |
| 9 | ⬜ | L | Planner UI: movement / posture / scan |
| 10 | ⬜ | M | Planner UI: firing dialogs (Aim & Fire, Scan & Fire) |
| 11 | ⬜ | M | End-turn flow + Team Data + Final Ceremony — hot-seat MVP playable |
| 11.5 | ⏸ POST-MVP | M | Full onboarding, contextual help, tooltips (§10) |
| 12 | ⏸ POST-MVP / v1.1 | XL | Online lobby (WebSocket relay; host-creates / join-by-code) |
| 13 | ⬜ | M | Polish — bug fixes, art swap-in, animation timing pass |

**Critical path to v1 hot-seat MVP**: 1 → 1.5 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Phase 13 polish runs only as needed for the playable hot-seat milestone. Phases 11.5 and 12 are post-MVP.
