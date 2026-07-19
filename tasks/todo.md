# Phase 11.6 — 3-/4-player FFA hardening + corner selection

Scope decided 2026-07-17: build corner selection UI (real feature); defer
resignation/abandoned-room to Phase 12; automated (non-E2E) coverage only.

## Tasks

- [x] 1. Corner selection — schema/protocol (`validate.ts`, `protocol.ts`, `protocol.test.ts`)
- [x] 2. Corner selection — room service (`rooms.ts`, `index.ts`, `rooms.test.ts`)
- [x] 3. Corner selection — setup UI (`RoomSetup.tsx`, `TeamRow.tsx`)
- [x] 4. v1 unique-Side invariant + test (`rooms.ts`, `rooms.test.ts`)
- [x] 5. 3-/4-player server lifecycle coverage (`matches.test.ts`, fixture)
- [x] 6. 3-/4-client restart & disconnect/rejoin (`rooms.test.ts`)
- [x] 7. Docs (`implementation-plan.md`, `STATUS.md`, `core-build-plan.md`)

## Out of scope this pass

- Resignation / abandoned-room handling → Phase 12
- Automated Playwright/E2E → disabled by user direction; retain specs for possible re-enable
- Real four-browser / two-network gate → manual, Phase 12

## Follow-up: resignation + abandoned-room (Phase 12 resilience, started 2026-07-17)

Design: replay-safe. Resignation is match-lifecycle metadata (`resignedPlayerIds`),
never a simulation-state mutation — an `effectiveTeams` projection drives
outcome/ceremony; `activePlayerIds` drives gating. Engine + replay untouched.

- [x] R1. Resignation core (`matches.ts`, `matches.test.ts`)
- [x] R2. Protocol `ResignMatch` (`protocol.ts`, `protocol.test.ts`)
- [x] R3. Service wiring (`rooms.ts`, `index.ts`, `rooms.test.ts`)
- [x] R4. Abandoned-room sweep (`storage.ts`, `rooms.ts`, `index.ts`, tests)
- [x] R5. Docs
- [x] R6. Resign UI control in the match view (2026-07-18)

### R6 verification note

`ResignControl` (two-step confirm — resignation is irreversible) wired into the
planner header (planning) and the waiting/turn-ready flow views via
`MatchGate.resign()`; `requestOnce` now routes `ResignMatch` to a MatchSnapshot.
Verified by strict typecheck, production build, full unit suite (271), lint, and
Prettier. No behavioral browser test: the repo has no React component-test
harness (vitest env is `node`; components are Playwright-covered) and no E2E
change was in scope. Behavioral proof belongs in a Playwright room-flow step
(offered as a follow-up). No visual baseline is affected — the visual specs
render only `/movie/demo`, `/preview`, and `/`, none of which mount the planner
header or the MatchGate flow views.

## Review

Landed 2026-07-17. Gates all green: **262 Vitest tests**, strict typecheck,
ESLint, Prettier, and a production Next.js build.

Key finding: the engine already resolved/deployed/replayed nonadjacent
`homeSlot`s (indexed by explicit slot, non-compacting actor order, with an
existing `resolver.test.ts` proof). The only barrier to real nonadjacent
corners was `startMatch` flattening `homeSlot = index`. So corner selection was
a setup/protocol/room-service/UI change plus one line in `startMatch` — no
engine change.

Design: `SetHomeSlot` mirrors `SetReady`/`UpdateConfig` (dedicated message,
server-authoritative, resets readiness) rather than overloading
`UpdatePlayer`, keeping create/join untouched. Corners auto-assign to the lowest
free slot on create/join; `assertUniqueV1Seating` enforces the unique-Side/
corner v1 rule at start.

## Post-review pass (2026-07-18)

Code review of the landed commit found one bug and two cleanups; all fixed:

