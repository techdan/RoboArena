# RoboArena graphics plan — from flat vector to lit, varied, and atmospheric

**Status**: ⬜ NOT STARTED — planning only. No tier is scheduled.
**Owning phase**: Phase 13 (post-v1 core-battle polish). See
`docs/implementation-plan.md` §Phase 13.
**Hard gate**: nothing in this document may be pulled into the Phase 12.2
release-candidate evidence pass or the Phase 12.5 deployment gate. Landing a
tier early invalidates in-flight visual review and churns regression baselines.

This is an iterative working document. Each tier is independently shippable and
independently revertible. Work a tier, record the result in the ledger at the
bottom, stop. Do not batch tiers.

---

## 1. Why this document exists

The prompt that started this was "make RoboArena's graphics amazing like
[Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty)". That project is a
Three.js/WebGL2 browser FPS, ~55k LOC, with every texture and mesh generated
procedurally at runtime: 19 PBR surfaces from periodic noise, cascaded shadow
maps, GTAO, TAA, tile-dilation motion blur, Karis bloom, volumetric fog,
parallax occlusion mapping, AgX tonemapping.

Two honest caveats set the direction of this plan:

1. **Its own benchmarks report 28–30 fps on Apple silicon at Retina, self-scored
   5.05/10 against real AAA.** It is an excellent technique demo, not a shipping
   AAA renderer. Copying its ambition wholesale would buy us its frame times,
   and our v1 device target is iPadOS Safari.
2. **Most of its stack solves 3D problems we do not have.** GTAO, cascaded
   shadows, TAA, parallax occlusion, and volumetrics answer questions a top-down
   2D tactical board never asks.

What genuinely transfers is the *method*: **generate surfaces procedurally
instead of authoring one image per type, then light them with a real model and
grade the result.** That method is fully available in PixiJS v8 and is where all
the visual delta lives.

---

## 2. Diagnosis — what actually makes the current renderer read as flat

Grounded in the shipped code, not in taste.

| Symptom | Root cause | Evidence |
|---|---|---|
| Ground reads as wallpaper | Exactly **one 24×24 SVG per terrain type**, stamped per tile. Every `open` tile in an arena is byte-identical. | `src/renderer/assets.ts:26`; `PixiArena.tsx:63-77` |
| No depth anywhere | Zero lighting. Tiles are `new Sprite(texture)` plus a position. No normal maps, no light direction, no AO, no cast shadows. | `PixiArena.tsx:71`; `MoviePlayer.tsx:300-306` |
| Hard grid seams | No edge-transition tiles. Grass meets rubble on an exact cell boundary. | `TERRAIN_ASSETS` is keyed by terrain alone — no neighbour awareness |
| Robots read as stickers | Lighting is *painted into* the sprite as vertical linear gradients (`fp-steel`, `fp-iron`, `fp-paint`). A turret facing north and one facing south are shaded identically. | `scripts/generate-robot-assets.mjs:39-67` |
| **Emissives don't emit** | The art already carries glow hooks — `#6ff2ff` sensor lenses, `#3ad9ee` glow plates, `#e0742f` missile indicators — but they are composited as ordinary flat fills, indistinguishable from paint. | `generate-robot-assets.mjs:296-297, 322-325, 371-375, 381-383` |
| Combat lacks punch | Effects composite flat — no additive blending, no bloom, no light emission, no camera response. | `src/renderer/effects/effects.ts` |
| No atmosphere | Flat `#151816` background, no vignette, no colour grade, no grain. | `PixiArena.tsx:34` |
| **Detail is invisible at play size** | Robots render at roughly 15–130 px depending on zoom (§4.5). The body texture is rasterized at 256 px. At default zoom most of that detail never reaches a pixel. | `RobotSprite.tsx:34,37`; `robotTextures.ts:25` |

**Core insight**: the gap is *variance and lighting*, not shader sophistication.
Human vision reads "cheap" primarily from repetition detection and from absent
shading cues. Per-tile variation plus one consistent light direction beats a PBR
pipeline running on tiled wallpaper, every time.

**Second core insight**: at the sizes robots actually occupy, **light, silhouette,
and motion are the only properties that survive.** Surface detail does not. This
is why the robot work below leads with emissives and rim light rather than
material authoring, and why a per-leg walk cycle was considered and **rejected** —
four legs across ~30 px is noise, and the existing hop rig already sells movement.

---

## 3. Non-goals

Locked, so no tier quietly grows into them:

- **No 3D and no Three.js.** The board stays top-down 2D.
- **No engine changes.** `src/engine/` is untouched by every tier.
- **No new runtime art dependencies.** Generation happens at build time via
  `scripts/`, output checked in, same as the Foundry Plate robot set. New
  *build-time* devDependencies (a Node rasterizer, an image encoder) are fine and
  expected — the constraint is on what ships to the browser.
- **No inherited constants.** Every existing rendering constant — tile sizes,
  zoom bounds, texture resolutions, oversample factors — was chosen against the
  constraints of the phase that introduced it. None of them are inputs to this
  plan. Each is re-derived from the target experience and re-validated against
  §4.2 performance. See §4.6.
- **No readability regressions.** If a lighting or post pass makes Side colour,
  posture, or damage state harder to read, the pass is wrong and gets reverted.
  Tactical clarity outranks atmosphere at every decision point.
- **No per-leg walk cycle.** Explicitly evaluated and dropped — see §2.
- **No audio.** Deferred per standing user direction.

---

## 4. Standing constraints every tier must satisfy

### 4.1 Determinism of appearance

Terrain variant selection, decal placement, and any other "random" visual choice
must be a **pure hash of `(arena identity, x, y)`** — never `Math.random()`,
never `Date.now()`.

Note that `Arena` (`src/engine/types.ts:331`) carries **no seed field**; seeds are
per-*turn* (`ReplayTurn.seed`). Hashing on the turn seed would be actively wrong —
the ground would resample every turn and visibly crawl between rounds. Hash on
`arena.sizeName` plus coordinates instead: arenas are a fixed source-locked
library, so that identity is stable across turns and identical for every player
by construction, with no engine change required.

Recommended primitive: a 32-bit FNV-1a or xorshift over
`hash(sizeName) ^ (x * 73856093) ^ (y * 19349663)`. Pure, fast, unit-testable.

### 4.2 iPad performance budget

v1 supports iPadOS Safari in landscape. The reference project manages 28–30 fps
on *desktop* Apple silicon. We therefore ship **quality tiers**, not a single
pipeline:

- **`low`** — Tier 1 only (varied albedo). Guaranteed path. Must hold 60 fps.
- **`medium`** — Tier 1 + Tier 2 lighting, no post stack.
- **`high`** — everything.

