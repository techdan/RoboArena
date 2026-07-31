/**
 * ⚠️  THROWAWAY SPIKE — NOT PRODUCTION CODE ⚠️
 *
 * Decision instrument for docs/graphics-plan.md. Rev 2, rebuilt around the
 * 2026-07-28 art feedback: the first pass generated *tiles in isolation*, which
 * is why gravel cropped into rectangles, bushes had hard circular edges, and
 * walls looked stamped and identical in every direction.
 *
 * Rev 2 composes STRUCTURES instead:
 *
 *   1. GROUND is baked once for the whole board from world-continuous noise, so
 *      no tile boundary exists in it at all. Rough ground is a smooth *field*
 *      (bilinear over the tile mask + noise perturbation), so dirt and debris
 *      spill across tile edges organically instead of filling squares.
 *   2. WALLS autotile on a 4-bit neighbour mask and are drawn FORM-first — top
 *      face, front face, edge highlights, jagged broken ends — with brick as
 *      incidental surface detail. A horizontal run shows a tall front face; a
 *      vertical run shows only its top until it terminates. That is where the
 *      original's directional read comes from.
 *   3. BUSHES are props, not tiles: irregular silhouettes with feathered alpha
 *      that overhang their square.
 *
 * Still deliberately breaks the plan's rules: no determinism contract, no
 * tests, no atlasing, desktop only. Delete with public/spike/ when done.
 *
 * Run: node scripts/spike/generate-demo-terrain.mjs
 */

import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Reads the REAL source-locked arena, not a hand-drawn test layout. This is the
 * step that makes the generator's output reusable: it consumes exactly the data
 * `src/lib/arenas/` already ships to the game.
 */
const ARENA_NAME = process.argv[2] ?? "rubble-two";
const ARENA = JSON.parse(
  readFileSync(join(ROOT, "src", "lib", "arenas", `${ARENA_NAME}.json`), "utf8"),
);
const OUT = join(ROOT, "public", "spike", "terrain", ARENA_NAME);

/** Bake resolution per tile. Display is 40, so there is 1.6× zoom headroom. */
const TILE_PX = 64;

/** o open · c concrete floor · r rough · W wall · l low-wall · b bush */
/**
 * ONE building of mixed height: full walls north and west, a low east side you
 * can see over, and a south side that runs full wall → doorway → low wall.
 * Structures autotile as a single connected thing (see `pieceAt`), so the
 * height change is a step in the same building rather than two separate
 * objects that refuse to join.
 */
/** Real arena terrain → generator legend. `outer-wall` renders as a full wall;
 *  `crevice` is not yet handled and falls back to open. */
const LEGEND = {
  open: "o",
  rough: "r",
  "low-wall": "l",
  wall: "W",
  bush: "b",
  "outer-wall": "W",
  crevice: "o",
};

/**
 * Recovered art-variant data (`tools/re/export_data.py` → `arena-variants.json`).
 * Splits open ground into outdoor grass and the indoor concrete slab exactly as
 * the original authored it — 84 floor tiles on Rubble Two, versus 87 from the
 * enclosure heuristic this replaces. Close, but this is the real thing.
 */
const VARIANTS = JSON.parse(
  readFileSync(join(ROOT, "docs", "extracted", "arena-variants.json"), "utf8"),
);
const RECOVERED =
  VARIANTS.arenas[`rubble/${ARENA.name}`] ??
  (() => {
    throw new Error(`No recovered variant data for ${ARENA.name}. Re-run export_data.py.`);
  })();
/**
 * The ground a tile is drawn over — grass or indoor slab — which is INDEPENDENT
 * of its terrain class. `open` and `rough` each ship an outdoor and an indoor
 * flavour (tilesets 3/14 and 3/11 respectively), so a rough tile inside a
 * compound is debris scattered on concrete, not on grass. Conflating base with
 * class is what left grass patches inside the buildings.
 */
const BASE = RECOVERED.base;
const CELLS = RECOVERED.cells;

/**
 * Which bush art the original authored for a tile.
 *
 * Rubble Two's bushes are all tileset 3: variant 9 is green foliage (28 tiles),
 * variants 10 and 11 are the blue boulder cluster (21 tiles). Cross-referencing
 * against the recovered floor map shows every variant-9 tile outdoors on grass
 * and every 10/11 tile indoors on the slab — so "foliage outside, rock pile
 * inside" was authored per tile, not implied by the surface. Read the variant
 * rather than inferring it.
 */
const BUSH_FOLIAGE_VARIANT = 9;
const isBoulderTile = (tx, ty) => CELLS[ty]?.[tx]?.variant !== BUSH_FOLIAGE_VARIANT;

/** Terrain class only. Base surface is tracked separately in `BASE`. */
const LAYOUT = ARENA.tiles.map((row) => row.map((tile) => LEGEND[tile.terrain] ?? "o").join(""));

const BOARD_W = LAYOUT[0].length;
const BOARD_H = LAYOUT.length;

const SUN = normalize3(-0.45, -0.62, 0.64);
const AMBIENT = 0.4;
const RELIEF = 2.4;

const at = (tx, ty) => LAYOUT[ty]?.[tx] ?? "o";
const isChar = (c) => (tx, ty) => at(tx, ty) === c;
const isRough = isChar("r");
const isBush = isChar("b");

/**
 * Structures are ONE kind with a height, not two kinds. Treating "wall" and
 * "low wall" as separate types is what made them refuse to connect: each
 * autotiled against its own type only, so a wall beside a low wall saw no
 * neighbour on that side and both terminated in a broken end. Height-as-a-
 * property lets a run continue across a change in elevation, which is how the
 * original reads as one building with a lower section.
 */
const heightOf = (tx, ty) => {
  const c = at(tx, ty);
  return c === "W" ? 2 : c === "l" ? 1 : 0;
};
const isStructure = (tx, ty) => heightOf(tx, ty) > 0;

/**
 * Indoor slab, straight from the recovered variant nibble — no heuristic.
 *
 * Bush tiles are recorded as "inherit": their sprite covers the ground, so the
 * surrounding surface runs underneath rather than the tile declaring its own.
 * A rock on a lawn otherwise gets a concrete square stamped under it.
 */
const isFloorTile = (tx, ty) => {
  const base = BASE[ty]?.[tx];
  if (base === "floor") return true;
  if (base !== "inherit") return false;
  // A prop's sprite covers its tile, so the surrounding surface runs
  // underneath. Orthogonal ground neighbours only — a wall's own base value is
  // meaningless, its tileset being chosen for masonry art — and a strict
  // majority, so a tie falls to grass.
  let floors = 0;
  let known = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = tx + dx;
    const ny = ty + dy;
    const neighbour = BASE[ny]?.[nx];
    if (neighbour === undefined || neighbour === "inherit") continue;
    if (isStructure(nx, ny)) continue;
    known += 1;
    if (neighbour === "floor") floors += 1;
  }
  return known > 0 && floors * 2 > known;
};