- **Swap semantics for `SetHomeSlot`**: the reject-taken guard deadlocked
  corner selection in a full four-player room (all corners auto-assigned, no
  free target). Requesting a held corner now swaps seats with its occupant and
  resets both players' readiness; `HOME_SLOT_TAKEN` is removed from the
  protocol error union. Tests: full-room swap + two-player swap/readiness.
- **Single `HomeSlot` type**: `validate.ts` now re-exports the engine's
  `HomeSlot` and types `homeSlotSchema` as `z.ZodType<HomeSlot>` instead of
  declaring a duplicate inferred type.
- **Shared fixture scaffold**: `makeMatch`/`makeFfaMatch` both delegate the
  non-team `MatchState` scaffold to one `makeMatchState` helper (note:
  `makeMatch` seats teams at corners 0/2, `makeFfaMatch` by index — kept).

Files touched (9): `src/lib/setup/validate.ts`, `src/lib/net/protocol.ts`,
`src/lib/net/protocol.test.ts`, `server/rooms.ts`, `server/index.ts`,
`server/rooms.test.ts`, `server/matches.test.ts`,
`src/engine/__fixtures__/match.ts`, `src/components/setup/RoomSetup.tsx`,
`src/components/setup/TeamRow.tsx` (+ docs).

Follow-ups (Phase 12): resignation + abandoned-room handling; the real
four-separate-session / two-network functional gate.

## ⏸ Playwright automation disabled after baseline review (2026-07-18)

The movie-zoom sharpness pass (zoom-following renderer resolution, 4× SVG
texture density, 2× robot rasterization) and Phase 11.7 planner sprite reuse
were exercised in Playwright. The four-test visual suite passes. The movie and
terrain-preview images were inspected at native resolution: the movie baseline
was re-approved for its smoother high-density rendering, while the terrain-only
preview remained pixel-identical. New planner Aim-overlay and live Scan-range
configuration baselines were also inspected and approved; the latter verifies
the exact stepped acquisition boundary remains readable beside the side sheet.
After that review, automated Playwright commands and CI execution were disabled
by user direction because of their runtime and low feedback value. Keep the
specs and baselines for a possible later re-enable. Current UI validation is
manual browser/iPad testing with screenshots and direct feedback.

## Phase 11 turn-loop review pass (2026-07-18)

High-effort review of 36af312 (authoritative turn loop). Five fixes landed:

- **Scan privacy leak** (`view.ts`): `scan-target-acquired` was delivered to
  the scanned player even when the scanner was unseen, leaking the hidden
  robot's id and exact range. Now gated on scanner authorization only (test:
  "never reveals an unseen scanner to its target").
- **`broadcastMatch` no longer swallows all errors** (`server/index.ts`): only
  the expected `MATCH_NOT_FOUND` (setup-only subscriber) is ignored; anything
  else logs instead of silently starving a participant of updates.
- **Dead `CanonicalTurnRecord.nextState` removed** (`matches.ts`): a full
  deep-cloned MatchState persisted per turn with zero readers. Old stored
  rooms carry the extra JSON key harmlessly; new saves shrink.
- **Engine constants imported** (`matches.ts`): `REPLAY_FORMAT_VERSION`
  replaces two hardcoded `formatVersion: 1`; `secondsToTicks` replaces
  `turnLengthSeconds * 60` in the playback clamp.
- **Single match-kind list** (`client.ts`): `MATCH_MESSAGE_KINDS` const drives
  both the `MatchClientMessage` type and one `isMatchMessage` guard, replacing
  three hand-synced lists.

Deferred (tracked for a rooms/matches refactor pass): move the two snapshot
getters' `resolvePendingTurn` inside `#withLock` before storage goes async
(Postgres); centralize the 4x-duplicated resolve-and-persist block in a
`#mutateMatch` helper; drop the O(turns²) replay rebuild in `resolvePendingTurn`.
Phase 12 storage work: playback-position side table; decide the orphaned
`locked_orders` table's fate.