Default selection by device probe, with a manual override in settings. Movie
playback runs at `MOVIE_FPS_OPTIONS` (max 20 *simulation* frames/sec), so there
is headroom — but pinch-zoom and pan must stay smooth at 60 fps regardless.
**Every tier lands with a measured frame time on a physical iPad before it is
marked complete.**

### 4.3 Visual regression baselines

Playwright execution is currently paused (`CLAUDE.md` §Project state). Each tier
must state up front which baselines it invalidates and include regenerated
screenshots in its review.

### 4.4 Asset format — vector authoring, raster channel delivery

**Everything is raster at delivery. Everything stays vector at authoring.**
Vector-vs-raster was the wrong axis; authoring format vs delivery format is the
right one.

Generators continue to define art as geometry — that is what keeps the Foundry
Plate rig maintainable, reviewable, and parametric. They then **rasterize to
channels**, and channels are what the game loads. This is the real method
transfer from the reference project: its "19 procedural surfaces" are not 19
images, they are 19 *materials*, each a bundle of channels.

**Why robots are raster too.** An earlier revision of this plan kept robots
vector. That was wrong, for one decisive reason: **scene coherence**. Today the
whole scene is flat, so it is at least consistent. Textured, lit ground carrying
flat vector robots reads as stickers pasted onto a photograph — actively worse
than the current uniform flatness. Robots need the same surface treatment as the
ground: brushed-metal grain, paint wear, edge scuffing, dirt in the recesses.
That is per-pixel information and vector cannot express it.

The two arguments that had favoured vector both fail:

- *Runtime team recolour.* The paint-not-tint decision (2026-07-08,
  `robotTextures.ts:4`) correctly rejected a naive whole-sprite tint, which would
  multiply the grey steel. A **separate paint-mask channel** tints only masked
  pixels and was not on the table then. The current path is also expensive:
  `loadRobotTextures` rasterizes per distinct (class, team) pair, so a four-player
  melee can mean 40–80 runtime fetch→parse→decode→canvas→upload cycles at movie
  load — a real hitch on iPad. A baked atlas plus a mask replaces all of it.
- *On-demand resolution for the hero view.* Replaced by a board-res atlas plus a
  high-res set loaded per-robot only while the hero view is open. One robot at a
  time, so memory stays bounded.

**Robot channel layout** — 15 bodies (5 classes × 3 postures) + 5 turrets = 20
sprites:

| Channel | Carries |
|---|---|
| Albedo RGB | Team-neutral steel/iron/gun, with grain, wear, edge scuffing |
| Albedo A | **Paint mask** — which pixels take team colour |
| Normal RG | Geometry, for Tier 2 lighting |
| Packed B | **Emissive** — the `#6ff2ff` / `#3ad9ee` / `#e0742f` hooks Tier 4 needs |
| Packed A | Roughness |

Packs to **2 RGBA textures per sprite, 40 total**, atlas-able — against 80
runtime-rasterized textures today. Team recolour becomes a shader multiply, so
all four palettes are free.

**What raster costs us, honestly.** The one real loss is source-lockable text
assets: `assets.test.ts` greps SVG source to prove exactly one shadow ellipse
exists per body (`assets.ts:100`), and that does not survive a PNG. Replace it by
testing generator *inputs* — noise parameters, palette, variant count, seam
continuity — plus a perceptual hash of the baked output. Two consolations:
`stripBakedShadow` becomes unnecessary (with raster you simply never bake the
shadow into the body, which is cleaner than regex-stripping it), and generators
may still emit their intermediate SVG as an inspectable build artifact even
though the game loads the raster.

Bundle size is immaterial at this scale, and "infinite vector crispness" was
never real: Pixi rasterizes SVG once at a fixed resolution anyway, and raster with
mipmaps minifies *better* at the Icon band.

**Budget**: terrain and robots ship as mipmapped WebP atlases, target under 1.5 MB
each on disk and under ~16 MB GPU-resident at the base band, with hero-resolution
robot textures loaded on demand and evicted on close.

### 4.5 The zoom band — the real size constraint

The board is not one size, and this is the constraint that shapes all robot work.

**Measured inputs.** v1 ships melee 24×24 and battle 32×32
(`constants.ts:104-108`). Movie tiles are 28 px (`RobotSprite.tsx:34`), planner
tiles 24 px (`ArenaCanvas.tsx`). Robot bodies draw at `tile × 1.15`. The planner's
base camera is **fit-width** (`fitTransform.ts`), so base scale is
`viewportWidth / contentWidth` — roughly 1.0–1.6× on real viewports. User zoom
then multiplies by 0.5–3.0 (`MoviePlayer.tsx:42-43`).

**Resulting robot size on screen: ≈ 15 px zoomed out to ≈ 130 px zoomed in — an
~8.5× range.** No single sprite treatment is right across that range.

**The design goal** (user direction, 2026-07-28): zooming in should deliver
escalating visual impact; zooming out must stay clean and legible for pure
strategy and planning. Seeing more board is a real product requirement — this is
an arena game and spatial context matters — so the answer is **not** to make
everything bigger. It is to make the representation *change* with zoom.

Three rules follow, and every robot/marker tier must honour them:

1. **Screen-space floors for readability elements.** Rim light thickness, glow
   radius, selection rings, last-known markers, and status pips are specified in
   **screen pixels**, not world pixels, with a minimum. Zooming out must not
   shrink them into nothing. (This is how map labels work; today everything is
   baked into one texture, so everything scales uniformly — that is the defect.)
2. **Detail appears rather than merely magnifying.** Zooming in should *reveal*
   lighting, damage, and material that were not drawn at all when zoomed out.
   That is what makes zoom feel rewarding instead of merely functional, and it is
   also what keeps the zoomed-out view uncluttered.
3. **Bands cross-fade, never pop.** Transitions blend across a range so a pinch
   gesture never snaps.

**LOD bands** (robot on-screen size, cross-faded at the boundaries):

| Band | Size | Reads as | Carries |
|---|---|---|---|
| **Icon** | < 24 px | Strategic token | Silhouette, Side fill, class glyph, facing wedge, alive/dead. Emissive reduced to a single screen-space dot. No surface detail. |
| **Standard** | 24–72 px | The game | Foundry Plate art, emissive + bloom, rim light, posture, shadow |
| **Detail** | > 72 px | Cinematic | Adds normal-mapped lighting, damage decals, scorch, smoke, material response |

These figures describe the board *as currently configured*. They are the starting
measurement, **not** the design target — see §4.6.