// ── noise ────────────────────────────────────────────────────────────────────

const hash2 = (x, y, seed) => {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const lerp = (a, b, t) => a + (b - a) * t;

/** Non-periodic value noise. The ground is baked as ONE image, so nothing has
 *  to tile — which is exactly what lets the result be seamless. */
const valueNoise = (x, y, seed) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};

const fbm = (x, y, octaves, seed) => {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
};

// ── colour ───────────────────────────────────────────────────────────────────

const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const step = (palette, t) =>
  palette[Math.max(0, Math.min(palette.length - 1, Math.floor(t * palette.length)))];

const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const GRASS = ["#33682f", "#3a7535", "#3f7d3a", "#458639", "#4a9040", "#4f9a45"].map(rgb);
const DIRT = ["#414c2e", "#4a5a35", "#546b3c", "#5c7a40", "#6d8146"].map(rgb);
const DEBRIS = ["#6b4a24", "#7c4f24", "#8a5f2e", "#a06a33", "#b07a3e", "#c08a4a"].map(rgb);
/** Poured slab inside compounds — cool grey against the warm grass, which is
 *  most of why the original's buildings read as enclosed spaces. */
const CONCRETE = ["#7f8580", "#8a908b", "#959b96", "#a0a6a1", "#aab0ab", "#b3b9b4"].map(rgb);
/**
 * Materials are split TOP vs SIDE, because a wall's two surfaces are not the
 * same thing seen at different brightness. The top is the cap: broad, flat,
 * catching full sun. The sides are the masonry: brick courses, always
 * horizontal, because that is how courses lie on a vertical face. Putting the
 * brick pattern on the top face is what made the previous pass read as a floor
 * tile rather than a wall.
 */
const BRICK_TOP = ["#b05a31", "#bb6236", "#c26a3a", "#c9723f"].map(rgb);
const BRICK_SIDE = ["#7a3d20", "#8a4526", "#9a4d2a", "#a5552e"].map(rgb);
const BRICK_MORTAR = rgb("#4e2413");
const BRICK_HI = rgb("#e8a473");
/** Distinct from brick but not bright — a pale cap on a single low tile embedded
 *  in a brick run reads as a hole rather than as a lower course. */
const STONE_TOP = ["#9a9384", "#a49d8d", "#aea798", "#b7b0a1"].map(rgb);
const STONE_SIDE = ["#7d7666", "#8a8272", "#948c7c", "#9e9686"].map(rgb);
const STONE_MORTAR = rgb("#4f4a3e");
const STONE_HI = rgb("#eae3d1");
const LEAF = ["#1d4319", "#245020", "#2b5c26", "#33682b", "#397330", "#458a38", "#4f9a42"].map(rgb);
/**
 * The indoor cover prop, read off the original's own tile art (RUBBLE.TWN DIB
 * 353, tileset 3 variants 10–11): a cluster of ROUNDED BLUE-GREY BOULDERS —
 * light cyan crowns, mid blue bodies, dark blue contact shadow. Not crystals
 * and not crates; the repo's `crate.svg` guessed "crystal cluster" from memory
 * and drew hard facets, but the pixels are unmistakably rounded stones.
 */
const BOULDER = ["#3c4147", "#4c5259", "#5d646c", "#70777f", "#848c94", "#9aa2a9", "#b3bac0"].map(
  rgb,
);

// ── buffers ──────────────────────────────────────────────────────────────────

const makeBuf = (w, h) => ({
  w,
  h,
  color: new Float32Array(w * h * 3),
  alpha: new Float32Array(w * h),
  height: new Float32Array(w * h),
});

const put = (buf, x, y, color, alpha, height) => {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const i = y * buf.w + x;
  const a = Math.max(0, Math.min(1, alpha));
  // Standard source-over so stamped props blend into what is already there.
  const inv = buf.alpha[i] * (1 - a);
  const outA = a + inv;
  if (outA <= 0) {
    buf.alpha[i] = 0;
    return;
  }
  for (let c = 0; c < 3; c += 1) {
    buf.color[i * 3 + c] = (color[c] * a + buf.color[i * 3 + c] * inv) / outA;
  }
  buf.height[i] = lerp(buf.height[i], height, a);
  buf.alpha[i] = outA;
};

/** Soft-edged ellipse stamp — the workhorse for debris and foliage. */
const stampEllipse = (buf, cx, cy, rx, ry, rot, color, height, feather = 1.5, alpha = 1) => {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const reach = Math.max(rx, ry) + feather + 1;
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y += 1) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const lx = (dx * cos + dy * sin) / rx;
      const ly = (-dx * sin + dy * cos) / ry;
      const d = Math.hypot(lx, ly);
      const edge = feather / Math.max(rx, ry);
      const a = 1 - smoothstep(1 - edge, 1, d);
      if (a > 0.002) put(buf, x, y, color, a * alpha, height);
    }
  }
};

// ── lighting + encoding ──────────────────────────────────────────────────────

function normalize3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

const litRgba = (buf) => {
  const { w, h, color, alpha, height } = buf;
  const flat = new Uint8ClampedArray(w * h * 4);
  const lit = new Uint8ClampedArray(w * h * 4);
  const normal = new Uint8ClampedArray(w * h * 4);
  // Height outside the silhouette reads as ground level, which is what gives
  // an alpha'd sprite a real lighting edge instead of a flat cutout.
  const hAt = (x, y) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : height[y * w + x] * alpha[y * w + x];

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const dx =
        hAt(x - 1, y - 1) + 2 * hAt(x - 1, y) + hAt(x - 1, y + 1) -
        (hAt(x + 1, y - 1) + 2 * hAt(x + 1, y) + hAt(x + 1, y + 1));
      const dy =
        hAt(x - 1, y - 1) + 2 * hAt(x, y - 1) + hAt(x + 1, y - 1) -
        (hAt(x - 1, y + 1) + 2 * hAt(x, y + 1) + hAt(x + 1, y + 1));
      const n = normalize3(dx * RELIEF, dy * RELIEF, 1);
      const diffuse = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
      const occ = 0.86 + height[i] * 0.14;
      const light = (AMBIENT + diffuse * (1 - AMBIENT)) * occ;
      const a = Math.round(alpha[i] * 255);
      for (let c = 0; c < 3; c += 1) {
        flat[i * 4 + c] = color[i * 3 + c];
        lit[i * 4 + c] = color[i * 3 + c] * light;
      }
      flat[i * 4 + 3] = a;
      lit[i * 4 + 3] = a;
      normal[i * 4] = (n[0] * 0.5 + 0.5) * 255;
      normal[i * 4 + 1] = (n[1] * 0.5 + 0.5) * 255;
      normal[i * 4 + 2] = (n[2] * 0.5 + 0.5) * 255;
      normal[i * 4 + 3] = a;
    }
  }
  return { flat, lit, normal };
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

