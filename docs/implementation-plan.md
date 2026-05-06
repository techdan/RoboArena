# RoboArena Implementation Plan

This is the action-focused execution roadmap from "engine primitives exist" to "v1 ships". It complements but does not replace `docs/initial-plan.md` (the spec / canonical constants) or `docs/priority-tests.md` (empirical research log).

**Audience**: any agent (human or AI) picking up a phase cold. Each phase is self-contained enough to execute independently once dependencies land.

**v1 scope reminder**: human-vs-human only (hot-seat + online lobby), no AI. Survival sport mode only. 2 postures (Standing, Crouching). Stealth class included. Other sport modes, Ducking, AI, audio: deferred.

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
  │  builder + UI    │  │  timeline player │  │  (Phase 12)      │
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
- `src/lib/net/` is the multiplayer transport layer (Phase 12).

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
│   ├── ai/                 (deferred — Phase 6 v2 scope, AI = post-v1)
│   ├── lib/
│   │   ├── arenas/         arena .json files (Rubble Two/Three transcribed)
│   │   ├── net/            WebSocket lobby client + protocol (Phase 12)
│   │   └── replay/         save/load helpers for browser
│   ├── app/                Next.js 16 routes
│   │   ├── (lobby)/
│   │   ├── match/[id]/
│   │   ├── replay/[id]/
│   │   └── layout.tsx
│   └── components/         React UI components
├── server/                 (Phase 12) tiny Node WebSocket relay
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
| Formatter | Prettier | Standard. Run via lint-staged on commit (Phase 2 setup). |
| E2E test | Playwright | Deferred to Phase 11 (after planner UI is partly working). |
| CI | GitHub Actions | Repo will eventually live on GitHub. Workflow: typecheck + lint + test + build on push to main. |
| Deploy | Vercel | Default for Next.js 16. Preview deploys per branch. WebSocket server (Phase 12) deploys separately (Vercel doesn't support persistent WS — see Phase 12 §"Hosting"). |
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

### Phase 2 — Turn resolver core [⬜ NEXT]

**Goal**: orchestrate per-tick simulation. Consume `MatchState + TurnOrders + seed`, emit `ResolutionEvent[]` and a new `MatchState`. Implements the per-tick phase order. Covers immediate Aim & Fire (no projectile flight time yet — see Phase 3).

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
  4. apply Aim & Fire commands (immediate impact, Phase 2; multi-tick in Phase 3)
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
- Aim & Fire on stationary target → emits `hit` or `miss` correctly
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

### Phase 3 — Projectiles in flight [⬜]

**Goal**: model multi-tick projectile travel. Aim & Fire creates a `TileProjectile` that travels along its path and resolves at the impact tick (calculated from distance and weapon-specific projectile speed). Bullets (rifle/burst/auto) are fast (1-2 ticks); missiles/grenades are slower (3-5 ticks). Engine tracks projectiles in flight as a list on `MatchState`, advances them each tick.

**Dependencies**: Phase 2.

**Files**:
- `src/engine/projectiles.ts` — `advanceProjectiles(state, tick) → { hits, blastImpacts, stillInFlight }`
- `src/engine/types.ts` — extend `MatchState` with `projectilesInFlight: Projectile[]` and `Projectile` with `launchTick: number`
- `src/engine/resolver.ts` — call `advanceProjectiles` per tick
- `src/engine/projectiles.test.ts`

**Per-weapon projectile speeds** (PROPOSED, tunable):
- Bullet: 1 tick per tile (very fast; mostly hits within 1-2 ticks of launch)
- Missile / Grenade: 0.5 tiles/tick (slower, more visible)

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

### Phase 4 — Scan & Fire mode + visibility & stealth [⬜]

**Goal**: implement the "wait-and-shoot" Scan & Fire firing mode (creates a `TrackingProjectile` when an enemy enters scan range × cone) AND per-team visibility resolution including the Stealth class rule.

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

**Dependencies**: Phase 1 (types).

**Files**:
- `next.config.ts`, `app/layout.tsx`, `app/page.tsx` (landing)
- `src/lib/arenas/` — `rubble-two.json`, `rubble-three.json` — tile-by-tile transcriptions of the canonical arenas
- `src/lib/arenas/index.ts` — `loadArena(name): Arena`
- `src/renderer/PixiArena.tsx` — React component wrapping a Pixi `Application` that renders an `Arena`
- `src/renderer/sprites.ts` — sprite registry (terrain tiles initially; placeholder vector art)
- `src/components/ArenaPreview.tsx` — `<ArenaPreview arenaName="rubble-three" />`
- `src/app/preview/page.tsx` — temporary debug page that shows all arenas

**Note on arena transcription**: the user's empirical work mapped specific terrain at y=11 / y=12 in Rubble Three. We'll need full arena transcriptions either by:
1. Manual entry from a screenshot grid (≈ 32×32 = 1024 tiles per arena; tedious but exact)
2. Help-cursor probe in DOS to identify each tile
3. Approximate transcription with playtest tuning

For v1, **option 1** (manual from existing screenshots) is the best path — we already have several screenshots of each arena. Result is an authored arena, not necessarily pixel-exact to DOS but visually faithful.

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

**Risks**:
- PixiJS + React + Next.js SSR plays poorly out of the box (Pixi requires window/canvas). Mitigation: dynamic import with `ssr: false` for the Pixi component.
- Tile sprites: ship with placeholder vector art (rectangles with terrain-colored fills). Real art is Phase 13.

**Effort**: M.

---

### Phase 7 — Movie playback [⬜]

**Goal**: render robots and animate `ResolutionEvent[]` as a movie — play, pause, step forward/backward, change speed. Match the original's transport controls.

**Dependencies**: Phases 1, 2 (so we have `MatchState` + events to render).

**Files**:
- `src/renderer/MoviePlayer.tsx` — React component that owns the playback state machine (playing / paused / current tick)
- `src/renderer/animations.ts` — per-event animation handlers (move-step, hit explosion sprite, etc.)
- `src/renderer/RobotSprite.tsx` — Pixi container per robot with posture-aware rendering
- `src/components/MovieControls.tsx` — play / pause / step / speed controls
- `src/app/movie/[id]/page.tsx` — debug route that runs a canned `ReplayLog` from disk

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

**Goal**: implement the Quick Start and Custom Game screens — team naming, color, side, brain (Human only in v1), home area, sport type (Survival only in v1), formation, game length, arena type. Plus the team-builder for Custom Game with the Team Rating budget cap.

**Dependencies**: Phases 1, 6.

**Files**:
- `src/app/(lobby)/page.tsx` — main menu (Quick Start / Custom Game / Replay)
- `src/app/(lobby)/setup/quickstart/page.tsx`
- `src/app/(lobby)/setup/custom/page.tsx`
- `src/components/setup/TeamRow.tsx` — team name / color / side / home area
- `src/components/setup/RobotPicker.tsx` — class picker with point-buy budget bar
- `src/lib/setup/validate.ts` — `validateMatchConfig(cfg): { ok, errors }`

**UX cues from screenshots** (preserve the layout but modernize):
- Quick Start: 2 columns, sport / formation / length / arena dropdowns on left; Team Roster on right
- Custom Game: team list at top with Rating column, robot list below with class+name editable
- Use modern Tailwind v4 styling, large touch targets, keyboard navigation

**Tests required**:
- form validation: empty team name rejected with helpful message
- custom-game robots' rating sums match shown Team Rating
- budget cap enforced (sum ≤ cap; cap shown in lobby)
- selecting Campaign auto-populates 8 robots; selecting Skirmish drops to 2

**Acceptance criteria**:
- [ ] User can configure a 2-team Survival Beginner Melee Rubble match and click Start Game
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

### Phase 12 — Online lobby (WebSocket relay) [⬜]

**Goal**: 2 players play remotely. One creates a lobby with a 6-character code; the other joins by code. Server is a tiny Node WebSocket relay that holds match state and pumps `TurnOrders` between clients. Server runs the engine to prevent cheating (server-authoritative resolution).

**Dependencies**: Phases 1-11.

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

**Risks**:
- NAT / firewall / corporate proxies blocking WebSockets. Mitigation: server runs over HTTPS WSS on a standard port (443).
- State management in server: keep simple in-memory map; if server restarts, active matches are lost. Acceptable for v1.
- Cheating: server-authoritative resolution prevents most. The one residual concern: a malicious client could submit invalid `TurnOrders`. Server validates orders before resolving (path validity, scan-cone, etc.) and rejects malformed ones.

**Effort**: XL.

---

### Phase 13 — Polish, accessibility, art, soundscape [⬜ ⏸ partly deferred]

**Goal**: ship-quality. Real art (replace vector placeholders), keyboard navigation, screen reader support for menus, mobile-friendly layouts (or graceful "desktop only" message), perf budget enforcement, optional audio.

**Dependencies**: all prior.

**Effort**: L.

**Note**: audio explicitly deferred per user direction. Real art likely deferred too — playtest with placeholders first.

---

## 5. Cross-cutting concerns

### Determinism contract (engine)

- `Math.random()` is **forbidden** in `src/engine/`. Enforce via ESLint custom rule (Phase 2).
- `Date.now()`, `performance.now()`, `setTimeout`, `setInterval`: forbidden in engine.
- Only integer arithmetic on game-state values where possible. Distances / damage are integers. Fractional positions (projectile mid-flight) are fixed-point or schedule-based, never `number` floats.
- Serialization round-trip is checked in Phase 5; from then on, every PR runs `verifyReplay` on a canned replay as a CI gate.

### Testing strategy

| Layer | Tool | Scope | Where |
|---|---|---|---|
| Unit | Vitest | Pure functions (engine, planner helpers) | colocated `*.test.ts` |
| Integration | Vitest | Full `resolveTurn` runs against canned `MatchState`s | `src/engine/__integration__/` (Phase 2+) |
| Replay regression | Vitest | Curated ReplayLogs verify byte-equal across engine refactors | `src/engine/__golden__/` (Phase 5+) |
| Component | Vitest + @testing-library | React components (planner, setup) | colocated `*.test.tsx` |
| E2E | Playwright | Full hot-seat match flow | `e2e/` (Phase 11) |

### Code review (during multi-agent phase)

When PR-based review starts:
- PR description must list: **what** changed, **why**, **test coverage added**, **follow-ups deferred**
- All new public APIs documented with JSDoc
- ESLint + typecheck + tests must pass before merge
- A reviewing agent checks the PR against the relevant phase's acceptance criteria

### Documentation conventions

- High-level: markdown in `docs/`. One-shot specs live here; long-lived references (terrain table, weapon stats) live in `initial-plan.md` § "Engine constants".
- Module-level: each `src/engine/*.ts` has a top-of-file JSDoc block citing the spec section it implements.
- Public APIs: JSDoc with `@example` blocks where non-obvious.
- ADRs (architecture decisions): file under `docs/adr/NNNN-title.md` when a non-obvious choice is made (e.g., "WebSocket relay over WebRTC for v1"). One per decision; brief.

### Accessibility (Phase 13 but baked in earlier)

- Keyboard navigation for all menus (already a CLAUDE.md project rule via `cursor-pointer`)
- ARIA labels on icon-only buttons (Pixi canvas has limited a11y; use offscreen text labels for screen readers)
- Color choices avoid red-green-only signals (color-blind friendly; supplement with shape/icon cues)
- Minimum hit targets ~44×44 CSS pixels per WCAG

### Performance budget

- Movie playback: maintain 12 FPS (= original) on a mid-range laptop. PixiJS @ 12 FPS with ~50 sprites is trivial.
- Engine `resolveTurn`: target < 100 ms for a 15-second turn with 16 robots (Battle 2-team). Plenty of headroom.
- Page weight: < 500 KB JS gzipped for the lobby; < 2 MB for the match page (includes Pixi). Track via Next.js build report.

---

## 6. Open questions & risks

| Question | Impact | Resolution path |
|---|---|---|
| Per-weapon projectile speed | Phase 3 numbers | Default values shipped; tune in playtest |
| Stealth × Scan-and-Fire interaction | Phase 4 edge case | Default: stealth that becomes visible mid-turn triggers S&F watchdogs that have LoS in that tick. Test in playtest. |
| Arena tile transcription accuracy | Phase 6 | Manual transcription from screenshots; visually faithful, not pixel-exact |
| Mobile playability | Phase 13 | Desktop-first; v1 ships "looks fine on tablet, not optimized" |
| Server hosting cost | Phase 12 | Railway free tier supports v1 traffic estimate (< 100 concurrent matches) |
| Replay format breaking changes | Phase 5+ | `formatVersion` field; deserializer rejects unknown versions; migrations as needed |
| Damage scaling with distance vs. binary hit/miss | Engine semantics | Currently: bracket model with `P(full)` over distance. Could prove false in playtest. Engine spec is testable; can swap without rewriting callers. |
| Sport modes beyond Survival | Out of v1 | All non-Survival modes deferred; engine reserves `sportType` field |
| AI tiers | Out of v1 | Deferred to post-v1; add Stupid AI in Phase 14, more later |

---

## 7. Glossary & cross-references

- **`docs/initial-plan.md`** — canonical spec; locked numerical constants for combat, terrain, posture, etc.
- **`docs/priority-tests.md`** — empirical research log; Match 1-7 results
- **`docs/manual.txt`** — partial Amiga RoboSport manual (SKID ROW transcription)
- **`docs/empirical-tests.md`** — broader empirical-test catalog (T1-T24)
- **`screenshots/`** — DOS reference captures (50 PNGs; UI layouts, menus, terrain examples)
- **`references/source-matrix.csv`** — source of every confirmed mechanic
- **`tests/original-game-test-plan.md`** — original DOSBox empirical-test plan
- **`src/engine/`** — Phase 1 implementation; the canonical-stats block in `initial-plan.md` is the source of truth for the values used here.

**Key terminology**:
- **Aim & Fire**: tile-targeted single-shot fire mode. Bullet flies to a fixed tile; doesn't track target.
- **Scan & Fire**: enemy-targeted wait-and-shoot mode. Robot watches a cone for an enemy; fires a tracking projectile.
- **Stride parity**: per-robot 0/1 flag that flips each move and determines step cost (0.3/0.7 alt single, 0.4/0.8 alt double).
- **BLACK / GREY zone**: scan-cone subdivision. Inner 90° = BLACK (1.0 hit chance); outer 45° each side = GREY (0.2 hit chance); outside 180° = "angle blocked".
- **Cover**: terrain-based miss chance, only applies to crouching targets. Bush = 30% on tile; low wall = 50% on tile, 90% in path.
- **Replay**: `{ initialState, seed, turnOrders[] }` — re-runs deterministically.
- **Tile-targeted vs. tracking projectile**: Aim & Fire creates the former (target tile fixed); Scan & Fire creates the latter (target robot tracked).

---

## 8. Phase summary table

| Phase | Status | Effort | Goal |
|---|---|---|---|
| 1 | ✅ DRAFT COMPLETE | M | Engine primitives (RNG, geometry, movement, firing, blast, catalog) |
| 2 | ⬜ NEXT | L | Turn resolver core — per-tick orchestration, immediate Aim & Fire, command interpretation |
| 3 | ⬜ | M | Multi-tick projectiles in flight |
| 4 | ⬜ | L | Scan & Fire mode + visibility resolver + Stealth class rule |
| 5 | ⬜ | S | Replay format (serialize/deserialize/verify) |
| 6 | ⬜ | M | Next.js + PixiJS scaffold; static arena renderer; arena .json transcriptions |
| 7 | ⬜ | L | Movie playback (consume `ResolutionEvent[]`, animate; transport controls) |
| 8 | ⬜ | M | Match setup UI (Quick Start + Custom Game) |
| 9 | ⬜ | L | Planner UI: movement / posture / scan |
| 10 | ⬜ | M | Planner UI: firing dialogs (Aim & Fire, Scan & Fire) |
| 11 | ⬜ | M | End-turn flow + Team Data + Final Ceremony — hot-seat MVP playable |
| 12 | ⬜ | XL | Online lobby (WebSocket relay; host-creates / join-by-code) |
| 13 | ⬜ ⏸ partial | L | Polish, art, accessibility (audio deferred) |

**Critical path to v1**: Phases 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 (hot-seat playable) → 12 (online). Phase 13 polishes throughout.