Additionally, the Icon band must be **art-directed on its own terms**, not defined
as "Standard minus detail". Zoomed out, the board should read as a dark tactical
surface with four colours of glowing pips, tracer lines snapping between them,
and explosion flashes punching at a minimum screen size — striking in its own
right, in the way Supreme Commander's strategic zoom is a designed view rather
than a fallback. Emissive points and motion are the two things that survive
arbitrary minification, and both are cheap.

### 4.6 Constants are derived, not inherited

`SVG_TEXTURE_RESOLUTION = 4`, `MOVIE_TILE_SIZE = 28`, the planner's
`TILE_SIZE = 24`, `MAX_ZOOM = 3`, and `RASTER_OVERSAMPLE = 2` were each chosen
against the constraints of the phase that introduced them. **None is an input to
this plan.** Each gets re-derived from the target experience and re-validated
against §4.2, and any tier may change any of them.

Two consequences worth stating up front:

**The zoom ceiling is no longer texture-bound.** `MAX_ZOOM = 3` was effectively
capped by how much resolution a single baked texture could carry. Because terrain
is composited into a `RenderTexture` regardless, that texture can be
**re-composited at higher resolution for the visible region only** when the
camera enters the Detail band. Memory stays bounded while zoom does not — a
simplified virtual-texture approach. The zoom range should therefore be set by
what feels good to play, then confirmed against frame time, rather than by a
texture budget. `SVG_TEXTURE_RESOLUTION` disappears entirely with raster terrain.

**Planner and movie tile sizes must reconcile.** The planner draws at 24 px and
the movie at 28 px — the same board at two sizes. That is an artifact, not a
decision. Pick one derivation and apply it to both.

---

## 5. The tiers

### Tier 0 — Shared channel-bake pipeline ⬜

**Goal**: build once, deliberately, the generation infrastructure that Tiers 1
and 4 both need — rather than having whichever ships first improvise it.

**Scope**:
- Node rasterizer devDependency (`@napi-rs/canvas` or `resvg`) so generators can
  draw their vector shape vocabulary into a pixel buffer.
- Noise library: fBm and Worley with **periodic wrapping**, plus the §4.1
  deterministic hash. Pure functions, fully unit-tested — this is the layer where
  a determinism bug would be most expensive to find later.
- Channel packing and mipmapped WebP atlas emission.
- Height → normal (Sobel) derivation, shared by terrain and robots.
- The §4.4 test strategy: generator-input tests plus perceptual hashing, standing
  in for the source-grep tests that raster output ends.

**Acceptance**: identical inputs produce byte-identical atlases across runs and
machines; seam continuity verified numerically (a wrapped tile's edge pixels match
its opposite edge); no game-visible change whatsoever.

**Note**: this tier ships no visual delta by design. It is the price of §4.4, and
naming it separately keeps Tiers 1 and 4 honestly scoped.

---

### Tier 1 — Procedural ground, structures, and props ⬜

**Goal**: kill the wallpaper effect. Highest visual delta per unit of effort in
this document.

> **Revised 2026-07-28** after the demo spike. The original scope — "6–8 tileable
> variants per terrain type, selected by hash" — is **too weak a model and has
> been replaced**. Per-tile variants fix *repetition* but cannot fix region
> shape, orientation, or structure: gravel still crops into rectangles, walls
> still look identical in every direction, and bushes are still circles on a
> grid. The spike demonstrated all three failures and then fixed them. What
> follows is the model that worked.

**Format**: raster, per §4.4, noise evaluated **per pixel** in Node.

**Three layers, not one.**

**(a) Ground — baked per arena, continuous.** Sample noise in **world
coordinates** across the whole board and bake it as one image per arena. No tile
boundary exists in it, so nothing can crop into a square. Region membership
(rough vs open) is a smooth **field** — bilinear over the tile mask, then
perturbed by noise — rather than a per-tile boolean, which is what gives dirt and
debris organic outlines that spill across tile edges. Debris is scattered in
world space and is free to straddle boundaries.

This is viable precisely because arenas are a fixed source-locked library
(Rubble Two, Rubble Three): each one's ground is a build-time artifact.

Use **four** noise octaves spanning very-low to high frequency. The spike's first
pass omitted the lowest band and a large open field averaged out to a flat
colour at any distance.

**Compound interiors are a poured slab, not grass.** Cool grey concrete against
warm grass is most of why the original's buildings read as enclosed spaces rather
than as walls standing on a lawn. Two rules the spike had to learn:

- **The slab runs *under* the walls.** Give bounding-wall tiles a partial weight
  (0.55) in the floor field so the 0.5 threshold lands mid-wall and the slab edge
  is hidden beneath the wall ribbon. Weight them zero and a strip of grass shows
  between floor and wall base, which reads as a building sitting on a lawn.
- **Gate the field to slab tiles.** Bilinear interpolation spreads radially, so
  an ungated field bleeds out through a doorway as a rounded bubble of concrete
  on the grass. Gating gives a straight tile-edge boundary at openings while the
  interpolation still runs inside. Include **diagonals** when deciding which wall
  tiles belong to the slab, or interior corners fall just under threshold and
  show a green wedge.

**✅ The floor was recovered, not invented (2026-07-28).** The original stores
each map cell as `(tileset << 4) | variant`
(`docs/reverse-engineering.md` §9): the high nibble picks the terrain class, the
low nibble picks the **art variant**. Indoor concrete is a *variant of open
ground*, authored per tile. Earlier extraction collapsed to the class and
discarded both nibbles.

It is not derivable after the fact — flood-filling Rubble Two for enclosed
regions finds **exactly zero**, because every structure is a ruin with openings.
An enclosure heuristic got 87 tiles against the true 84, which is close enough to
look plausible and wrong enough to matter.

`tools/re/export_data.py` now keeps the nibbles and writes a companion
`docs/extracted/arena-variants.json` with per-cell `{tileset, variant}` plus a
derived `base` grid.

**Base surface is a property of the TILESET, not of the terrain class.** This is
the part that is easy to get half-right: `open` splits across tilesets 3 (grass)
and 14 (slab), but so does `rough` — tileset 3 is debris on grass, tileset 11 is
the same debris on concrete. Splitting only `open` leaves rough tiles rendering
as grass inside the compounds, which reads as a lawn growing through the floor.
Track base and class as independent axes.

**⚠️ But `base` describes a tile's ART, not the ground it occupies.** Walls carry
a base too — an indoor wall is drawn on the indoor tileset, so its base is
`floor` — and that says nothing about whether the slab should cover its square.
Any code that asks "is this floor?" must ask "is this a structure?" **first**.
Getting that order wrong flooded 8 wall tiles with slab and spilled concrete onto
the grass beyond them; it was the last surviving artifact of the whole slab
effort and the hardest to see, because 8 tiles out of 576 look like a one-off
rendering glitch rather than a systematic rule violation.