const encodePng = (rgba, w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

let written = 0;
const emit = (name, buf) => {
  const { flat, lit, normal } = litRgba(buf);
  writeFileSync(join(OUT, `${name}-flat.png`), encodePng(flat, buf.w, buf.h));
  writeFileSync(join(OUT, `${name}-lit.png`), encodePng(lit, buf.w, buf.h));
  writeFileSync(join(OUT, `${name}-normal.png`), encodePng(normal, buf.w, buf.h));
  written += 3;
};

// ── 1. GROUND: one continuous bake for the whole board ───────────────────────

/** Bilinear over the tile mask gives a smooth field that already bleeds past
 *  tile edges; the noise perturbation then makes its boundary organic. That
 *  pairing is what stops rough ground reading as a rectangle. */
const fieldAt = (predicate, x, y) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const m = (tx, ty) => (predicate(tx, ty) ? 1 : 0);
  return (
    (m(x0, y0) * (1 - fx) + m(x0 + 1, y0) * fx) * (1 - fy) +
    (m(x0, y0 + 1) * (1 - fx) + m(x0 + 1, y0 + 1) * fx) * fy
  );
};

const roughnessAt = (u, v) => {
  const base = fieldAt(isRough, u - 0.5, v - 0.5);
  const warp = (fbm(u * 2.4, v * 2.4, 3, 601) - 0.5) * 0.62;
  return base + warp;
};

const isFloor = isFloorTile;

/**
 * Bilinear over an arbitrary per-tile weight.
 *
 * ROLLED BACK to this after three attempts to replace it with a directional
 * dilation. The dilation reasoning was sound in isolation and wrong in
 * practice: bilinear samples the 2x2 neighbourhood, so it handles inside
 * corners — where a wall tile touches floor only diagonally — for free, and
 * every hand-rolled dilation had to rediscover that case and then over-reach
 * fixing it, spilling concrete onto the lawn. One known artifact remains (see
 * `floorAt`); it is smaller than anything the replacements introduced.
 */
const weightedFieldAt = (weightFn, x, y) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  return (
    (weightFn(x0, y0) * (1 - fx) + weightFn(x0 + 1, y0) * fx) * (1 - fy) +
    (weightFn(x0, y0 + 1) * (1 - fx) + weightFn(x0 + 1, y0 + 1) * fx) * fy
  );
};

/** Diagonals included, or the inside corner of a compound falls just under the
 *  threshold and a green wedge shows where the slab should meet the wall. */
const touchesFloor = (tx, ty) => {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (isFloor(tx + dx, ty + dy)) return true;
    }
  }
  return false;
};

const slabTile = (tx, ty) => isFloor(tx, ty) || (isStructure(tx, ty) && touchesFloor(tx, ty));

/**
 * 1 inside the compound, and a partial weight on a bounding wall so the slab's
 * cut edge lands *under the wall ribbon* rather than beyond it.
 *
 * Where the 0.5 threshold falls is `0.5 / (1 - w) - 0.5` tiles past the shared
 * edge. At the old 0.55 that is 0.61 — past the ribbon's far side (0.32–0.68),
 * so the edge was only ever hidden by the wall's drawn bulk. A full wall has
 * enough of it; a LOW wall does not (shorter cap lift, shorter side face, and a
 * ruin-narrowed ribbon), which is why concrete leaked onto the grass at low
 * sections specifically. Pulling the weight down puts the edge mid-ribbon.
 */
const floorWeight = (tx, ty) => {
  // STRUCTURES ARE CHECKED FIRST, and never take the full weight.
  //
  // A wall's recovered base can legitimately be `floor` — an indoor wall is
  // drawn on the indoor tileset — but that describes its ART, not the ground
  // it occupies. Testing `isFloor` first gave those 8 tiles on Rubble Two a
  // weight of 1, flooding the whole tile with slab and spilling concrete out
  // onto the grass beyond the wall. A wall is always a slab *boundary*.
  if (isStructure(tx, ty)) {
    if (!slabTile(tx, ty)) return 0;
    return heightOf(tx, ty) === 1 ? 0.46 : 0.5;
  }
  return isFloor(tx, ty) ? 1 : 0;
};

/**
 * Gated to slab tiles so the field cannot bleed through a doorway as a rounded
 * bubble on the grass.
 *
 * KNOWN ARTIFACT, accepted: at the very end of a wall run the bilinear fill
 * covers the whole boundary tile, and the ribbon — narrowed to its centre block
 * and shifted by the oblique projection — no longer hides the slab's cut edge,
 * so a small wedge of concrete shows. Left alone deliberately. Every attempt to
 * remove it replaced one small local artifact with a class of larger ones
 * (missing corners, then concrete aprons around every wall).
 */
const floorAt = (u, v) => {
  if (!slabTile(Math.floor(u), Math.floor(v))) return 0;
  const base = weightedFieldAt(floorWeight, u - 0.5, v - 0.5);
  const warp = (fbm(u * 9, v * 9, 2, 811) - 0.5) * 0.03;
  return base + warp;
};

