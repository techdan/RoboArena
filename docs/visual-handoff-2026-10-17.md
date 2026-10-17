# Visual-owner handoff — 2026-10-17

The functional audit deliberately leaves these items to the visual owner.
The user prioritizes a beautiful, awe-inspiring game. Cinematic retains full
fidelity by default; after optimization, the user allowed an explicit lower-detail
option for older machines. Keep gameplay mechanics and functional controls intact.

| Item                                                                          | Evidence / reproduction                                                                                                                                                   | Visual-owner follow-up                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strong glare on the left stands                                               | User-reported; Floodlit arena, especially the movie view. See `evidence/ui-audit-2026-10-17/movie-turn-1.png`.                                                            | Review floodlight/bloom balance and asymmetric glare while preserving the intended dramatic lighting.                                                                                 |
| Tiny timeline arrows surrounded by excess empty space                         | User-reported; short movement/direction actions in long proportional lanes. See `timeline-removal-1024.png` and `planner-turn-2-1024.png` in the same evidence directory. | Review glyph scale, density, spacing, and time-axis hierarchy without changing action duration or deletion semantics.                                                                 |
| Orders ring visually overlaps the camera controls near the upper-right corner | Observed at 1024×768, Blue Missile at tile 23,0, orders open. All orders and all eight heading choices passed hit-testing.                                                | Improve placement/composition; retain the working edge clamp and accessible close/back controls.                                                                                      |
| Very small squad and timeline secondary text at compact landscape sizes       | Observed at 1024×768. The squad rail now scrolls and controls remain reachable.                                                                                           | Review typography and information hierarchy across desktop and iPad sizes.                                                                                                            |
| Large stands/apron occupy substantial space in the top-down planner           | Observed on the 1968×1404 desktop view. See `heading-controls.png`.                                                                                                       | Review framing and the visual priority of the playable board versus stadium dressing.                                                                                                 |
| Animation/camera finish                                                       | Movement, projectiles, destruction, rehearsal, and movie advancement functioned. No animation-style changes were made by this audit.                                      | Review gait, idle motion, heading transitions, camera direction, effect timing, and visual continuity as an art pass. Treat this as a review item, not a confirmed functional defect. |

Functional guardrails: keep confirmation/footer controls out from under the
timeline; retain scrollable compact panels, visible heading controls, the portal
for timeline details, keyboard tile selection, ammo information, direct scan
weapon choice, explicit occupied-tile movement, graphics selection, and correct
wreck/health presentation. Preserve Cinematic fidelity. The optional presets
reduce internal image/AO resolution while retaining models, materials, lighting,
4x geometry antialiasing, 2048 shadows, bloom, and animation. Review preset image
quality as part of the visual pass without undoing the measured response gains.

No messages have been sent to another agent. This file is the handoff list.