Props are the mirror image: they declare base `inherit` because their sprite
covers the tile, so the surrounding surface must run underneath rather than the
tile asserting a surface of its own.

**The shipped arena JSON was deliberately left untouched.**
`src/lib/arenas/index.test.ts` pins a sha256 over `JSON.stringify(tiles)`; that
source lock is doing its job, and changing the canonical tile schema is a
separate gated decision. The companion file lets renderers consume variants
without disturbing it.

⚠️ **Open**: `docs/extracted/` is gitignored, so the recovered file is local
only. Production use needs a committed home for it — either a new checked-in
data file or a gated extension to the arena schema.

**(b) Structures — one kind with a height, autotiled, drawn form-first.**

**Walls and low walls are not two types.** They are one structure type with a
height property (open 0, low wall 1, wall 2). This is load-bearing: modelling
them as separate types makes each autotile against its own kind only, so a wall
beside a low wall sees no neighbour on that side and *both terminate in a broken
end*. They visibly refuse to join. Height-as-a-property lets a run continue
across an elevation change, which is how the original reads as one building with
a lower section.

Each piece is selected by three things:
- **`mask`** — 4-bit adjacency to *any* structure. Drives run continuity,
  corners, T-junctions, and where a run terminates in breakage.
- **`lower`** — 4-bit "that neighbour is shorter than me". Drives edge lighting,
  so a side facing something shorter catches sun or casts shadow.
- **`drop`** — how many levels the south neighbour sits below, which sizes the
  front face. Wall over open ground drops 2 and shows a tall face; wall over low
  wall drops 1 and shows a step; low wall over open ground drops 1.

Only the combinations a shipped arena actually uses get baked — the full cross
product is far larger than any board needs (the spike's board needs 12 pieces).

**Geometry: the base is pinned to the tile and the cap lifts upward.**

Each piece is a box standing *on* the ground. Its base occupies the tile; its top
face is drawn offset **up** the screen by the wall's height (~0.2 tile for a low
wall, ~0.46 for a full wall), and the vertical faces span the gap between them.
A low wall and a full wall therefore share the same ground line and differ only
in how far the cap is raised — which is the one thing that should encode height.

An intermediate revision of the spike built this backwards: it pinned the *top*
to the tile and hung the side face *below*, so the base moved with height and
nothing was anchored to the ground. Everything looked like it was floating, and
no amount of shading fixed it because the error was geometric. **Anchor the base,
lift the cap.**

Because the south face's bottom lands at `tileBottom − southLift`, it meets the
lifted cap of whatever stands to the south exactly — a full wall stepping down
onto a low wall joins with no seam and no gap, for free.

**Plan shape: walls are ribbons, not filled squares.** The footprint is a centre
block plus an arm toward each connected neighbour, all of width ~0.46 tile. Caps
are therefore narrow and ground shows either side of the wall. A full-tile cap
reads as a row of boxes; a ribbon reads as a building. The arm construction also
produces correct L-corners, T-junctions, straight runs, and stubs for free.

**Projection: oblique (cavalier), swept along a single vector.** A structure of
height `h` has its cap drawn offset from its base by `h × (0.11 right, 0.23 up)`
in tile units, and the volume **swept** between base and cap is the visible side
surface. Exactly two faces can ever show — **south and west** — and each is
suppressed where a neighbour occupies that side. A horizontal run therefore
shows a long south face; a vertical run shows a long west face.

Sweeping along a projection vector rather than extruding straight down is what
makes corners and wall ends come out **mitred for free**. Earlier revisions
approximated the side faces with axis-aligned strips, which produced 90° corners
that read as pasted-on rectangles; the mitre is not a detail added on top, it is
a consequence of using a real projection.

Crucially the **base footprint stays axis-aligned to the tile** — only the drawn
cap is displaced. Occupancy is never ambiguous, so this buys the isometric read
without skewing the lattice, which would cost tactical readability.

Two rendering consequences: sprite canvases are both wider and taller than a
tile, so they scale uniformly by `TILE / tilePx` rather than being forced into
the square; and **face exposure must be computed per column and per row, not per
piece**. A corner piece has one arm reaching the tile edge (connected) and an
elbow that does not (exposed) — treating exposure as a single per-piece flag
punches holes at every building corner.

**Surfaces: cap and sides are different materials, not one at two brightnesses.**
The cap is a flat bright ribbon carrying almost no pattern — a little tonal drift
and one faint joint. The **brick lives on the vertical faces**, in horizontal
courses, because that is how courses lie on a vertical surface. Patterning the
cap makes a wall read as a floor tile.

Two supporting details, each individually necessary:
- **A contact shadow at the base.** Correct geometry still reads as hovering
  without one.
- **Painter's order (sort by row).** Lifted caps reach into the row above, so a
  southern piece must draw over a northern one.

Three further rules the spike proved matter:
- **Courses follow the run direction.** This is the entire source of the
  original's vertical-vs-horizontal read; it is not coded separately.
- **Breakage marks where the STRUCTURE run ends**, not where its height or
  material changes. A wall meeting a low wall is a step, not an end.
- **Damage only at run ends, never along the length**, or it punches holes
  through intact walls.

Palette stays keyed to height, so the low sections remain clearly distinguishable
from full walls — clearer than the original, deliberately.

**(c) Props — bushes and scatter, off the grid.** Deterministic sub-tile offset
so nothing lines up, several variants, permission to overhang the square. The
engine still treats the tile as bush; only the drawing escapes it.

**One terrain class carries several art variants, authored per tile.** The engine
has a single `bush` — visual cover, slows upright/ducking, stops crouching. On
Rubble Two the original uses three sprites for it, all in tileset 3: **variant 9
is green foliage (28 tiles); variants 10 and 11 are a cluster of rounded
blue-grey boulders (21 tiles)**.

Cross-referencing against the recovered floor map shows every variant-9 tile
outdoors on grass and every 10/11 tile indoors on the slab. So "foliage outside,
rock pile inside" is real — but it is **authored, not implied**. Read the variant
rather than deriving it from the surface underneath; the derivation happens to
agree here and there is no reason to assume it will on every map.

**What the blue prop actually is.** Decoding the DIB tile art
(`RUBBLE.TWN` → DIB 353, tileset 3 variants 10–11) settles it: a cluster of
**rounded boulders** with light cyan crowns and dark blue contact shadow. Not
crystals and not crates. The repo's `public/assets/terrain/crate.svg` guessed
"blue faceted crystal cluster" and drew hard facets; the pixels are unmistakably
rounded stones. Boulders also sidestep the problem that crates and crystals both
have — reading as an out-of-place game trope with a robot standing on them —
since rubble is exactly what a Rubble arena should be full of.