const bakeGround = () => {
  const w = BOARD_W * TILE_PX;
  const h = BOARD_H * TILE_PX;
  const buf = makeBuf(w, h);

  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const u = px / TILE_PX;
      const v = py / TILE_PX;
      // Four scales of grass. The lowest frequency is what keeps a large open
      // field from reading as one flat colour — without it the mid-mottle
      // alone averages out to uniform at any distance.
      const macro = fbm(u * 0.2, v * 0.2, 2, 7);
      const broad = fbm(u * 0.62, v * 0.62, 2, 11);
      const mottle = fbm(u * 3.1, v * 3.1, 3, 23);
      const grain = fbm(u * 17, v * 17, 2, 37);
      const g = macro * 0.28 + broad * 0.24 + mottle * 0.3 + grain * 0.18;

      const rough = roughnessAt(u, v);
      const dirtMix = smoothstep(0.34, 0.64, rough);
      const grassColor = step(GRASS, g);
      const dirtColor = step(DIRT, fbm(u * 8, v * 8, 3, 53) * 0.9 + grain * 0.2);
      let color = mix(grassColor, dirtColor, dirtMix);
      let height = 0.44 + grain * 0.06 + mottle * 0.05 - dirtMix * 0.06;

      // Concrete overrides whatever ground was underneath it.
      // Very narrow: a poured slab meets grass on a straight line. A wide
      // smoothstep over a bilinear field bends that line into a curve at every
      // corner, which is what made the earlier transition look melted.
      const floorMix = smoothstep(0.485, 0.515, floorAt(u, v));
      if (floorMix > 0.002) {
        const wear = fbm(u * 2.4, v * 2.4, 3, 83);
        const speck = fbm(u * 22, v * 22, 2, 71);
        let slab = step(CONCRETE, wear * 0.56 + speck * 0.44);
        // Slab joints on a one-tile grid — enough structure to read as poured
        // floor rather than flat grey.
        const ju = Math.abs((u % 1) - 0.5);
        const jv = Math.abs((v % 1) - 0.5);
        if (ju > 0.485 || jv > 0.485) slab = scale(slab, 0.88);
        color = mix(color, slab, floorMix);
        height = lerp(height, 0.47 + speck * 0.03, floorMix);
      }
      put(buf, px, py, color, 1, height);
    }
  }

  // Debris scattered in WORLD space — placement is not aware of tiles at all,
  // so chunks straddle boundaries and the patch keeps an organic outline.
  const gridStep = 0.34;
  for (let gy = -2; gy < BOARD_H / gridStep + 2; gy += 1) {
    for (let gx = -2; gx < BOARD_W / gridStep + 2; gx += 1) {
      const jx = hash2(gx, gy, 909);
      const jy = hash2(gx, gy, 919);
      const u = (gx + jx * 1.4) * gridStep;
      const v = (gy + jy * 1.4) * gridStep;
      const rough = roughnessAt(u, v);
      if (rough < 0.5) continue;
      // Thin out toward the edge of the patch so it fades rather than stops.
      const density = smoothstep(0.5, 0.78, rough);
      if (hash2(gx, gy, 929) > density) continue;
      const pick = hash2(gx, gy, 939);
      const size = TILE_PX * (0.045 + pick * 0.075);
      const rot = hash2(gx, gy, 949) * Math.PI;
      const facet = Math.floor(hash2(gx, gy, 959) * 4) / 4;
      const body = step(DEBRIS, 0.25 + facet * 0.6);
      const cx = u * TILE_PX;
      const cy = v * TILE_PX;
      // Contact shadow, chunk, then a lit top facet.
      stampEllipse(buf, cx + size * 0.22, cy + size * 0.3, size * 1.1, size * 0.8, rot,
        [12, 16, 10], 0.4, 2.2, 0.32);
      stampEllipse(buf, cx, cy, size, size * 0.78, rot, body, 0.66 + pick * 0.12, 1.1);
      stampEllipse(buf, cx - size * 0.2, cy - size * 0.22, size * 0.5, size * 0.36, rot,
        scale(body, 1.22), 0.74 + pick * 0.12, 1.0, 0.85);
    }
  }
  // Sparse rubble on the slabs. The original scatters debris across its floors,
  // and without it a compound interior is a dead grey rectangle.
  const floorStep = 0.62;
  for (let gy = -1; gy < BOARD_H / floorStep + 1; gy += 1) {
    for (let gx = -1; gx < BOARD_W / floorStep + 1; gx += 1) {
      const u = (gx + hash2(gx, gy, 1301) * 1.5) * floorStep;
      const v = (gy + hash2(gx, gy, 1303) * 1.5) * floorStep;
      if (floorAt(u, v) < 0.75) continue;
      if (hash2(gx, gy, 1307) > 0.5) continue;
      const pick = hash2(gx, gy, 1309);
      const size = TILE_PX * (0.028 + pick * 0.04);
      const rot = hash2(gx, gy, 1311) * Math.PI;
      const body = step(DEBRIS, 0.3 + Math.floor(hash2(gx, gy, 1313) * 4) * 0.18);
      const cx = u * TILE_PX;
      const cy = v * TILE_PX;
      stampEllipse(buf, cx + size * 0.2, cy + size * 0.28, size, size * 0.7, rot,
        [20, 24, 22], 0.42, 1.8, 0.28);
      stampEllipse(buf, cx, cy, size, size * 0.74, rot, body, 0.56 + pick * 0.1, 1.0);
    }
  }

  emit("ground", buf);
};

// ── 2. STRUCTURES: 4-bit autotiled walls, drawn form-first ───────────────────

const N = 1;
const E = 2;
const S = 4;
const W = 8;

/**
/**
 * Oblique (cavalier) projection. A structure of height h has its CAP drawn
 * offset from its base by h × (OBLIQUE_X right, OBLIQUE_Y up), and the volume
 * swept between base and cap is the visible side surface.
 *
 * This is the actual isometric read, and it is what previous revisions were
 * faking with axis-aligned strips. Because the sweep is diagonal, side faces
 * come out as parallelograms and every corner and wall end is MITRED for free —
 * the 90° edges were a symptom of extruding straight down instead of along a
 * projection vector.
 *
 * The base footprint stays axis-aligned to the tile, so occupancy is still
 * unambiguous; only the drawn cap is displaced.
 */
const OBLIQUE_X = 0.11;
const OBLIQUE_Y = 0.23;

/** Wall thickness as a fraction of the tile. Walls are RIBBONS, not filled
 *  squares — narrow caps with ground either side read as a building. */
const CAP_W = 0.36;

/**
 * Surviving heights for a ruined low wall, as a fraction of its full height.
 * Wide range deliberately kept — the fix for see-sawing is that a whole tile
 * holds one level and neighbours correlate, not that the range is narrowed.
 */
const RUIN_LEVELS = [0.28, 0.44, 0.62, 0.8, 1];

const pieceName = (kind, mask, lower, drop, ruin = 0) =>
  `${kind}-${mask}-${lower}-${drop}` + (kind === "low" ? `-h${ruin}` : "");

