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
- Playwright/E2E changes → revisit separately
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
- [ ] Follow-up: resign UI control in the match view (server path is complete + tested)

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
