# AGENTS.md

Guidance for Codex and other AI coding agents working in this repository.

## Start Here

Read these first when picking up a fresh session:

1. `CLAUDE.md` - concise current-state handoff and engine rules.
2. `docs/spec.md` - **canonical game spec** (rules, numbers, confidence labels). Replaces `initial-plan.md` as the source of truth.
3. `docs/implementation-plan.md` - phased roadmap and acceptance criteria.

`docs/initial-plan.md` is now historical (the original planning log); see `docs/archive/` for older research-era docs. `references/source-matrix.csv` is useful evidence tracking, but it may lag the current spec. If a rule affects a numerical mechanic, check `docs/spec.md` and the source-of-truth files (`src/engine/constants.ts`, `src/engine/catalog.ts`) before changing code.

## Project

RoboArena is a modern web-based clone inspired by Maxis RoboSport (1991). Two
to four internet-connected human players privately program robot teams, then
watch simultaneous deterministic turn resolution as a movie.

Important scope constraints:

- v1 is 2-4 human players on separate internet-connected devices in one room,
  with one Team and unique Side per player (1v1, 1v1v1, or 1v1v1v1).
- The v1 server is authoritative and durable. Private orders and hidden state
  must never be exposed to opponents. Players may submit, leave, return later,
  watch unseen turns, and then plan; ordinary service restart must recover.
- Hot-seat and multiple Teams per Side/alliance modes are v2 features.
- Survival sport mode only for v1.
- Desktop-only, mouse + keyboard.
- Audio, AI, mobile/touch, accounts, analytics, i18n, production observability, and production-grade abuse prevention are out of v1 scope.
- Do not ship copyrighted RoboSport assets, sprites, audio, or the RoboSport name in product UI. RoboArena is the product.

### RoboSport parity guard

Original RoboSport had a wider feature set than RoboArena v1: AI personalities,
five sports, five formations, local/link variants, and eight weapon systems.
RoboArena v1 intentionally ships online free-for-all Survival with three
postures, four non-Stealth combat classes, the core planner/movie loop,
authoritative resolution, reconnect, and deterministic replay.

Do not expand scope just because the original had a feature. Add original-game parity features only when `docs/implementation-plan.md` schedules them or the user explicitly changes v1 scope.

## Current State

Phase 1R realignment and Phases 2-6 are draft complete; Phase 1.5 tooling is
complete:

- `src/engine/` contains pure TypeScript deterministic primitives.
- Existing tests cover deterministic primitives, audited timing/combat/Survival
  rules, and the turn resolver.
- The versioned replay recorder, JSON codec, verifier, and v1 golden fixture are built.
- The Next.js shell, static PixiJS arena renderer, and verified Rubble Two/Three imports are built.
- Movie playback, planner, and networking are not built yet.
- Phase 7 event-driven movie playback is next.

The UI stack is Next.js 16, React 19, Tailwind CSS v4, PixiJS, and lucide-react;
Zustand remains planned for interactive planner/movie state.

## Commands

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`.

```bash
npm test
npm run test:watch
npm run typecheck
npm run lint
npm run format:check
npx vitest run path/to/file.test.ts
npx vitest run -t "floored Euclidean"
```

Current scripts:

- `npm test` - run Vitest engine tests.
- `npm run test:watch` - Vitest watch mode.
- `npm run typecheck` - `tsc --noEmit`.
- `npm run lint` - ESLint plus engine nondeterminism bans.
- `npm run format:check` - Prettier verification.
- `npm run dev` - run the Next.js development server.
- `npm run build` - build the production Next.js application.
- `npm run start` - serve the production Next.js build.
- `npm run test:e2e` - build and run the Playwright visual test.

## Architecture

`src/engine/` is the deterministic core. It must remain independent from UI, rendering, networking, browser APIs, and wall-clock time.

Current engine layering:

```text
constants/catalog/types -> rng/geometry/movement/firing/blast/visibility/scanAndFire
                        -> resolver -> replay -> index