const bakeStructure = (kind, mask, lower, drop, ruin = 0) => {
  const stone = kind === "low";
  const T = TILE_PX;
  const myHeight = stone ? 1 : 2;
  const southHeight = Math.max(0, myHeight - drop);

  const hasN = (mask & N) !== 0;
  const hasE = (mask & E) !== 0;
  const hasS = (mask & S) !== 0;
  const hasW = (mask & W) !== 0;
  const lowN = (lower & N) !== 0;
  const lowW = (lower & W) !== 0;

  const offX = Math.round(myHeight * OBLIQUE_X * T);
  const offY = Math.round(myHeight * OBLIQUE_Y * T);
  const shadowPad = Math.round(0.08 * T);

  // Canvas holds the base footprint (the tile) plus the cap's up-right offset.
  const cw = T + offX;
  const ch = offY + T + shadowPad;
  const buf = makeBuf(cw, ch);
  // Base footprint pixel (fx,fy) → canvas (fx, fy + offY). Cap → (fx+offX, fy).
  const baseY = offY;

  const topPal = stone ? STONE_TOP : BRICK_TOP;
  const sidePal = stone ? STONE_SIDE : BRICK_SIDE;
  const mortar = stone ? STONE_MORTAR : BRICK_MORTAR;
  const hiColor = stone ? STONE_HI : BRICK_HI;
  const crown = stone ? 0.62 : 0.96;

  // ── plan footprint: centre block + an arm toward each connected neighbour ──
  const centre = T / 2;
  const half = (CAP_W / 2) * T;

  /**
   * Low walls get a broken silhouette — but STEPPED, not wavy.
   *
   * A smooth noise function on the half-width just produces a wobbly ribbon,
   * which is what the previous attempt looked like: flat, and nothing like
   * rubble. Real ruined masonry loses whole courses, so the profile has to move
   * in discrete blocks. Quantising both the position along the run and the
   * depth of the bite is what makes it read as broken brick.
   *
   * Flanks only — arm ends stay full width so pieces still meet their neighbours.
   */
  const BITE_LEVELS = [0.55, 0.72, 0.88, 1, 1];
  const flankHalf = (along) => {
    if (!stone) return half;
    const segment = Math.floor(along * 4);
    const pick = hash2(segment, mask, 1201);
    return half * BITE_LEVELS[Math.floor(pick * BITE_LEVELS.length)];
  };

  /**
   * A ruined LOW wall is PLATEAUS, not per-block noise.
   *
   * Full walls are deliberately excluded: they hold their height to the last
   * pixel and the adjoining low piece starts at its own, giving one clean
   * vertical drop. Generating a ramp, staircase, or footprint erosion at that
   * junction was tried and reverted — see the decision log in
   * docs/graphics-plan.md.
   *
   * Both previous attempts sampled a height per sub-tile segment. Independent
   * samples gave a comb; correlated samples gave a gentle wobble. Neither is
   * what a collapse looks like, because the structure is wrong at the root:
   * real ruins hold one height for a stretch, drop hard, hold the lower height
   * for a stretch, and climb back — the U shape. That is a *run-length*
   * property, so it cannot live inside a single tile's profile.
   *
   * So each low-wall tile is FLAT at one level, the level is part of the piece
   * identity, and the placement picks it from low-frequency noise over world
   * position. Neighbouring tiles land on the same or an adjacent level, which
   * produces multi-tile plateaus with abrupt breaks between them — wide range
   * preserved, sequential see-sawing gone.
   */
  const vertical = (hasN || hasS) && !hasE && !hasW;

  const liftScale = (fx, fy) => {
    const u = (fx + 0.5) / T;
    const v = (fy + 0.5) / T;
    const along = vertical ? v : u;

    if (stone) {
      // Plateau level for the whole tile (the coarse structure), plus a
      // LOW-VARIANCE jitter along the run so the top is jagged rather than a
      // flat slab. Two scales doing different jobs: the plateau supplies the
      // wide range and the U-shaped drops, the jitter supplies texture. Keyed
      // to the run axis only, so the jag runs along the wall's top edge instead
      // of speckling across its thickness.
      const block = Math.floor(along * 6);
      const jitter = (hash2(block, mask * 13 + ruin, 1811) - 0.5) * 0.2;
      return Math.max(0.16, RUIN_LEVELS[ruin] + jitter);
    }

    // Full walls keep their complete height through the last source pixel.
    // The adjoining low-wall piece begins at its own height, producing one
    // clean vertical drop rather than a generated ramp, staircase, or wedge.
    return 1;
  };

  // NOTE: an earlier revision bit chunks out of the footprint near a step edge
  // to sell the transition. It punched holes at corners and junctions — eroding
  // the PLAN shape damages the piece's connection to its neighbours. Reverted:
  // the transition is expressed in HEIGHT instead (see `liftScale`), which
  // cannot disconnect anything.
  const inFoot = (fx, fy) => {
    if (fx < 0 || fy < 0 || fx >= T || fy >= T) return false;
    const dx = Math.abs(fx + 0.5 - centre);
    const dy = Math.abs(fy + 0.5 - centre);
    const hx = flankHalf(fy / T);
    const hy = flankHalf(fx / T);
    if (dx <= hx && dy <= hy) return true;
    if (hasN && dx <= hy && fy < centre) return true;
    if (hasS && dx <= hy && fy > centre) return true;
    if (hasW && dy <= hx && fx < centre) return true;
    if (hasE && dy <= hx && fx > centre) return true;
    return false;
  };

  const colBottom = new Int32Array(T).fill(-1);
  const colTop = new Int32Array(T).fill(-1);
  const rowLeft = new Int32Array(T).fill(-1);
  for (let fy = 0; fy < T; fy += 1) {
    for (let fx = 0; fx < T; fx += 1) {
      if (!inFoot(fx, fy)) continue;
      if (colTop[fx] < 0) colTop[fx] = fy;
      colBottom[fx] = fy;
      if (rowLeft[fy] < 0) rowLeft[fy] = fx;
    }
  }

  /** Masonry for a side face. `run` is distance along the wall, `t` is the
   *  fraction of the way from base to cap, so courses stay parallel to the
   *  ground the way they do on a real vertical surface. */
  const sideTexel = (run, t, shade) => {
    const courses = stone ? 2 : 4;
    const cy = (1 - t) * courses;
    const row = Math.floor(cy);
    const fy = cy - row;
    const rx = (run / T) * 7 + (row % 2 === 0 ? 0 : 0.5);
    const col = Math.floor(rx);
    const fx = rx - col;
    const grain = fbm(run / T * 8, cy * 2, 2, 733);
    const joint = fy < 0.14 || fx < 0.06 || fx > 0.94;
    const base = joint
      ? mix(mortar, step(sidePal, grain * 0.4), 0.2)
      : step(sidePal, 0.28 + hash2(col, row, 991) * 0.44 + grain * 0.22);

    // Faces stay clean masonry. Making a broken end read as such was tried five
    // ways — footprint erosion, continuous ramp, quantised staircase, per-brick
    // damage, and a rubble-core material swap — and every one looked worse at
    // this size than the plain bond. Left clean deliberately; read the decision
    // log in docs/graphics-plan.md before attempting a sixth.
    return scale(base, shade);
  };

  /** Walks the projection vector from the base point up to the cap point. The
   *  vector shortens where a ruined column stands lower. */
  const sweep = (fx, fy, tFrom, run, shadeAt, scale_ = 1) => {
    const dx = offX * scale_;
    const dy = offY * scale_;
    const steps = Math.max(Math.max(dx, dy) * 2 + 2, 4);
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      if (t < tFrom) continue;
      const px = Math.round(fx + t * dx);
      const py = Math.round(fy + baseY - t * dy);
      put(buf, px, py, sideTexel(run, t, shadeAt(t)), 1, 0.24 - (1 - t) * 0.2);
    }
  };

  // ── contact shadow, cast down-left opposite the projection ──
  for (let fx = 0; fx < T; fx += 1) {
    if (colBottom[fx] < 0) continue;
    for (let k = 1; k <= shadowPad; k += 1) {
      const t = k / shadowPad;
      put(buf, fx - Math.round(t * 2), colBottom[fx] + baseY + k, [8, 14, 8], (1 - t) * 0.38, 0);
    }
  }

  // ── plinth: the footprint, opaque, at ground level ──
  //
  // Every face here is swept from a BOUNDARY pixel — `colBottom` per column,
  // `rowLeft` per row — which leaves the interior of the footprint relying on
  // the cap to cover it. The cap is displaced up and right by the projection, so
  // wherever a piece's own height or its neighbour's differs from what the face
  // sweeps assumed, a slice of bare ground can show between them. Chasing those
  // one at a time has cost several rounds; each fix was correct and each left
  // another seam somewhere else.
  //
  // Filling the plan footprint opaquely at ground level removes the whole class:
  // a structure's tile can never show the terrain beneath it, whatever the caps
  // and faces do above. Strictly inside the footprint, so it cannot spill onto a
  // neighbour or open a new seam.
  for (let fy = 0; fy < T; fy += 1) {
    for (let fx = 0; fx < T; fx += 1) {
      if (!inFoot(fx, fy)) continue;
      put(buf, fx, fy + baseY, sideTexel(fx, 0, 0.42), 1, 0.2);
    }
  }

  // ── risers: fill the whole solid where the cap height VARIES ──
  //
  // Sweeping only the boundary columns and rows assumes a flat cap: every
  // column then runs cleanly from its base to one common height. The moment
  // lift varies along a run — a ruined low wall, or a full wall stepping down
  // at a junction — adjacent treads sit at different heights with nothing
  // between them, and the piece renders as detached floating bands. The step
  // needs its riser: the vertical face joining a higher tread to its lower
  // neighbour.
  //
  // Sweeping every footprint pixel fills the solid exactly, which is what the
  // piece geometrically is; the cap then draws over everything still hidden.
  // Skipped for uniform pieces, where the boundary sweeps already suffice.
  if (stone) {
    for (let fy = 0; fy < T; fy += 1) {
      for (let fx = 0; fx < T; fx += 1) {
        if (!inFoot(fx, fy)) continue;
        const own = liftScale(fx, fy);
        sweep(fx, fy, 0, fx, (t) => 0.62 + t * 0.3, own);

        // THE RISER ITSELF. Sweeping each pixel only to its own height leaves a
        // wedge wherever the height jumps: the sweep traces a one-pixel diagonal
        // per source pixel, and neighbouring pixels normally offset by one pixel
        // so their union is solid — but at a step the offsets jump by several,
        // and the background shows through the gap.
        //
        // The face joining a tall tread to its shorter neighbour stands at the
        // SHORTER one's plan position and spans the two heights. Drawing it from
        // here, up to whichever neighbour behind us is taller, closes the wedge.
        // North and east are the ones that matter: south and west are the faces
        // this projection actually shows.
        for (const [nx, ny] of [
          [fx, fy - 1],
          [fx + 1, fy],
        ]) {
          if (!inFoot(nx, ny)) continue;
          const behind = liftScale(nx, ny);
          if (behind <= own) continue;
          sweep(fx, fy, own / behind, fx, (t) => 0.5 + t * 0.3, behind);
        }
      }
    }
  }

  // ── south faces, per column ──
  // Per COLUMN, not per piece. A corner tile's arm reaches the tile edge while
  // its elbow does not, so one piece can have both a connected column and an
  // exposed one. Treating exposure as a single flag for the whole piece is what
  // punched holes at the building's corners.
  for (let fx = 0; fx < T; fx += 1) {
    const bottom = colBottom[fx];
    if (bottom < 0) continue;
    const reachesEdge = bottom >= T - 1;
    if (reachesEdge && hasS && southHeight >= myHeight) continue;
    // Always sweep the FULL face, never just the part above the neighbour's
    // nominal top. Stopping at `southHeight / myHeight` assumed the piece to
    // the south stands at its full height — but low walls are ruined to
    // anywhere from 0.28 to 1.0 of theirs, and pieces are baked independently
    // so this one cannot know. The shortfall showed as a sliver of background
    // between the tall wall's face and the low wall's cap. Over-drawing is free:
    // painter order puts the southern piece on top of whatever it does occupy.
    sweep(fx, bottom, 0, fx, (t) => 0.5 + t * 0.34, liftScale(fx, bottom));
  }

  // ── west faces, per row ──
  for (let fy = 0; fy < T; fy += 1) {
    const left = rowLeft[fy];
    if (left < 0) continue;
    const reachesEdge = left <= 0;
    if (reachesEdge && hasW && !lowW) continue;
    // Full face, for the same reason as the south face: the western neighbour's
    // actual ruined height is unknowable from here, and the old `0.5` assumed it
    // stood at nominal. The shortfall showed as a vertical sliver of background
    // at the join. The sweep only ever moves right of the footprint edge, so
    // over-drawing cannot spill onto the neighbour's tile.
    sweep(left, fy, 0, fy, (t) => 0.66 + t * 0.4, liftScale(left, fy));
  }

  // ── cap, drawn last so it occludes the tops of the swept faces ──
  for (let fy = 0; fy < T; fy += 1) {
    for (let fx = 0; fx < T; fx += 1) {
      if (!inFoot(fx, fy)) continue;
      const u = (fx + 0.5) / T;
      const v = (fy + 0.5) / T;
      const mottle = fbm(u * 6, v * 6, 3, 467);
      let color = step(topPal, 0.34 + mottle * 0.52);
      const along = hasN || hasS ? v : u;
      if (Math.abs(((along * 3) % 1) - 0.5) > 0.47) color = scale(color, 0.95);
      // Far edge catches the sun where nothing taller adjoins to the north.
      const fromTop = fy - colTop[fx];
      if ((lowN || !hasN) && fromTop < T * 0.07) {
        color = mix(color, hiColor, (1 - fromTop / (T * 0.07)) * 0.85);
      }
      // Near edge lights where the cap turns down into the side face.
      const fromBottom = colBottom[fx] - fy;
      if (fromBottom < T * 0.05) {
        color = mix(color, hiColor, (1 - fromBottom / (T * 0.05)) * 0.45);
      }
      // Cap sits at this column's own elevation, so a ruined run steps.
      const ls = liftScale(fx, fy);
      put(
        buf,
        fx + Math.round(offX * ls),
        fy + Math.round(offY * (1 - ls)),
        color,
        1,
        crown * (0.55 + ls * 0.45) + mottle * 0.03,
      );
    }
  }

  // NOTE: loose rubble stamps at run ends and at height drops were tried here
  // and removed. At tile scale they read as small chunks stuck to the wall face
  // rather than as debris on the ground — the sprite has no room below its own
  // footprint for them to land in. If revisited, they belong in the GROUND bake
  // (which has the whole board to spill across) rather than on the piece.

  emit(pieceName(kind, mask, lower, drop, ruin), buf);
};