Tile art extracts as standard BMPs (BITMAPFILEHEADER first), 16×256 sheets of
sixteen 16×16 variants; `tools/re/dib_dump.py` assumes a bare
BITMAPINFOHEADER and fails on them.

**Foliage is a union of leaf clusters, not a blob with a wobbly edge.** A radius
function `r(θ)` is fundamentally a circle however much noise it carries — real
foliage's lumpy outline is a *consequence* of its clumps. Build from 8–12
overlapping domed clumps plus a few detached sprigs, take the union as the
silhouette, and let the height field carry per-clump shading.

Alpha must be **crisp** (antialias only). The spike's first pass feathered ~5 px
over a colour that darkened toward the rim, which smeared a muddy dark halo
outward. Leaf edges catch light; they do not fade to black.

**Depends on**: Tier 0 for the rasterizer, noise library, channel packing, and
atlas emission.

**Ground storage — split by spatial frequency (resolved 2026-07-28).** The spike
bakes the whole ground at 96 px/tile, which for a 32×32 battle arena would be
3072² ≈ 37 MB GPU. Too much for iPad, and it grows with arena size. The fix is
to split into three bands, because each has different resolution needs:

| Band | Contents | Storage | Battle arena |
|---|---|---|---|
| **Macro** | Broad tone, region fields, dirt scars | Per-arena image at ~16 px/tile — low-frequency content does not need resolution | 512² ≈ 1 MB |
| **Scatter** | Debris, rocks, tufts | Shared sprite library + per-arena **placement list** (JSON, not pixels) | ~0.3 MB, constant |
| **Micro** | Grain, surface texture | One **tiling** 256² texture; repetition is invisible because it is high-frequency and low-contrast | 0.25 MB, constant |

The only per-arena *pixel* data is the cheap macro layer, so memory is
essentially **constant regardless of arena size** — a 40×40 campaign arena costs
what a 16×16 skirmish does.

Composite those into a **viewport-sized** RenderTexture, never an arena-sized
one. That is what actually caps memory: the composite is bounded by screen
resolution, and §4.6's re-composite-on-zoom path serves the Detail band. ~37 MB
becomes ~10 MB and stops scaling with the board.

This is not a new pattern — the spike already stores structures and props this
way (shared piece library plus a placement manifest). The ground simply joins it.

**Regression checks worth writing as tests.** These are cheap, data-only
assertions over an arena plus its recovered variants, and each corresponds to a
defect that actually shipped in the spike:

1. **No structure tile takes full slab weight.** For every tile, `isStructure`
   implies `floorWeight < 1`. Catches the `base`-vs-structure ordering bug.
2. **No slab pixel lands on a tile that is neither floor nor a bounding
   structure.** Catches concrete spilling onto lawns.
3. **Every interior corner is covered.** For each floor tile, all eight
   neighbours that are structures resolve to non-zero slab weight. Catches the
   green-notch class.
4. **Prop tiles never assert a surface.** Every `inherit` tile's rendered ground
   equals that of its dominant ground neighbour. Catches isolated squares under
   rocks.

A rendered check is worth one more: **count connected grass regions fully
enclosed by concrete, and concrete regions fully enclosed by grass.** Both should
be zero on the shipped arenas. Nearly every slab defect in this effort would have
tripped that single assertion, and it needs no golden image.

**Acceptance**: a rough-ground region has no straight edges anywhere on its
boundary; a wall run reads as one structure with distinct vertical and horizontal
treatment and terminates in visible breakage; no two bushes share a silhouette
or sit on a grid line; identical arena produces a pixel-identical board across
reloads and browsers; 60 fps during pan/zoom on the largest arena, desktop and
iPad; no shimmer at the Icon band; before/after screenshots.

**Test-strategy change**: source-grep tests over SVG text do not survive raster
output. Cover generator inputs (noise parameters, palette, mask→geometry
mapping) plus a perceptual hash of the baked output. Add an explicit
autotiling-coverage test: all 16 masks generate, and every mask used by a shipped
arena has a piece.

---

### Tier 2 — 2D deferred lighting ⬜

**Goal**: real, consistent light. Fixes the rotating-turret shading defect and
gives the board physical depth.

**Scope**:
- Generate **normal + roughness/height** channels alongside each Tier 1 albedo.
- Render terrain once into a `RenderTexture`, then one fullscreen light pass:
  a single committed sun direction plus ambient.
- Walls and low walls cast directional shadows onto adjacent floor.
- Transient point lights: muzzle flashes and explosions genuinely illuminate
  nearby robots and ground.
- Regenerate robot sprites with normal maps so turret rotation lights correctly.

**Acceptance**: a turret rotating a full circle shows the highlight tracking the
sun instead of staying pinned to the sprite; wall shadows agree with the single
declared light direction; `medium` tier holds iPad frame budget.

**Depends on**: Tier 1.

---

### Tier 3 — Post-processing and impact response ⬜

**Goal**: atmosphere and combat weight.

**Scope**:
- Pixi v8 `Filter` chain on the movie stage: threshold + downsample bloom,
  vignette, filmic tonemap and colour grade, subtle grain.
- Additive blending for muzzle flashes, tracers, and explosion cores.
- Impact response via `src/renderer/reactions.ts`: brief chromatic aberration and
  screen shake on `destroyed`, scaled by blast size.

**Acceptance**: `prefers-reduced-motion` fully suppresses shake and aberration;
bloom never washes out Side colours; bloom radius is screen-space bounded so it
does not balloon at high zoom (§4.5 rule 1); `high` tier only.

**Sequence after Tier 2** so the grade is tuned against lit output.

---

### Tier 4 — Robot emissive and rim light ⬜ ← **highest wow-per-effort on the bots**

**Goal**: robots stop reading as vector stickers and start reading as powered
machines. This is the single most impactful robot change available, and the art
direction already did the hard part.

**Why this one first.** Light is the only cue that survives the bottom of the
zoom band (§4.5). A 2 px glowing lens still reads as a glowing lens; a 2 px panel
line reads as noise. And the emissive hooks are *already authored* into every
turret — they are simply composited as flat paint today.

**Scope**:
- **Build the robot channel pipeline** (§4.4): extend
  `generate-robot-assets.mjs` to bake albedo + paint mask + normal + emissive +
  roughness into two packed RGBA atlases, replacing the 80 runtime SVG
  rasterizations with one decode. Authoring stays vector; delivery becomes raster.
