# Phase 12.1 v1 presentation-polish handoff

**Status:** implemented 2026-07-22; manual visual evidence remains Phase 12.2.

**Objective:** polish the existing non-planner local match flow before the
Phase 12.2 evidence pass. Deliver a clearer setup, movie handoff, and Final
Ceremony without changing gameplay, networking, persistence, or authorization.

Read `CLAUDE.md`, `docs/spec.md`, and `docs/implementation-plan.md` before
starting. Phase 12.1 is deliberately bounded; do not reinterpret this as a
general Phase 13 redesign.

## Hard boundaries

Do not change:

- `src/engine/`, rules, scores, RNG, event timing, command shapes, or replay
  bytes;
- room/match protocol message shapes, server transitions, SQLite storage, seat
  ownership, acknowledgement semantics, or the Phase 12.5 architecture;
- planner command controls, planner timeline, targeting math/overlays, or
  planner camera behavior except for a shared shell/style regression fix;
- visibility projections or what any participant is authorized to receive;
- supported viewport scope: desktop 1280×720+ and iPad landscape 1024×768+;
- the current policy that automated Playwright execution is paused.

Do not add rematch, room reset, alliances, Stealth, another sport, phone UI,
audio, bespoke replacement art, a new design system, or speculative performance
optimization.

## Work package 1 — Final Ceremony/results

Primary files:

- `src/components/setup/MatchGate.tsx`
- new `src/components/match/FinalCeremony.tsx` if extraction keeps
  `MatchGate.tsx` simpler;
- optional pure helper under `src/lib/presentation/`;
- `src/app/globals.css`.

Tasks:

- Extract the current inline results section when useful; do not refactor the
  rest of `MatchGate` without need.
- For v1's unique-Side FFA, map `winningSide` to an already-authorized Team and
  lead with that Team's name and color. Retain a defensive Side-number fallback
  for malformed/legacy data.
- Present a draw explicitly without implying a winner.
- Keep ceremony scores in canonical Team order; do not reinterpret, rerank, or
  recalculate authoritative scoring.
- Give every row non-color-only identity and a readable score. Use only fields
  already present in the participant projection and `ceremonyScores`.
- Provide an explicit **Return home** action. Keep **Return to room** only if its
  actual route is useful and cannot bounce the player confusingly back to the
  finished match; otherwise remove it.
- Preserve the private-replay explanation, but make it secondary to the result.

Acceptance:

- winner, draw, Teams, and scores are understandable in one glance;
- no result copy leads with `Side N` when the authorized winning Team is known;
- no hidden robot/order/contact information is introduced;
- no rematch or match-reset behavior is added.

## Work package 2 — match-flow context and navigation

Primary files:

- `src/components/setup/MatchGate.tsx`
- `src/components/match/RoomStatus.tsx`
- optional new `src/components/match/MatchFlowHeader.tsx`
- `src/app/globals.css`.

Tasks:

- Give waiting, turn-ready/movie, and finished views one compact hierarchy for:
  room or match identity, the player's Team, current turn/status, connection
  state, Field Guide access, and the next primary action.
- Reuse `RoomStatus`, Field Guide, and existing connection/recovery components;
  do not duplicate their semantics.
- Ensure safe secondary navigation is consistently named. Resign remains
  destructive and separately confirmed.
- Remove ambiguous dead ends, duplicate status copy, and links that immediately
  redirect back to the same finished state.

Acceptance:

- at every server phase, a player can answer where they are, whether their work
  is saved, who/what they are waiting for, and what to do next;
- connection status never relies on color and never claims Presence as
  authoritative;
- focus order follows the visual hierarchy.

## Work package 3 — authorized movie handoff

Primary files:

- `src/components/setup/MatchGate.tsx`
- `src/components/MovieExperience.tsx`
- `src/components/MovieControls.tsx` only for a demonstrated presentation bug;
- `src/app/globals.css`.

Tasks:

- Validate and polish the actual authenticated turn-ready layout, not only the
  standalone demo route.
- Keep the movie arena as the dominant element at 1280×720 and 1024×768.
- Place **Acknowledge Turn N and plan next** directly after the movie so it is
  not buried below Team Data/export/explanation content. Never auto-acknowledge.
- Keep Turn Explanation, Team Data, and observed export available below or in a
  compact accessible disclosure/layout without hiding required information.
- Make the current turn and the distinction between local playback and saved
  authoritative result clear in ordinary player language.
- Do not change movie ticks, speed behavior, idle compression, scrub semantics,
  playback persistence, or renderer events.

Acceptance:

- the player can watch/scrub and then find the continue action without hunting;
- explanations remain available and authorized;
- layout changes do not reduce the movie canvas below practical play-review
  size or introduce page-control collisions.

## Work package 4 — home and setup priority

Primary files:

- `src/components/setup/HomeSetup.tsx`
- `src/components/setup/RoomSetup.tsx`
- `src/components/setup/TeamRow.tsx`
- `src/app/globals.css`.

Tasks:

- At 1024×768 and 1280×720, keep Create/Join and required identity fields
  visible without decorative content pushing the usable game below the fold.
- Preserve recent-room status and make re-entry legible.
- Keep room code/invite copying, Team identity, Home corner, ready state, and
  host Start Match hierarchy obvious.
- Reduce, move, or collapse the Terrain Lab/demo/large hero preview only where
  it competes with these primary tasks. Do not turn the page into a marketing
  redesign.
- Preserve keyboard labels, 44×44 coarse-pointer targets, and non-color-only
  ready/connection/Team states.

Acceptance:

- a first-time player can create or join without scrolling past promotional
  content at supported viewports;
- host and guest primary actions are visually distinct and correctly disabled;
- all current setup capabilities remain present.

## Work package 5 — consistency pass

Use existing CSS variables, tokens, typography, buttons, status components,
team swatches, focus rings, and spacing. Align the four work packages rather
than inventing parallel patterns.

Required consistency checks:

- `Team`, `Turn`, `Room`, `Ready`, `Locked`, `Waiting`, and `Finished` wording;
- primary versus secondary versus destructive action hierarchy;
- visible focus and reduced-motion behavior;
- team identity always has a text/name cue in addition to color;
- no clickable element loses `cursor-pointer`.

## Tests and verification

Add focused tests proportional to extracted logic:

- pure winner-Team mapping: winning Team, draw, unknown/legacy Side fallback;
- static rendering: winner name/color/text cue, draw copy, canonical score rows,
  Home action, and absence of a rematch action;
- static rendering or pure view-model coverage for waiting/movie/finished
  headings and primary actions;
- regression assertions that presentation helpers consume only the authorized
  inputs explicitly passed to them.

Run:

```text
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Automated Playwright remains paused. Update retained specs/baselines only when
the markup/layout contract changed, and record the manual visual evidence in
Phase 12.2 rather than claiming it here.

## Definition of done

- All five work packages meet their acceptance bullets.
- No hard boundary was crossed.
- Automated verification is green.
- `docs/implementation-plan.md` marks Phase 12.1 implemented, not Phase 12.2.
- `docs/phase12-release-candidate.md` remains the unclaimed manual evidence
  record until real desktop/four-session/restart/iPad checks occur.
