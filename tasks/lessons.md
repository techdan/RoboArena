# Lessons

Corrections from the user and the rules derived from them. Review at session
start when working on related areas.

## 2026-07-08 — Original's body color = TEAM, not class

**Correction:** I proposed (and initially built) team identity as a ground ring
because I believed the original encoded *class* in body color (red rifle, blue
auto, …), based on the per-class hues in the extracted sprite sheets
(`ROBOCOLR.PRS` chunks 1010–1013). The user supplied an in-game home-area
screenshot showing all four classes on one team wearing identical red: in-game,
**body color encodes team**, and **class reads from the turret/head gear
alone**. The sheet hues are palette variants the engine re-maps per team.

**Rules:**
- Resource-file art is not proof of in-game presentation. Palette-swapped
  sprites (16-color era especially) usually mean the stored hue is arbitrary.
  Prefer in-game captures for presentation questions; check
  `screenshots/` before theorizing from extracted assets.
- For RoboArena assets: team = chassis/plate paint (`.team-paint` hooks),
  class = turret silhouette (must stay distinct at 24 px tiles), ground ring =
  selection indicator only.
- `docs/reverse-engineering.md` §12b takeaway 4 records the corrected
  interpretation.

## 2026-10-17 — Arena art: legibility before mood

The Coliseum art concept (`?art=next`) went darker and moodier than the
shipped arena and added wet, glossy floor patches. The owner liked the new
shrubs but rejected the result as too dark, with distracting "sparkling
tiles": "priority is to see everything clearly."

**Rules:**
- Arena art upgrades must keep overall brightness at or above the current
  shipped look. Grit comes from surface detail (texture, weathering), never
  from lowering scene light. Compare mean luminance against the baseline
  capture before showing a concept.
- No glossy/wet floor or fine high-frequency normal detail that catches
  floodlights as specular sparkle; it reads as noise from the planner camera.
- Judge every arena change from the top-down planner view first; the
  cinematic angle comes second.