- Route the existing emissive hooks into the **emissive channel**: `#6ff2ff`
  sensor lenses, `#3ad9ee` glow plates, `#e0742f` missile indicators
  (`generate-robot-assets.mjs:296-297, 322-325, 371-375, 381-383`). This is a
  layer split, not new art.
- Add per-pixel surface character to the albedo — brushed-metal grain, paint
  wear, edge scuffing, dirt in recesses — so robots stay coherent with Tier 1's
  textured ground rather than reading as stickers on it.
- Team recolour moves to a shader multiply against the paint mask.
- Additive bloom pass over the emissive channel only.
- **Side-colour rim light** on the hull silhouette — an aesthetic win and a
  readability win simultaneously, since it makes Side identification work at the
  Icon band where paint area is only a few pixels.
- Both emissive dot size and rim thickness follow the §4.5 screen-space floor, so
  they stay perceptible zoomed out and do not bloat zoomed in.

**Acceptance**: Side identification at minimum zoom is measurably faster or no
worse than today, verified against **all four palettes** in
`robotTextures.ts:33-38` — rim light and bloom both add brightness near Side
colour and must sharpen rather than blow out the paint. Emissives remain visible
at the Icon band. No frame-time regression at `medium`.

**Note**: pairs naturally with Tier 3's bloom pass — if Tier 3 has landed, Tier 4
routes through the same pipe rather than adding a second one.

---

### Tier 5 — Semantic zoom and LOD ⬜

**Goal**: make zoom the visual-impact dial the game deserves — escalating detail
zoomed in, clean strategic legibility zoomed out.

**Scope**:
- Implement the §4.5 band system with cross-faded transitions.
- **Icon band**: a simplified representation — strong Side fill, class glyph,
  facing wedge, single emissive dot. Drawn deliberately, not merely scaled down.
- **Standard band**: current art plus Tier 4.
- **Detail band**: switch on Tier 2 normal-mapped lighting, damage decals, and
  any material response, none of which are drawn below this band.
- Generalize screen-space sizing for all markers: selection ring, last-known-X,
  scan lock, status pips.

**Acceptance**: pinch-zooming through the full 0.5–3.0 range shows no pop and no
frame-time spike; the whole battle arena at minimum zoom is readable enough to
plan from; Detail-band content is genuinely absent (not just small) at Icon band,
confirmed by frame time dropping when zoomed out.

**Depends on**: Tier 4 for the Standard band; Tier 2 for the Detail band. Can
ship with Icon+Standard only and gain the Detail band later.

---

### Tier 6 — Hero view ⬜

**Goal**: give the Foundry Plate detailing a surface where it actually resolves,
without compromising board context.

The board and inspection are two different viewing problems, and today they share
one presentation optimised for neither. The board needs silhouette and glow;
inspection has no size constraint at all and currently shows the same ~30 px
sprite.

**Scope**: a 200–400 px rendered robot for the planner sidebar, robot selection,
and the Final Ceremony, running the full Detail-band treatment — lighting,
damage state, material response, idle turret sway.

**Why it matters**: this is likely the single best screenshot in the project, and
it satisfies "let me see the robot properly" without raising `MAX_ZOOM` or
shrinking how much arena is on screen.

**Depends on**: Tier 2 and Tier 4 for the treatment; independent of Tier 5.

---

### Tier 7 — Progressive damage ⬜

**Goal**: replace the binary intact/wreck state with damage that accumulates.

**Scope**: scorch marks, panel deformation, and smoke keyed to health loss.
Detail band only (§4.5) — at Icon band, damage stays a status pip.

**Acceptance**: damage state readable without the health bar at Standard band and
above.

**Depends on**: Tier 4.

---

## 6. Sequencing and effort

| Tier | Effort | Visual delta | Risk |
|---|---|---|---|
| 0 — shared channel-bake pipeline | M | None directly | Low. Pure infrastructure. |
| 1 — terrain variance | M | **Highest overall** | Low. Additive; revert is deleting assets. |
| 2 — 2D lighting | M | High | Medium. Custom shaders; iPad perf is the risk. |
| 3 — post stack | M | Medium | Medium. Readability regression is the risk. |
| 4 — robot material + emissive + rim | L | **Highest on bots** | Medium. Replaces the live texture path. |
| 5 — semantic zoom / LOD | L | High (interaction) | Medium. Touches every marker's sizing. |
| 6 — hero view | M | High (single surface) | Low. New surface, nothing to regress. |
| 7 — progressive damage | M | Medium | Low. |

**Tier 0 is implied by the §4.4 decision and should be named explicitly**: the
Node rasterizer devDependency, noise library, channel packing, atlas emission,
and mipmap generation are shared by Tiers 1 and 4. Whichever ships first pays for
it, so it is cleaner to build it once, deliberately, with its own tests.

Tier 2 drops from L to M because Tiers 0/1/4 now hand it normal and roughness
channels as a by-product; the lighting pass no longer has to invent them.

Tier 4 rises from M to L because it now owns the robot channel pipeline rather
than bolting an emissive layer onto the existing SVG path — but it also absorbs
work Tier 2 and Tier 7 would otherwise have had to do.

**Recommended order**: 0 → 1 → 4 → 2 → 5 → 3 → 6 → 7.

---

## 7. Progress ledger

Append one row per completed tier. Record what shipped, what it cost in frame
time, and what it broke.

| Date | Tier | Outcome | Frame time (desktop / iPad) | Baselines regenerated | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | No production tier landed yet. |

### Demo spike (2026-07-28) — throwaway, not a tier

Built to decide whether to fund this plan at all. Desktop only. **Not production
code and not a head start on Tier 0** — no determinism contract, no tests, no
atlasing, no LOD bands, no iPad budget, hardcoded 16×12 board.

- `scripts/spike/generate-demo-terrain.mjs` — reads the **real source-locked
  arena JSON** from `src/lib/arenas/` and bakes ground, autotiled structures, and
  props; dependency-free PNG encoder
- `public/spike/terrain/<arena>/` — generated output per arena
- `src/components/spike/GraphicsDemo.tsx`, `src/app/graphics-demo/page.tsx` —
  A/B bench with per-technique toggles and a zoom slider

**Delete all four paths once the decision is made.**

**Findings.**

1. Procedural variance plus baked lighting clears the bar. Side by side against
   the shipped SVG tiles, the wallpaper effect is the single most obvious defect
   — identical grass tufts on a perfect grid, identical crate pairs, identical
   bushes — and per-tile variants plus one sun direction removes it entirely.
2. Two seam bugs surfaced immediately and are worth carrying into Tier 0's
   tests: **an odd brick-row count breaks running bond at the vertical tile
   seam**, and **cell ids must be wrapped before hashing** or the half-brick
   straddling a seam gets different jitter on each side. Both are exactly the
   class of defect §4.1 determinism tests should catch.