// ── 3. BUSHES: props with feathered, irregular silhouettes ───────────────────

/**
 * A bush is a UNION OF LEAF CLUSTERS, not a blob with a wobbly edge.
 *
 * The first pass built the silhouette from a radius function r(θ) and then
 * feathered ~5px of alpha over it. Two things were wrong. A radius function is
 * fundamentally a circle no matter how much noise it carries — real foliage's
 * lumpy outline is a *consequence* of its clumps. And feathering a colour that
 * darkened toward the rim smeared a muddy dark halo outward; leaf edges catch
 * light, they do not fade to black.
 *
 * So: overlapping domed clumps, silhouette = their union, alpha crisp (antialias
 * only), shading carried by the height field so each clump lights from up-left,
 * and a few detached sprigs to break the outline.
 */
const bakeBush = (variant) => {
  const size = Math.round(TILE_PX * 1.35);
  const buf = makeBuf(size, size);
  const seed = 700 + variant * 131;
  const cx = size / 2;
  const cy = size / 2;

  const clumps = [];
  const ring = 7 + Math.floor(hash2(variant, 0, seed) * 3);
  for (let i = 0; i < ring; i += 1) {
    const angle = (i / ring) * Math.PI * 2 + (hash2(i, variant, seed + 1) - 0.5) * 0.9;
    const dist = size * (0.09 + hash2(i, variant, seed + 2) * 0.1);
    clumps.push({
      cx: cx + Math.cos(angle) * dist,
      cy: cy + Math.sin(angle) * dist * 0.86,
      r: size * (0.1 + hash2(i, variant, seed + 3) * 0.06),
      tone: hash2(i, variant, seed + 4),
    });
  }
  clumps.push({ cx, cy: cy - size * 0.02, r: size * 0.16, tone: hash2(9, variant, seed + 5) });
  // Detached sprigs: small clumps just outside the mass, so the outline breaks
  // up the way foliage does instead of closing into one continuous curve.
  for (let i = 0; i < 4; i += 1) {
    const angle = hash2(i, variant, seed + 6) * Math.PI * 2;
    const dist = size * (0.2 + hash2(i, variant, seed + 7) * 0.09);
    clumps.push({
      cx: cx + Math.cos(angle) * dist,
      cy: cy + Math.sin(angle) * dist * 0.86,
      r: size * (0.045 + hash2(i, variant, seed + 8) * 0.03),
      tone: hash2(i, variant, seed + 9),
    });
  }

  // Ground shadow first, offset away from the sun.
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const dx = px + 0.5 - (cx + size * 0.06);
      const dy = (py + 0.5 - (cy + size * 0.13)) / 0.5;
      const d = Math.hypot(dx, dy);
      const a = (1 - smoothstep(size * 0.16, size * 0.29, d)) * 0.32;
      if (a > 0.004) put(buf, px, py, [10, 22, 12], a, 0.02);
    }
  }

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = px + 0.5;
      const y = py + 0.5;
      // Scalloped clump edges give leaf-scale detail on the silhouette.
      const scallop = 1 + (fbm(x / size * 11, y / size * 11, 2, seed + 11) - 0.5) * 0.22;
      let best = -1;
      let bestClump = null;
      for (const clump of clumps) {
        const d = Math.hypot(x - clump.cx, y - clump.cy) / (clump.r * scallop);
        const cover = 1 - d;
        if (cover > best) {
          best = cover;
          bestClump = clump;
        }
      }
      if (bestClump === null || best <= 0) continue;
      // Crisp: full alpha within ~1px of the union boundary. No dark halo.
      const a = smoothstep(0, 1.6 / bestClump.r, best);
      if (a <= 0.01) continue;

      // Hemisphere height per clump — the Sobel pass turns this into per-clump
      // dome shading lit from up-left, which is what reads as "bushy".
      const nx = (x - bestClump.cx) / bestClump.r;
      const ny = (y - bestClump.cy) / bestClump.r;
      const dome = Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx + ny * ny)));
      const grain = fbm((x / size) * 19, (y / size) * 19, 2, seed + 13);
      const t = 0.3 + dome * 0.34 + bestClump.tone * 0.2 + grain * 0.16;
      const color = step(LEAF, Math.max(0, Math.min(0.99, t)));
      put(buf, px, py, color, a, 0.45 + dome * 0.42 + grain * 0.04);
    }
  }
  emit(`bush-${variant}`, buf);
};