```

Future architecture:

- `src/engine/` resolves match state and emits event timelines.
- `src/planner/` builds `TurnOrders` but does not run full turns.
- `src/renderer/` consumes `ResolutionEvent[]` and animates the movie, likely through PixiJS.
- `src/app/` and `src/components/` host the Next.js/React UI.
- `src/lib/net/` owns the v1 typed room protocol, WebSocket client, and reconnect
  state; `server/` owns authoritative room/match orchestration.

Dependency direction is one way: UI/planner/renderer may import engine code; engine must not import them.

## Engine Hard Rules

These are correctness rules, not style preferences:

- No `Math.random()` in `src/engine/`; use `createRng(seed)` from `rng.ts`.
- No `Date.now()`, `performance.now()`, `setTimeout`, or `setInterval` in `src/engine/`.
- No imports from `src/app/`, `src/components/`, `src/renderer/`, `src/planner/`, or browser-only APIs inside `src/engine/`.
- Prefer integer arithmetic for game-state values. Distances, ticks, damage, HP, and tile coordinates are integers.
- Keep engine functions pure: return new state/results and do not mutate inputs.
- Replay determinism is required: `{ initialState, turns: { seed, orders }[] }`
  must re-run to byte-identical event streams.
- Robot HP must never go below 0 or above armor.
- All randomness must be seedable and passed through `Rng`.

Phase 1.5 is expected to enforce nondeterminism bans with ESLint.

## Mechanics Source Rules

Research confidence:

1. DOS / Windows empirical tests override everything for exact mechanics.
2. Local bundled Windows README/manual text and package files are primary supporting evidence.
3. Mac screenshots and UI observations are secondary.
4. Amiga/manual text is historical support.
5. Online reviews and databases are useful for scope and feature inventory, not exact combat numbers.

Every mechanics claim should retain a confidence level where relevant: CONFIRMED, INFERRED, PROPOSED, or OPEN QUESTION. Do not harden an unconfirmed original behavior into a fact without documenting the confidence and source.

The bundled Windows game under `RoboSport (1991)/` confirms the three town sets (`RUBBLE.TWN`, `SUBURBS.TWN`, `COMPUTER.TWN`), RoboPlayer, serial/modem/NetBIOS support, and cross-platform link compatibility with Macintosh and Amiga versions. Use those facts for planning, but do not copy original assets into shipped UI.

Locked or current engine assumptions include:

- Robots can pass through and stack on the same tile; no robot-vs-robot collision.
- Aim & Fire targets a tile, not a robot.
- Bullets do not harm or block on friendlies.
- Missile/grenade blasts can affect friendlies.
- Live fire uses the exact 20-entry score threshold table; BLACK/GREY reticle
  colors are UI approximations, not a two-zone combat model.
- Cover uses endpoint terrain samples and posture to produce cover class 1-4;
  it affects both hit score and direct/blast damage adjustments.
- Missile blast radius is 2 with falloff at radius 0/1/2.
- Movement costs are fixed at 30 ticks for one-tile selectors and 40 ticks for
  two-tile selectors; slow terrain prevents two-step compression and there is
  no stride-parity state.
- Match 1-7 empirical observations are reflected in `src/engine/constants.ts`.

Mechanics risk to preserve: the COMPUTE! review says hit outcomes depend on scan
length and target speed. The live resolver has no independent numeric speed
term; v1 models movement through command-boundary sampling, distance/cover, and
the confirmed off-aimed-tile score halving. Do not add a numeric target-speed
modifier without a DOS empirical test and a matching spec update.

Empirical burden rule: DOS playtesting is slow. Prefer one-turn qualitative gates from `docs/priority-tests.md` over large sample studies unless the extra precision changes implementation. Record defaults for skipped or inconclusive tests instead of blocking unrelated work.

When changing any of these, update `docs/spec.md` and tests in the same change. The actual locked numerical values live in `src/engine/constants.ts` and `src/engine/catalog.ts` — those files are authoritative; the spec doc explains them.

## TypeScript Conventions

- Strict TypeScript is required.
- ESM imports use `.js` extensions in source imports.
- Prefer `readonly` types and immutable return values for engine data.
- Use discriminated unions for outcomes and command/result variants.
- Avoid nullable sentinel values when a typed outcome can express the case.
- Keep module-level docs in source files and high-level design in `docs/`.
- Each `src/engine/*.ts` file should have a top-of-file JSDoc block citing the spec it implements.

## Testing

Test risk, not ceremony:

- Add focused Vitest coverage for any engine behavior change.
- Deterministic behavior should usually have same-seed equality tests.
- Probabilistic behavior should use seeded Monte Carlo tests with stable thresholds.
- Include edge cases for simultaneous outcomes, blocked movement/LoS, posture, terrain, and replay determinism when touching related code.

Before closing engine work, run:

```bash
npm test
npm run typecheck
```

If the local sandbox blocks Vitest spawning esbuild with `EPERM`, note that in the final response and still run typecheck.

## Documentation Workflow

Update docs when the work changes project truth:

- `docs/spec.md` is the canonical spec for rules, numbers, and confidence labels. Update when a mechanic changes.
- `docs/implementation-plan.md` tracks phase status and acceptance criteria.
- `docs/priority-tests.md` and `docs/empirical-tests.md` track original-game research.
- `references/source-matrix.csv` maps mechanics to evidence but may be stale; never use it over `docs/spec.md`.
- `docs/initial-plan.md` is historical; do not edit. `docs/archive/` holds pre-empirical-research docs.

When closing a phase, mark its status in `docs/implementation-plan.md`.

## UI Guidance For Future Phases

When the Next.js UI lands:

- Components live in `src/components/`; routes live in `src/app/`.
- Prefer Server Components by default. Add `"use client"` only for hooks, event handlers, browser APIs, or client state.
- All clickable elements, including buttons, links, and expandable text, must have `cursor-pointer`.
- Use lucide-react icons where a standard icon exists.
- The first screen should be the usable game/setup experience, not a marketing landing page.
- v1 targets desktop only. Small viewports should show a larger-screen message for planner/movie UI.
- Setup/planner controls must be keyboard reachable with visible focus and
  connection/readiness/team identity must not rely on color alone.

## Workflow

- Work trunk-first on `main` unless the user asks for a branch.
- Keep commits focused. Do not amend or force-push.
- Never revert user changes unless explicitly asked.
- Use `rg` / `rg --files` for search.
- Use `apply_patch` for manual file edits.
- Avoid unrelated refactors while delivering a phase.

Commit messages should be short imperative subjects; bodies should explain why and list tests when useful.