3. Emissive glow must be small and bright, not large and dim — a wide glow
   desaturates the hull it sits on instead of reading as a lit lens. Likewise
   the Side rim must hug the silhouette (~1.06×); more scale turns it into a
   halo that washes out the paint it exists to reinforce.
4. **Rev 2 (same day), after art review of rev 1.** Three defects were called
   out — gravel cropping into rectangles, hard fake bush edges, and stamped
   walls that looked identical in every direction — all tracing to one cause:
   **rev 1 generated tiles in isolation; the original composes structures.**
   Rebuilding around continuous per-arena ground, 4-bit autotiled form-first
   walls, and off-grid props closed all three. The key realisation for walls is
   that the original reads as architecture because **form dominates pattern** —
   mine failed by being all surface pattern and no form. This is what drove the
   Tier 1 rewrite above.
5. **Rev 3 renders the real Rubble Two** (24×24, from `src/lib/arenas/`) rather
   than a hand-drawn layout — 26 structure pieces cover 214 placements. Two
   findings from real map data: the pieces generalise (irregular ruined
   structures autotile correctly with no new cases), and **8.4 MB for one arena
   at 64 px/tile confirms the §Tier-1 storage split is required, not optional**.
6. **Painter's order needs a within-row term.** The oblique cap is displaced up
   and to the *right*, so the viewer sits down-left and west is nearer. Sorting
   by row alone left the within-row order running west→east, which painted
   farther eastern pieces over nearer western ones — mixed-height junctions read
   as overlapping rectangles. Correct order is row ascending, then column
   **descending**.
7. **§4.5 rule 1 is confirmed empirically, not just predicted.** At 0.30× zoom
   the terrain still reads beautifully but the robots collapse into
   near-invisible grey specks and Side identity is lost completely, because
   every element scales uniformly with the world. Screen-space floors for
   emissive, rim, and markers are not a refinement — without them the Icon band
   is unusable. This is the strongest argument in the plan for Tier 5.

---

