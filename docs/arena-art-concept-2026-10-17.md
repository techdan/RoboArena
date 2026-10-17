# Arena art concept — 2026-10-17

Concept prototype for the in-arena 3D graphics upgrade, Floodlit Coliseum only,
opt-in with `?art=next` (e.g. `/movie/showcase?theme=coliseum&art=next`).
Nothing changes without the flag. Awaiting the owner's yes before building out
across themes and all 24 arenas.

Evidence: [comparison sheet](evidence/arena-art-concept-2026-10-17/arena-art-concept.jpg)
and per-view pairs in the same folder (close-up, low angle, overview, top-down, stands).

## What changed (all in `src/renderer3d/arenaArt.ts`)

| Element  | Before                               | Prototype                                                                                                      |
| -------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Floor    | Canvas colour map only               | Generated normal map + packed ORM map: bevelled plates, pitting, hairline cracks, wet low-roughness pools      |
| Walls    | Flat-colour Blender primitives       | Shared weathering hook: colour breakup, ground grime, roughness variation, micro-bump; one noise-texture fetch |
| Bush     | 9 faceted icospheres (~720 tris)     | 27 instanced alpha cards (54 tris), volumetric normals, mip-aware alpha so it survives the top-down view       |
| Lighting | Generic RoomEnvironment probe        | Night-stadium probe (sky, stand glow, four floodlight banks) so wet floor and metal reflect the lamps          |
| Beams    | Flat translucent cones (grey wedges) | Soft-edged volumetric shader, brightest at the lamp                                                            |

Foliage is hidden from GTAO's normal pass (`userData.noAO`), because that pass's
override material ignores `alphaTest`. The AO depth-reuse path from the
performance handoff would let foliage occlude correctly; it is not part of this
concept.

## Measurements (Intel Iris Xe, D3D11, 16-robot showcase, overview camera, 898×561 buffer)

GPU-synchronised frame time (advance + 1-pixel readback), 150 samples after 40
warm-up frames, alternating before/after order.

| Variant        | Draw calls | Triangles | Cinematic median, paired runs         |
| -------------- | ---------- | --------- | ------------------------------------- |
| main @ 20dbb64 | 1,076      | 2.14 M    | 42.4 / 48.6 / 49.9 ms                 |
| `?art=next`    | 1,065      | 2.11 M    | 42.0 / 49.6 / 53.8 ms (≈ +1.5 ms avg) |

The first prototype used procedural 3D noise in the shader and cost ≈ +6 ms;
replacing it with a 256² tileable noise texture brought the cost to ≈ +1.5 ms.
Machine-wide timing drifted between sessions (baseline 36 → 42–50 ms), so only
paired deltas are meaningful. Not yet measured: the two-player planner,
Balanced, physical iPad.

## Open questions for the owner

- Bushes are darker and more natural than the old vivid green blobs. Is that
  the right trade, or should cover stay louder for tactical readability?
- The overall floor is moodier, with a more visible plate grid. Keep it, or lift it?
