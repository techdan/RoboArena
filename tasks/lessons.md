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