/**
 * The indoor cover prop: a cluster of rounded blue-grey boulders.
 *
 * Same engine terrain as a bush (visual cover, slows upright/ducking, stops
 * crouching); different ART VARIANT, which is exactly what the original's
 * `(tileset << 4) | variant` cell encoding allows. Foliage does not grow on a
 * concrete slab, so bushes indoors render as this instead.
 *
 * Built on the same clump-union machinery as the bushes — rounded stones and
 * leaf clusters are the same problem, only the palette and the dome profile
 * differ. Stones sit lower and wider, and carry a hard specular crown rather
 * than scattered leaf speckle.
 */
const bakeBoulder = (variant) => {
  const size = Math.round(TILE_PX * 1.3);
  const buf = makeBuf(size, size);
  const seed = 1500 + variant * 173;
  const cx = size / 2;
  const cy = size / 2;

  /**
   * Rocks have to read as COVER, not decoration, so they are big enough to hide
   * a chassis behind — and they come in genuinely different arrangements rather
   * than one silhouette recoloured. Equal-sized lumps in a ring read as a cloud;
   * the size hierarchy is what makes a pile read as stone.
   *
   *  0 — one large with small ones tucked beside it
   *  1 — three medium, roughly equal
   *  2 — one very large with a couple of chips
   *  3 — two medium plus scatter
   */
  const stones = [];
  const addStone = (ox, oy, r, tone, squash) =>
    stones.push({ cx: cx + ox, cy: cy + oy, r: size * r, tone, squash });
  const jitter = (i, salt) => (hash2(i, variant, seed + salt) - 0.5) * size * 0.09;
  const arrangement = variant % 4;

  if (arrangement === 0) {
    addStone(-size * 0.04, -size * 0.05, 0.27, 0.6, 0.84);
    addStone(size * 0.2, size * 0.11, 0.11, 0.42, 0.8);
    addStone(-size * 0.21, size * 0.14, 0.085, 0.36, 0.74);
    addStone(size * 0.13, -size * 0.19, 0.07, 0.5, 0.78);
  } else if (arrangement === 1) {
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + 0.6;
      addStone(
        Math.cos(angle) * size * 0.16 + jitter(i, 1),
        Math.sin(angle) * size * 0.12 + jitter(i, 2),
        0.155 + hash2(i, variant, seed + 3) * 0.03,
        0.4 + hash2(i, variant, seed + 4) * 0.32,
        0.76 + hash2(i, variant, seed + 5) * 0.16,
      );
    }
  } else if (arrangement === 2) {
    addStone(0, -size * 0.02, 0.32, 0.58, 0.86);
    addStone(size * 0.26, size * 0.16, 0.075, 0.38, 0.72);
    addStone(-size * 0.25, size * 0.12, 0.06, 0.34, 0.7);
  } else {
    addStone(-size * 0.12, -size * 0.03, 0.21, 0.62, 0.82);
    addStone(size * 0.15, size * 0.06, 0.175, 0.44, 0.8);
    addStone(size * 0.02, size * 0.22, 0.075, 0.36, 0.74);
    addStone(-size * 0.24, size * 0.16, 0.06, 0.4, 0.72);
  }

  // Contact shadow, cast away from the sun.
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const dx = px + 0.5 - (cx + size * 0.06);
      const dy = (py + 0.5 - (cy + size * 0.12)) / 0.48;
      const d = Math.hypot(dx, dy);
      const a = (1 - smoothstep(size * 0.15, size * 0.28, d)) * 0.36;
      if (a > 0.004) put(buf, px, py, [12, 20, 34], a, 0.02);
    }
  }

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = px + 0.5;
      const y = py + 0.5;
      let best = -1;
      let stone = null;
      let nx = 0;
      let ny = 0;
      for (const candidate of stones) {
        // Angular wobble on the radius: stone breaks along facets, so a true
        // circle reads as something soft and inflated.
        const ax = (x - candidate.cx) / candidate.r;
        const ay = (y - candidate.cy) / (candidate.r * candidate.squash);
        const angle = Math.atan2(ay, ax);
        const wobble = 1 + Math.sin(angle * 5 + variant) * 0.06 + Math.sin(angle * 3 - variant) * 0.05;
        const cover = wobble - Math.hypot(ax, ay);
        if (cover > best) {
          best = cover;
          stone = candidate;
          nx = ax;
          ny = ay;
        }
      }
      if (stone === null || best <= 0) continue;
      const a = smoothstep(0, 1.4 / stone.r, best);
      if (a <= 0.01) continue;

      const dome = Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx + ny * ny)));
      const grain = fbm((x / size) * 15, (y / size) * 15, 3, seed + 13);
      // Lit from up-left, with a hard terminator so it reads as rock rather
      // than a soft gradient ball.
      const facing = (-nx * 0.5 - ny * 0.62) * 0.55;
      const t = 0.12 + dome * 0.22 + facing + stone.tone * 0.35 + grain * 0.14;
      const color = step(BOULDER, Math.max(0, Math.min(0.99, t)));
      put(buf, px, py, color, a, 0.45 + dome * 0.4 + grain * 0.03);
    }
  }
  emit(`boulder-${variant}`, buf);
};

