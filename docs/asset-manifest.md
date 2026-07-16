# Asset manifest — Foundry Plate production set

**Status:** shipped and integrated 2026-07-16. The movie renderer
(`src/renderer/`) consumes everything below; this doc is the contract for any
agent touching sprites, the planner UI, or renderer tuning.

Art direction is **"Foundry Plate"** (hard-surface steel mech), locked
2026-07-08. Team identity = chassis **paint**; class identity = **turret
silhouette + hull variant** (double-coded); the ground ring means **selection
only** — never team or class.

## Inventory

```
public/assets/
  robots/<class>/body-{upright,ducking,crouching}.svg   GENERATED — 15 files
  robots/<class>/turret.svg                              GENERATED — 5 files
  robots/art-directions/*.svg      reference composites from the pitch (keep)
  effects/  muzzle-flash, tracer-bullet, projectile-missile,
            projectile-grenade, explosion-small, explosion-large,
            blast-ring, smoke-puff, hit-spark, dust-miss, wreck   (hand-authored)
  markers/  selection-ring, last-known, scan-lock                 (hand-authored)
  terrain/  Phase 6 tile set + crate prop (see src/renderer/assets.ts)
```

Classes: `rifle`, `burst`, `auto`, `missile`, `stealth` (= engine
`RobotClass`). Postures: `upright`, `ducking`, `crouching` (= engine
`Posture`; spec.md §Postures).

**GENERATED files come from `node scripts/generate-robot-assets.mjs` — never
hand-edit them.** Posture geometry, hull variants, and turret art live in that
script; tune there and regenerate.

## Rig contract (robot sprites)

- **Body files** — viewBox `0 0 128 128`; layers `shadow → legs → body`; no
  turret, no team ring. Ground anchor (64,93), shadow line y=101. Each file
  stamps `data-turret-pivot="64 <y>"`: the turret mount for that posture —
  **42** upright, **50** ducking, **54** crouching (the hull drops as it
  hunkers). Mirrored in `ROBOT_SPRITE_GEOMETRY` (`src/renderer/assets.ts`).
- **Turret files** — viewBox `0 0 96 96`, drawn top-down pointing **N**, pivot
  at the exact center (48,48) so a Pixi sprite with `anchor 0.5` rotates
  correctly. The 1.18× small-size readability scale is **baked in**
  (`data-scale-baked`).
- **Team paint hooks** — recolorable hexes shared by every generated file:
  `#d8453a / #a3241f / #5f1213` (fp-paint gradient stops), `#c8362e` (accent),
  `#ff9d8c` (edge). `src/renderer/robotTextures.ts` string-replaces these per
  team and rasterizes to a cached canvas texture. Do NOT use Pixi `tint` for
  team color — it multiplies the steel greys too.
- **Wreck** — `effects/wreck.svg` is the class-agnostic destroyed state on the
  same 128 footprint; swap it in for the body and hide the turret.

## Directional convention

All directional art (turrets, muzzle flash, tracer, missile) points **N** at
rotation 0. Headings are E-based radians in `RobotSprite.tsx`
(`HEADING_RADIANS`), so sprite rotation = `HEADING_RADIANS[h] + π/2`, and
coordinate-derived rotation = `atan2(dy, dx) + π/2`.

## Event → asset map (implemented in `src/renderer/effects/effects.ts`)

| ResolutionEvent kind | Asset(s) | Treatment |
|---|---|---|
| `fired` | muzzle-flash | at shooter, rotated to target, ~2-frame flash |
| `projectile-launched` (bullet/burst) | tracer (procedural line, `#ffd24a`) | 0.28s fade |
| `projectile-launched` (missile) | projectile-missile | position tween from→to, rotated |
| `projectile-launched` (grenade) | projectile-grenade | tween + mid-flight scale swell (fake lob) |
| `projectile-impacted` (explosive) | explosion-large + blast-ring + smoke-puff | pop 0.3→1.25, ring 0.35→1.5 |
| `projectile-impacted` (other) | explosion-small | quick pop |
| `shot-missed` | dust-miss | pop-and-settle at target tile |
| `damaged` (direct) | hit-spark + explosion-small | spark flash over small burst |
| `damaged` (blast) | explosion-small | at victim |
| `destroyed` | explosion-large (+ wreck via RobotSprite) | big treatment per acceptance criteria |
| `scan-target-acquired` | scan-lock | reticle pulse 1.4→1.0 on target |
| `enemy-lost` / `last-known-marker` | last-known | ghost at last seen tile, 0.8s fade |
| `posture-changed` | body-`<posture>`.svg | texture swap + turret pivot drop |

## Renderer integration notes

- **Preload**: effect + marker textures are read synchronously via
  `Assets.get` inside the per-tick effect pass, so `MoviePlayer` awaits
  `EFFECT_ASSET_URLS` + `MARKER_ASSET_URLS` before ready. Add new effects to
  `EFFECT_ASSETS` or they will silently not render.
- **Robot textures** load through `loadRobotTextures()` (fetch → recolor →
  canvas rasterize → cache per file+team). Known palettes: red, blue, green,
  yellow; unknown team colors fall back to red paint.
- **Pitfall (cost us a debug session):** Pixi v8 decodes plain-URL SVGs with
  `createImageBitmap`; a single XML error (e.g. a raw `&` in a `<desc>`)
  fails the whole texture load and the movie renderer errors out. Keep SVG
  text XML-escaped; `data-*` metadata is fine.
- Tile size is 20px in the movie — sprites were designed to read at that
  size (that's what the baked 1.18× turret scale is for). The visual baseline
  is `tests/visual/movie.spec.ts-snapshots/`; any deliberate art change must
  regenerate it via Playwright `--update-snapshots` and be eyeballed.

## Not yet consumed (built, waiting for later phases)

- `markers/selection-ring.svg` — planner/room UI selection indicator
  (tint via `--team` CSS var or Pixi tint; it is a pure stroke so tint is safe).
- Persistent fog-of-war last-known markers (the movie shows only transient
  ghosts today) and `enemy-spotted` treatments.
- Crouch/2-frame hop movement rig: hop is transform-only per the art
  direction; a future pass can bob `body`+`turret` between move-steps.
