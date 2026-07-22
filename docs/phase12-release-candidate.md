# Phase 12.2 local release-candidate runbook

Phase 12.2 freezes the local WebSocket/SQLite game after Phase 12 resilience and
Phase 12.1 presentation polish, before Phase 12.5 changes the production
transport and storage. Automated Playwright execution remains disabled. Record
screenshots and observations manually; do not count browser emulation as the
physical-iPad gate.

## Automated preflight

Run from the repository root:

```text
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

All commands must pass on the exact commit being tested.

## Local services

In separate terminals:

```text
npm run dev:server
npm run dev -- --hostname 0.0.0.0
```

For a physical iPad, set `NEXT_PUBLIC_ROOM_WS_URL` to the development machine's
LAN WebSocket URL before starting Next.js. Keep the test network private; the
local service is not a production deployment.

## Four-session match and restart matrix

Use four separate browser profiles/private sessions. Give each player a unique
name, color, Side, and Home corner. Complete a Survival match and retain one
setup, planner, movie, and results screenshot.

- Lock in a staggered order and confirm no private draft or hidden contact is
  visible in another session.
- Disconnect and rejoin one player during setup, planning, waiting, and movie
  playback. Confirm the UI distinguishes retrying from resumed state.
- Resign one player while the others are waiting; confirm the resigner no
  longer gates resolution.
- Let players acknowledge the same movie at different times. Confirm each
  independently resumes at the correct unseen turn or planner.
- Export an observed turn and confirm it contains only authorized events.
- Confirm results and ceremony scores agree in every session.

Repeat the following with the room service stopped cleanly, then restarted
against the same SQLite file:

| Restart point | Required result |
| --- | --- |
| After setup | Same room, seats, names, colors, corners, and config resume. |
| After one or more locks | Locked orders remain immutable; one retry does not duplicate a lock. |
| Resolving/pending | The persisted seed, nonce, and combined orders resolve exactly once. |
| Resolved, before acknowledgement | Each player retains its own unseen turn and playback position. |

Retry the same start, lock, acknowledgement, and resume action after an
interrupted response. It must return the same canonical transition or an
equivalent fresh participant projection, never apply twice.

## Desktop visual and accessibility pass

Review the complete setup-to-results loop at 100% and 125% zoom at 1280×720 and
1440×900.

- Check planner overlays at all arena edges, the merged robot/timeline band,
  scan range preview, aim/scan labels, planner pan/zoom, and movie pan/zoom.
- Check grayscale and a color-vision simulation. Connection, readiness,
  selection, lock, damage, and results must remain understandable without color.
- Complete the loop with keyboard only. Focus must be visible and follow dialog
  open/close behavior without becoming trapped.
- Trigger the saved-data reset only in a disposable session. Confirm it removes
  RoboArena room tokens, match routing, and planner drafts but no unrelated
  origin storage.
- If the planner or movie recovery panel appears, recover from canonical room
  state and record the support id shown for any server-side internal failure.

## Physical iPad Safari pass

Use a physical iPad in landscape at a supported 1024×768 CSS-pixel viewport or
larger. Complete room creation/join through results using touch alone.

- Rotate to portrait and back; verify the rotate prompt and state recovery.
- Check safe-area insets and confirm no control is clipped.
- Pan and pinch-zoom the planner and movie without triggering page gestures.
- Open Field Guide/context help, use long-press details, program every action
  type, adjust scan range, lock, watch, scrub, change speed, reconnect, and view
  results.
- Confirm every gameplay target is at least 44×44 CSS px and nothing requires
  hover, right-click, or a keyboard modifier.
- Confirm acceptable planner/movie responsiveness and no low-resolution sprite
  substitution while zooming.

## Sign-off record

Do not mark Phase 12.2 complete until every row has evidence.

| Gate | Date/device | Evidence or defect | Result |
| --- | --- | --- | --- |
| Automated preflight | — | — | Open |
| Four local sessions | — | — | Open |
| SQLite restart matrix | — | — | Open |
| Desktop visual/accessibility | — | — | Open |
| Physical iPad Safari | — | — | Open |