## 8. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-28 | No Three.js / no 3D | Reference project's stack solves 3D problems we don't have; would harm tactical readability |
| 2026-07-28 | Hash appearance on `arena.sizeName`, not turn seed | `Arena` has no seed; turn seed would make ground crawl between turns |
| 2026-07-28 | Per-leg walk cycle rejected | Four legs across ~30 px is noise; existing hop rig already sells movement |
| 2026-07-28 | Board size stays; zoom carries visual impact | Arena context is a product requirement — solved by LOD bands (§4.5), not by bigger tiles |
| 2026-07-28 | Tier 4 pulled ahead of Tier 2 | Cheap, self-contained, largest robot-facing delta; art hooks already authored |
| 2026-07-28 | ~~Terrain is raster; robots stay vector~~ **SUPERSEDED same day** | Optimised each asset class in isolation and missed scene coherence. See next row. |
| 2026-07-28 | **Vector authoring, raster channel delivery — for terrain *and* robots** | Scene coherence is decisive: textured lit ground carrying flat vector robots is worse than uniform flatness. Both recolour and hero-view resolution have better raster answers (paint-mask channel; on-demand hero set). §4.4 |
| 2026-07-28 | Team recolour moves to a paint-mask channel + shader multiply | The 2026-07-08 paint-not-tint decision correctly rejected a *whole-sprite* tint; a masked tint was not considered. Cuts 80 runtime rasterizations to one atlas decode. |
| 2026-07-28 | Source-grep asset tests replaced by generator-input tests + perceptual hash | Raster output cannot be grepped; this is the one genuine capability lost to raster |
| 2026-07-28 | **No inherited rendering constants** | Existing tile sizes, zoom bounds, and texture resolutions were phase-local choices; each is re-derived to maximize display impact and re-validated against the perf budget (§4.6) |
| 2026-07-28 | Zoom ceiling decoupled from texture budget | Terrain composites to a `RenderTexture` regardless, so it can re-composite at higher resolution for the visible region — bounded memory, unbounded zoom |
| 2026-07-28 | Icon band is art-directed, not degraded | Emissive points and motion survive arbitrary minification; the zoomed-out view is a designed aesthetic in its own right |
| 2026-07-28 | **Tier 1 is three layers, not per-tile variants** | Per-tile variants fix repetition but not region shape, orientation, or structure. Ground baked per arena from world-continuous noise; walls autotiled form-first; bushes as off-grid props. Proven in the spike. |
| 2026-07-28 | Walls are form-first, pattern-second | The original reads as architecture because top face / front face / edge lighting dominate; brick is incidental. Rev 1 inverted this and looked stamped. |
| 2026-07-28 | Structure breakage only at run ends | Damage applied along a run's length punches holes through intact walls; ends are where breakage reads as architecture. |
| 2026-07-28 | Region membership is a smooth field, not a per-tile boolean | Bilinear over the tile mask plus noise perturbation is what stops rough ground cropping into rectangles. |
| 2026-07-28 | **Walls and low walls are one structure type with a height property** | Modelling them as separate types makes each autotile against its own kind, so a wall beside a low wall sees no neighbour and both break off — they visibly refuse to join. Height-as-property makes a mixed-elevation building read as one object. |
| 2026-07-28 | Foliage is a union of clumps with crisp alpha | `r(θ)` is a circle however much noise it carries; and feathering a rim-darkened colour smears a dark halo. Leaf edges catch light. |
| 2026-07-28 | Ground storage splits macro / scatter / micro by frequency | Only the low-res macro layer is per-arena pixels; scatter and micro are shared libraries plus placement data, so memory is constant in arena size. Composite is viewport-sized, not arena-sized. |
| 2026-07-28 | ~~Side faces overflow *below* the footprint~~ **SUPERSEDED same day** | Pinned the top to the tile so the base moved with height — everything read as floating. Geometric error, not a shading one. |
| 2026-07-28 | **Structure base is pinned to the tile; the cap lifts upward** | Low and full walls share a ground line and differ only in cap lift, so height is the sole encoder of "tall". South faces then meet the neighbour's lifted cap exactly, for free. |
| 2026-07-28 | Brick on the vertical faces; caps stay flat | Courses lie horizontally on vertical surfaces. Patterning the cap makes a wall read as a floor tile. |
| 2026-07-28 | **Oblique projection: cap offset by height × (0.11 right, 0.23 up), side faces are the swept volume** | Sweeping along a projection vector mitres every corner and wall end automatically. Axis-aligned strips gave 90° corners that read as pasted-on rectangles. Base footprint stays tile-aligned, so the grid is never skewed. |
| 2026-07-28 | Face exposure is per column / per row, not per piece | A corner piece has one arm at the tile edge (connected) and an elbow that is not (exposed). A single per-piece flag punched holes at every building corner. |
| 2026-07-28 | **Compound interiors are concrete slab, not grass** | Cool grey against warm grass is most of what makes the original's buildings read as enclosed spaces. Requires a floor terrain type RoboArena lacks — a content decision, flagged not assumed. |
| 2026-07-28 | Slab runs under the walls; field is gated to slab tiles | Partial weight on bounding walls hides the slab edge beneath the wall ribbon; gating stops bilinear from bleeding a concrete bubble through doorways. Diagonals count, or interior corners show a green wedge. |
| 2026-07-28 | Low sections need ≥2 tiles and a muted palette | A single pale cap embedded in a brick run reads as a hole rather than as a lower course. |
| 2026-07-28 | **Variant data RECOVERED — `export_data.py` now emits `arena-variants.json`** | Cell byte is `(tileset << 4) \| variant`; the low nibble carries indoor-vs-outdoor surface and per-tile prop art. Heuristic got 84→87 tiles; the real data is exact. |
| 2026-07-28 | Shipped arena JSON left untouched | `index.test.ts` pins a sha256 over `JSON.stringify(tiles)`. The source lock is working; changing the canonical schema is a separate gated decision. Companion file instead. |
| 2026-07-28 | The blue prop is a **rounded boulder cluster**, not crystals or crates | Decoded from the original's own DIB tile art. Also avoids the "game-trope object under a robot" problem that crates and crystals share. `crate.svg`'s "crystal" description was a guess. |
| 2026-07-28 | Prop variant is authored per tile — read it, don't derive it | Variant 9 = foliage, 10/11 = boulders. Correlates perfectly with indoors/outdoors on Rubble Two, but that is the map author's choice, not a rule to infer. |
| 2026-07-28 | Ruined walls vary in **height**, not width | Stepping the flank width only makes the ribbon wobble while its top stays one flat plane — "narrow flat next to wide flat". A collapsed wall loses courses, so the per-column cap elevation is what must step. |
| 2026-07-28 | Base surface is per-TILESET, not per terrain class | `rough` has indoor (tileset 11) and outdoor (3) flavours just as `open` does. Splitting only `open` leaves grass growing through compound floors. 154 floor tiles on Rubble Two, not 84. |
| 2026-07-28 | Indoor prop is a **grey rock with smaller ones beside it** | Blue read as clouds; equal-sized lumps in a ring read as a cluster of puffs. The size hierarchy plus a hard lighting terminator is what makes it stone. |
| 2026-07-28 | Props are sized to read as **cover**, with several arrangements | One large + chips, three medium, one very large + chips, two medium + scatter. A single silhouette recoloured reads as decoration; cover has to look like something a chassis hides behind. |
| 2026-07-28 | ~~Non-floor tiles receive slab by directional dilation~~ **REVERTED to bilinear** | Bilinear samples the 2×2 neighbourhood, so it handles inside corners — where a wall touches floor only diagonally, 43 tiles on Rubble Two — for free. Every hand-rolled dilation had to rediscover that case and then over-reach fixing it, spilling concrete onto the lawn. Three rounds of larger machinery to re-derive a property the one-line approach had by construction. |
| 2026-07-28 | **A tile's recovered `base` describes its ART, not the ground it occupies** | This was the root cause of the last surviving slab artifact, and it is the trap most likely to recur. An *indoor* wall is drawn on the indoor tileset, so its `base` is legitimately `floor` — 8 such tiles on Rubble Two. `floorWeight` tested `isFloor` before `isStructure`, so those walls took weight 1, flooded their whole tile with slab, and spilled concrete past the wall onto the grass. **Always resolve structure-ness before surface-ness: a wall is a slab boundary regardless of what tileset its art came from.** |
| 2026-07-28 | Ruin profiles vary per PIECE, keyed by position | Seeding collapse off `mask` alone gives every tile sharing a mask an identical profile, so the board repeats one "tall, medium, drop" phrase down every wall. Bake several profiles; the placement picks one by position hash. |
| 2026-07-28 | Ruin height steps along the RUN axis | Keying off x left every column of a vertical ribbon at one elevation, so vertical low walls stayed perfectly flat while horizontal ones varied. |
| 2026-07-28 | ~~Ruin steps are correlated and shallow~~ **SUPERSEDED** | Narrowing the range traded a comb for a wobble. Both were per-segment sampling, which is the wrong structure. |
| 2026-07-28 | **A ruin is PLATEAUS: one level per tile, correlated across tiles** | Real collapse holds a height for a stretch, drops hard, holds, climbs back — a run-length property that cannot live inside one tile's profile. Level becomes part of the piece identity; the placement picks it from low-frequency noise over world position. Wide range kept; sequential see-sawing gone. |
| 2026-07-28 | ~~Caps crumble at height steps by eroding the footprint~~ **REVERTED** | Eroding the PLAN shape damages a piece's connection to its neighbours — it punched holes at corners and junctions, and did not read as a transition anyway. Never erode plan shape for a surface effect. |
| 2026-07-28 | **Ruin height = plateau (coarse) + low-variance jitter (fine)** | One scale cannot do both jobs. The per-tile plateau supplies the wide range and the U-shaped drops; a small jitter along the run supplies the jaggedness. Keying the jitter to the run axis only keeps the jag on the top edge instead of speckling across the wall's thickness. |
| 2026-07-28 | Step transitions are expressed in HEIGHT, not plan shape | A full wall ramps its cap down as it approaches a step onto something shorter. Height cannot disconnect a piece, so it has none of the failure modes footprint erosion had. |
| 2026-07-28 | Slab reaches into walls by **directional dilation**, not an interpolated field | Bilinear fills a bounding wall tile from every direction, so at a run END — where the ribbon narrows and the oblique offset shifts it aside — a wedge of concrete juts onto the grass. Dilating only from floor-facing edges leaves nothing to spill. This was the real cause of the artifact; an earlier tie-break fix addressed a different, real, but unrelated bug. |
| 2026-07-28 | Walls are ribbons (~0.46 tile), not filled squares | A full-tile cap reads as a row of boxes. Narrow caps with ground either side read as a building — and the centre-plus-arms footprint yields corners, T-junctions, and stubs for free. |
| 2026-07-28 | Rubble marks termini (≤1 connection), not "no neighbour on that side" | On a straight run both flanks lack neighbours; treating those as ends litters debris down the length of an intact wall. |
| 2026-07-28 | Contact shadow at every structure base | Correct geometry still reads as hovering without one. |