// ── run ──────────────────────────────────────────────────────────────────────

/** Adjacency and relative height for one structure tile. */
const pieceAt = (tx, ty) => {
  const h = heightOf(tx, ty);
  const nh = heightOf(tx, ty - 1);
  const eh = heightOf(tx + 1, ty);
  const sh = heightOf(tx, ty + 1);
  const wh = heightOf(tx - 1, ty);
  return {
    kind: h === 2 ? "wall" : "low",
    // Adjacency is to ANY structure, so a run survives a height change.
    mask: (nh > 0 ? N : 0) | (eh > 0 ? E : 0) | (sh > 0 ? S : 0) | (wh > 0 ? W : 0),
    lower: (nh < h ? N : 0) | (eh < h ? E : 0) | (sh < h ? S : 0) | (wh < h ? W : 0),
    drop: Math.max(0, h - sh),
  };
};

mkdirSync(OUT, { recursive: true });
bakeGround();
for (let variant = 0; variant < 4; variant += 1) bakeBush(variant);
for (let variant = 0; variant < 4; variant += 1) bakeBoulder(variant);

const placements = [];
const needed = new Map();
// The fully-enclosed flat piece is what the "autotiling off" toggle shows.
for (const kind of ["wall", "low"]) needed.set(pieceName(kind, 15, 0, 0), [kind, 15, 0, 0, 0]);

for (let ty = 0; ty < BOARD_H; ty += 1) {
  for (let tx = 0; tx < BOARD_W; tx += 1) {
    if (isStructure(tx, ty)) {
      const { kind, mask, lower, drop } = pieceAt(tx, ty);
      // Low-frequency noise over world position, so adjacent tiles land on the
      // same or an adjacent level and the run reads as plateaus with hard
      // breaks between them rather than alternating teeth.
      const ruin =
        kind === "low"
          ? Math.min(
              RUIN_LEVELS.length - 1,
              Math.floor(fbm(tx * 0.42, ty * 0.42, 2, 7717) * 1.25 * RUIN_LEVELS.length),
            )
          : 0;
      const piece = pieceName(kind, mask, lower, drop, ruin);
      needed.set(piece, [kind, mask, lower, drop, ruin]);
      placements.push({
        kind: "structure",
        tx,
        ty,
        piece,
        plain: pieceName(kind, 15, 0, 0),
        // How far the cap is displaced up the screen, in tile units. The
        // renderer offsets by this so the BASE lands on the tile.
        lift: (kind === "wall" ? 2 : 1) * OBLIQUE_Y,
      });
    } else if (isBush(tx, ty)) {
      // Same engine terrain, two art variants — and which one is AUTHORED per
      // tile in the original's variant nibble, so read it rather than guessing
      // from the surface underneath.
      const boulder = isBoulderTile(tx, ty);
      placements.push({
        kind: boulder ? "boulder" : "bush",
        tx,
        ty,
        variant: Math.floor(hash2(tx, ty, 8081) * 4),
        // Props drift off their square so nothing lines up on the grid.
        dx: (hash2(tx, ty, 8191) - 0.5) * 0.22,
        dy: (hash2(tx, ty, 8209) - 0.5) * 0.22,
      });
    }
  }
}

// Only the combinations this layout actually uses get baked — the full cross
// product of mask × lower × drop is far larger than any arena needs.
for (const [kind, mask, lower, drop, ruin] of needed.values())
  bakeStructure(kind, mask, lower, drop, ruin);

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify(
    {
      arena: ARENA_NAME,
      arenaLabel: ARENA.name,
      boardW: BOARD_W,
      boardH: BOARD_H,
      tilePx: TILE_PX,
      layout: LAYOUT,
      // Per-tile base surface, so the demo's hover readout can report it.
      base: BASE,
      placements,
    },
    null,
    1,
  ),
);
console.log(
  `${ARENA.name} (${BOARD_W}×${BOARD_H}): ${written} textures, ${needed.size} structure pieces, ${placements.length} placements → public/spike/terrain/${ARENA_NAME}/`,
);
