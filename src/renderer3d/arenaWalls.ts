/** Art-upgrade walls (`?art=next`): weathered brick masonry and collapsed
 *  low-wall rubble, sized to the robots rather than the tile.
 *
 *  Full walls are plain blocks wearing a generated brick-and-mortar texture
 *  projected in world space, so courses run unbroken across joined pieces at
 *  real brick scale, weathered by soot streaks, stains and base grime from the
 *  shared noise texture; a capstone tops each block. A low wall is a heap of
 *  tumbled masonry on the wall line: a stepped stub of standing courses where
 *  it meets a standing wall, large broken wall chunks (each carrying its own
 *  bricks and mortar) over a rubble core, grading down to small fragments and
 *  dust on the floor. Presentation only: cover and line of sight are the
 *  engine's, unchanged. Every irregularity is hashed from tile coordinates, so
 *  each replay shows the identical arena.
 */

import * as THREE from "three";
import type { Arena, Terrain } from "../engine/types";
import { weatherMaterial, weatherNoise } from "./arenaArt";
import { hash01 } from "./kinematics";

/** Props were authored for robots at scale 1.15 on a 1-tile grid. */
const AUTHORED_ROBOT_SCALE = 1.15;
/** Tallest robot (missile titan) per unit of rig scale, in tiles. */
const TALLEST_ROBOT_PER_SCALE = 1.046;
const WALL_THICKNESS = 0.5;
const PILLAR_SIZE = 0.6;
const CAP_HEIGHT = 0.045;
const CAP_LIP = 0.025;
/** Brick course height and length at the authored robot size, in tiles. */
const COURSE = 0.084;
const BRICK = 0.25;
/** The brick texture spans 8 bricks by 16 courses, so repeats are far apart. */
const BRICKS_ACROSS = 8;
const COURSES_DOWN = 16;

const standing = (terrain: Terrain | undefined) => terrain === "wall" || terrain === "outer-wall";
const joinsWall = (terrain: Terrain | undefined) => standing(terrain) || terrain === "low-wall";

// ---------------------------------------------------------------------------
// Brick texture: albedo plus a matching height map, tiling in both directions.

interface BrickMaps {
  readonly albedo: THREE.CanvasTexture;
  readonly height: THREE.CanvasTexture;
}

const paintBricks = (): BrickMaps => {
  const brickPx = 128;
  const coursePx = Math.round((brickPx * COURSE) / BRICK);
  const width = brickPx * BRICKS_ACROSS;
  const height = coursePx * COURSES_DOWN;
  const colour = document.createElement("canvas");
  const relief = document.createElement("canvas");
  for (const canvas of [colour, relief]) {
    canvas.width = width;
    canvas.height = height;
  }
  const c = colour.getContext("2d");
  const h = relief.getContext("2d");
  if (c !== null && h !== null) {
    // Dirty, uneven mortar.
    c.fillStyle = "#5f5850";
    c.fillRect(0, 0, width, height);
    h.fillStyle = "#383838";
    h.fillRect(0, 0, width, height);
    for (let n = 0; n < 900; n += 1) {
      c.fillStyle = hash01("mortar", n) < 0.5 ? "rgba(30,24,20,0.25)" : "rgba(140,128,112,0.18)";
      c.fillRect(hash01("mortar-x", n) * width, hash01("mortar-y", n) * height, 3, 2);
    }
    const mortar = Math.max(2, Math.round(coursePx * 0.12));
    for (let row = 0; row < COURSES_DOWN; row += 1) {
      const offset = row % 2 === 0 ? 0 : brickPx / 2;
      for (let col = -1; col <= BRICKS_ACROSS; col += 1) {
        const index = ((col % BRICKS_ACROSS) + BRICKS_ACROSS) % BRICKS_ACROSS;
        const key = `${row},${index}`;
        const x = col * brickPx + offset + mortar / 2;
        const y = row * coursePx + mortar / 2;
        const w = brickPx - mortar;
        const bh = coursePx - mortar;
        // A few faces have spalled off: a recessed, darker broken surface.
        const spalled = hash01(key, 5) < 0.045;
        // Fired-clay variation: hue, value, scorched and pale bricks.
        const tone = hash01(key, 1);
        const scorched = hash01(key, 2) < 0.14;
        const pale = hash01(key, 3) < 0.07;
        const r = (spalled ? 70 : 104 + tone * 52) - (scorched ? 46 : 0) + (pale ? 26 : 0);
        const g = (spalled ? 34 : 40 + tone * 24) - (scorched ? 14 : 0) + (pale ? 26 : 0);
        const b = (spalled ? 28 : 30 + tone * 16) - (scorched ? 8 : 0) + (pale ? 20 : 0);
        c.fillStyle = `rgb(${r},${g},${b})`;
        // Worn, chipped corners.
        const chip = (salt: number) =>
          hash01(key, salt) < 0.45 ? 3 + hash01(key, salt + 1) * 9 : 0;
        const [a, bb, cc, d] = [chip(10), chip(12), chip(14), chip(16)];
        const path = new Path2D();
        path.moveTo(x + a, y);
        path.lineTo(x + w - bb, y);
        path.lineTo(x + w, y + bb);
        path.lineTo(x + w, y + bh - cc);
        path.lineTo(x + w - cc, y + bh);
        path.lineTo(x + d, y + bh);
        path.lineTo(x, y + bh - d);
        path.lineTo(x, y + a);
        path.closePath();
        c.fill(path);
        const face = spalled ? 110 : 200 + tone * 40;
        h.fillStyle = `rgb(${face},${face},${face})`;
        h.fill(path);
        // Pitting and grit.
        for (let n = 0; n < 34; n += 1) {
          const px = x + hash01(key, 100 + n) * w;
          const py = y + hash01(key, 200 + n) * bh;
          const size = 1 + hash01(key, 300 + n) * 3;
          const dark = hash01(key, 400 + n) < 0.65;
          c.fillStyle = dark ? "rgba(30,14,10,0.4)" : "rgba(210,165,135,0.16)";
          c.fillRect(px, py, size, size);
          h.fillStyle = dark ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.2)";
          h.fillRect(px, py, size, size);
        }
        // Hairline cracks across some bricks.
        if (hash01(key, 20) < 0.12) {
          c.strokeStyle = "rgba(20,10,8,0.55)";
          h.strokeStyle = "rgba(0,0,0,0.6)";
          for (const context of [c, h]) {
            context.lineWidth = 1.2;
            context.beginPath();
            let px = x + hash01(key, 21) * w;
            let py = y;
            context.moveTo(px, py);
            for (let n = 0; n < 4; n += 1) {
              px += (hash01(key, 22 + n) - 0.5) * 18;
              py += bh / 4;
              context.lineTo(px, py);
            }
            context.stroke();
          }
        }
      }
    }
  }
  const make = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  return { albedo: make(colour, true), height: make(relief, false) };
};

/**
 * Brick masonry material. `world` projects bricks in world space (walls and
 * stubs, continuous across pieces); `object` projects them in each instance's
 * own unrotated, scaled frame, so a tumbled chunk carries its bricks with it.
 * Weathering from the shared noise texture (soot streaks, stains, base grime)
 * breaks up the tiling; the finish is matte with weak reflections.
 */
const brickMaterial = (
  maps: BrickMaps,
  scale: number,
  mode: "world" | "object",
): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 });
  material.name = "ArtBrick";
  material.envMapIntensity = 0.35;
  const period = new THREE.Vector2(BRICK * BRICKS_ACROSS * scale, COURSE * COURSES_DOWN * scale);
  const noise = weatherNoise();
  const objectSpace = mode === "object";
  const instanceFrame = objectSpace
    ? `vec3 brickScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          brickPos = transformed * brickScale + instanceMatrix[3].xyz * 3.7;`
    : "brickNormal = mat3(instanceMatrix) * brickNormal;";
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uBrick"] = { value: maps.albedo };
    shader.uniforms["uBrickHeight"] = { value: maps.height };
    shader.uniforms["uBrickPeriod"] = { value: period };
    shader.uniforms["uBrickNoise"] = { value: noise };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBrickWorld;
        varying vec3 vBrickPos;
        varying vec3 vBrickNormal;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 brickWorld = vec4(transformed, 1.0);
        vec3 brickNormal = objectNormal;
        vec3 brickPos = transformed;
        #ifdef USE_INSTANCING
          brickWorld = instanceMatrix * brickWorld;
          ${instanceFrame}
        #endif
        vBrickWorld = (modelMatrix * brickWorld).xyz;
        vBrickPos = ${objectSpace ? "brickPos" : "vBrickWorld"};
        vBrickNormal = ${objectSpace ? "brickNormal" : "mat3(modelMatrix) * brickNormal"};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBrickWorld;
        varying vec3 vBrickPos;
        varying vec3 vBrickNormal;
        uniform sampler2D uBrick;
        uniform sampler2D uBrickHeight;
        uniform sampler2D uBrickNoise;
        uniform vec2 uBrickPeriod;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 brickAxis = abs(normalize(vBrickNormal));
        vec2 brickUv = (brickAxis.y > max(brickAxis.x, brickAxis.z)
          ? vBrickPos.xz
          : (brickAxis.x > brickAxis.z ? vBrickPos.zy : vBrickPos.xy)) / uBrickPeriod;
        vec3 brick = texture2D(uBrick, brickUv).rgb;
        float brickHeight = texture2D(uBrickHeight, brickUv).r;
        // Weathering in world space, independent of the brick tiling.
        vec2 weatherUv = (brickAxis.x > brickAxis.z ? vBrickWorld.zy : vBrickWorld.xy) * vec2(0.9, 0.35);
        vec4 weather = texture2D(uBrickNoise, weatherUv);
        float soot = smoothstep(0.55, 0.9, weather.b) * smoothstep(0.3, 0.7, weather.g);
        float stain = smoothstep(0.45, 0.8, texture2D(uBrickNoise, vBrickWorld.xz * 0.21 + weatherUv * 0.3).g);
        float grime = 1.0 - smoothstep(0.0, 0.3, vBrickWorld.y + (weather.r - 0.5) * 0.08);
        brick *= 1.0 - soot * 0.45;
        brick = mix(brick, brick * vec3(0.62, 0.58, 0.52), stain * 0.5);
        brick *= 1.0 - grime * 0.5;
        diffuseColor.rgb = brick;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (0.5 - brickHeight) * 0.1 + soot * 0.05, 0.82, 1.0);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          // Mortar joints, spalls and pitting as bump: surface gradient (Mikkelsen 2010).
          float bump = (brickHeight + weather.a * 0.25) * 0.014;
          vec3 sx = dFdx(-vViewPosition);
          vec3 sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal);
          vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec2 dh = vec2(dFdx(bump), dFdy(bump));
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`,
      );
  };
  material.customProgramCacheKey = () => `art-brick-${mode}`;
  return material;
};

// ---------------------------------------------------------------------------
// Standing walls: a brick body and a capstone per piece, as world-axis boxes.

interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** A thick bar along each run through the tile, or a pillar when alone. */
const wallBoxes = (arena: Arena, x: number, y: number): Box[] => {
  const at = (dx: number, dy: number) => arena.tiles[y + dy]?.[x + dx]?.terrain;
  const half = WALL_THICKNESS / 2;
  const boxes: Box[] = [];
  const left = joinsWall(at(-1, 0));
  const right = joinsWall(at(1, 0));
  const near = joinsWall(at(0, -1));
  const far = joinsWall(at(0, 1));
  if (left || right)
    boxes.push({
      x0: x + (left ? 0 : 0.5 - half),
      x1: x + (right ? 1 : 0.5 + half),
      z0: y + 0.5 - half,
      z1: y + 0.5 + half,
    });
  if (near || far)
    boxes.push({
      x0: x + 0.5 - half,
      x1: x + 0.5 + half,
      z0: y + (near ? 0 : 0.5 - half),
      z1: y + (far ? 1 : 0.5 + half),
    });
  if (boxes.length === 0) {
    const p = PILLAR_SIZE / 2;
    boxes.push({ x0: x + 0.5 - p, x1: x + 0.5 + p, z0: y + 0.5 - p, z1: y + 0.5 + p });
  }
  return boxes;
};

// ---------------------------------------------------------------------------
// Low walls: one heap of tumbled masonry per straight run of low-wall tiles.

interface Run {
  readonly alongX: boolean;
  /** Row (alongX) or column of the run. */
  readonly line: number;
  readonly start: number;
  /** Inclusive. */
  readonly end: number;
}

const lowWallRuns = (arena: Arena): Run[] => {
  const at = (x: number, y: number) => arena.tiles[y]?.[x]?.terrain;
  const alongX = (x: number, y: number) =>
    joinsWall(at(x - 1, y)) ||
    joinsWall(at(x + 1, y)) ||
    !(joinsWall(at(x, y - 1)) || joinsWall(at(x, y + 1)));
  const runs: Run[] = [];
  for (let y = 0; y < arena.height; y += 1)
    for (let x = 0; x < arena.width; x += 1) {
      if (at(x, y) !== "low-wall" || !alongX(x, y)) continue;
      if (at(x - 1, y) === "low-wall" && alongX(x - 1, y)) continue;
      let end = x;
      while (at(end + 1, y) === "low-wall" && alongX(end + 1, y)) end += 1;
      runs.push({ alongX: true, line: y, start: x, end });
    }
  for (let x = 0; x < arena.width; x += 1)
    for (let y = 0; y < arena.height; y += 1) {
      if (at(x, y) !== "low-wall" || alongX(x, y)) continue;
      if (at(x, y - 1) === "low-wall" && !alongX(x, y - 1)) continue;
      let end = y;
      while (at(x, end + 1) === "low-wall" && !alongX(x, end + 1)) end += 1;
      runs.push({ alongX: false, line: x, start: y, end });
    }
  return runs;
};

/** Smooth 1D value noise from the tile hash. */
const noise1 = (seed: string, t: number): number => {
  const i = Math.floor(t);
  const f = t - i;
  const smooth = f * f * (3 - 2 * f);
  return THREE.MathUtils.lerp(hash01(seed, i), hash01(seed, i + 1), smooth);
};

/** Low-wall heap crest along a run, in tiles: knee-to-waist cover. */
const heapHeight = (seed: string, s: number, wallTop: number): number =>
  wallTop * (0.33 + 0.08 * noise1(seed, s * 3.1) + 0.05 * (noise1(seed, s * 11 + 5) - 0.5));

/** Rubble core: a narrow, steep-sided ridge on the wall line, mostly buried
 *  under the chunks. Cross-section offsets and heights as fractions. */
const CORE_ACROSS = [-1, -0.55, 0, 0.55, 1] as const;
const CORE_LIFT = [0, 0.7, 1, 0.7, 0] as const;
const CORE_HALF_WIDTH = WALL_THICKNESS * 0.62;
/** The core reaches this share of the crest; chunks build the rest. */
const CORE_SHARE = 0.6;
/** Core surface height at `out` tiles from the wall line, per unit of crest. */
const coreSurface = (out: number): number => {
  const a = Math.min(1, Math.abs(out) / CORE_HALF_WIDTH);
  for (let k = 3; k < CORE_ACROSS.length; k += 1) {
    const a1 = CORE_ACROSS[k]!;
    if (a <= a1) {
      const a0 = CORE_ACROSS[k - 1]!;
      return (
        CORE_SHARE * THREE.MathUtils.lerp(CORE_LIFT[k - 1]!, CORE_LIFT[k]!, (a - a0) / (a1 - a0))
      );
    }
  }
  return 0;
};

const coreGeometry = (runs: readonly Run[], wallTop: number): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const run of runs) {
    const seed = `${run.alongX ? "x" : "z"}${run.line}:${run.start}`;
    const samples = (run.end + 1 - run.start) * 10;
    const base = positions.length / 3;
    for (let i = 0; i <= samples; i += 1) {
      const s = run.start + (i / samples) * (run.end + 1 - run.start);
      const h = heapHeight(seed, s, wallTop) * CORE_SHARE;
      CORE_ACROSS.forEach((a, k) => {
        const toe = k === 0 || k === CORE_ACROSS.length - 1;
        const offset = a * CORE_HALF_WIDTH + (hash01(seed, i * 5 + k) - 0.5) * (toe ? 0.1 : 0.06);
        const y = toe ? -0.005 : CORE_LIFT[k]! * h * (0.75 + hash01(seed, 600 + i * 5 + k) * 0.4);
        const c = run.line + 0.5 + offset;
        if (run.alongX) positions.push(s, y, c);
        else positions.push(c, y, s);
      });
    }
    const stride = CORE_ACROSS.length;
    for (let i = 0; i < samples; i += 1)
      for (let k = 0; k < stride - 1; k += 1) {
        const a = base + i * stride + k;
        const b = a + stride;
        // Wind so faces point outward for both run directions.
        if (run.alongX) indices.push(a, a + 1, b, b, a + 1, b + 1);
        else indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    // Close both ends (hidden by stubs or chunks).
    for (const [i, flip] of [
      [0, true],
      [samples, false],
    ] as const) {
      const row = base + i * stride;
      for (let k = 1; k < stride - 1; k += 1) {
        const tri = [row, row + k, row + k + 1];
        if (flip !== run.alongX) tri.reverse();
        indices.push(...tri);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

/** A broken masonry chunk: a box with displaced corners and faceted faces. */
const chunkGeometry = (): THREE.BufferGeometry => {
  const box = new THREE.BoxGeometry(1, 1, 1, 2, 1, 2);
  const position = box.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    // Displace by position so coincident corners move together (no cracks).
    const key = `${position.getX(i).toFixed(2)},${position.getY(i).toFixed(2)},${position.getZ(i).toFixed(2)}`;
    position.setXYZ(
      i,
      position.getX(i) * (0.8 + hash01(key, 1) * 0.35),
      position.getY(i) * (0.75 + hash01(key, 2) * 0.4),
      position.getZ(i) * (0.8 + hash01(key, 3) * 0.35),
    );
  }
  const faceted = box.toNonIndexed();
  box.dispose();
  faceted.computeVertexNormals();
  return faceted;
};

// ---------------------------------------------------------------------------

export interface ArtWalls {
  readonly group: THREE.Group;
  dispose(): void;
}

export const buildArtWalls = (
  arena: Arena,
  robotScale: number,
  options: { readonly lowWalls: boolean },
): ArtWalls => {
  const group = new THREE.Group();
  group.name = "art-walls";
  const disposables: { dispose(): void }[] = [];
  const relative = robotScale / AUTHORED_ROBOT_SCALE;
  const wallTop = TALLEST_ROBOT_PER_SCALE * robotScale * 1.12;
  const maps = paintBricks();
  const brick = brickMaterial(maps, relative, "world");
  disposables.push(maps.albedo, maps.height, brick);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0, 0.5, 0);
  disposables.push(unitBox);
  const instanced = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    matrices: readonly THREE.Matrix4[],
    name: string,
  ) => {
    if (matrices.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  };

  // Standing walls.
  const bodies: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  for (let y = 0; y < arena.height; y += 1)
    for (let x = 0; x < arena.width; x += 1) {
      if (arena.tiles[y]?.[x]?.terrain !== "wall") continue;
      const key = `${x},${y}`;
      const top = wallTop * (0.96 + hash01(key, 2) * 0.08);
      wallBoxes(arena, x, y).forEach((box, index) => {
        const sx = box.x1 - box.x0;
        const sz = box.z1 - box.z0;
        const cx = (box.x0 + box.x1) / 2;
        const cz = (box.z0 + box.z1) / 2;
        bodies.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(cx, 0, cz),
            new THREE.Quaternion(),
            new THREE.Vector3(sx, top, sz),
          ),
        );
        // The cap overhangs the faces, not the joints (no coplanar overlap);
        // a crossing bar's cap sits a hair higher for the same reason.
        const alongX = sx >= sz;
        caps.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(cx, top + index * 0.002, cz),
            new THREE.Quaternion(),
            new THREE.Vector3(
              sx + (alongX ? 0 : CAP_LIP * 2),
              CAP_HEIGHT * relative,
              sz + (alongX ? CAP_LIP * 2 : 0),
            ),
          ),
        );
      });
    }
  const capstone = new THREE.MeshStandardMaterial({ color: 0x55524d, roughness: 0.97 });
  capstone.name = "CapStone";
  weatherMaterial(capstone);
  disposables.push(capstone);
  instanced(unitBox, capstone, caps, "terrain:WallCap");

  if (options.lowWalls) {
    const runs = lowWallRuns(arena);
    if (runs.length > 0) {
      // Rubble core: dusty broken fill, mostly hidden by the chunks.
      const geometry = coreGeometry(runs, wallTop);
      const fill = new THREE.MeshStandardMaterial({ color: 0x5a3b30, roughness: 1 });
      fill.name = "Rock";
      weatherMaterial(fill);
      const core = new THREE.Mesh(geometry, fill);
      core.castShadow = true;
      core.receiveShadow = true;
      core.name = "terrain:LowWallCore";
      group.add(core);
      disposables.push(geometry, fill);

      const chunks: THREE.Matrix4[] = [];
      const fragments: THREE.Matrix4[] = [];
      const tints: THREE.Color[] = [];
      const stains: THREE.Matrix4[] = [];
      const place = (run: Run, along: number, out: number, y: number) =>
        new THREE.Vector3(
          run.alongX ? along : run.line + 0.5 + out,
          y,
          run.alongX ? run.line + 0.5 + out : along,
        );
      const tumble = (key: string, salt: number, tilt: number) =>
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            (hash01(key, salt) - 0.5) * tilt,
            hash01(key, salt + 1) * Math.PI * 2,
            (hash01(key, salt + 2) - 0.5) * tilt,
          ),
        );
      for (const run of runs) {
        const seed = `${run.alongX ? "x" : "z"}${run.line}:${run.start}`;
        const terrainAt = (t: number) =>
          run.alongX ? arena.tiles[run.line]?.[t]?.terrain : arena.tiles[t]?.[run.line]?.terrain;
        // Stepped stubs of standing courses where the heap meets a wall; they
        // share the walls' world-space bricks, so the courses carry straight on.
        for (const [edge, inward, wall] of [
          [run.start, 1, standing(terrainAt(run.start - 1))],
          [run.end + 1, -1, standing(terrainAt(run.end + 1))],
        ] as const) {
          if (!wall) continue;
          const key = `${seed}:stub${edge}`;
          let along: number = edge;
          for (const [fraction, step] of [
            [0.68, 1],
            [0.55, 2],
            [0.45, 3],
          ] as const) {
            const length = 0.05 + hash01(key, step) * 0.04;
            const top = wallTop * fraction * (0.92 + hash01(key, step + 10) * 0.16);
            const centre = along + (inward * length) / 2;
            const thickness = WALL_THICKNESS * (0.9 - step * 0.05);
            bodies.push(
              new THREE.Matrix4().compose(
                place(run, centre, 0, 0),
                new THREE.Quaternion(),
                run.alongX
                  ? new THREE.Vector3(length, top, thickness)
                  : new THREE.Vector3(thickness, top, length),
              ),
            );
            along += inward * length;
          }
        }
        for (let t = run.start; t <= run.end; t += 1) {
          const key = `${run.alongX ? t : run.line},${run.alongX ? run.line : t}`;
          // Large broken wall chunks along the crest set the silhouette.
          for (let n = 0; n < 7; n += 1) {
            const along = t + (n + 0.5) / 7 + (hash01(key, 10 + n) - 0.5) * 0.12;
            const crest = heapHeight(seed, along, wallTop);
            const size = new THREE.Vector3(
              (0.2 + hash01(key, 20 + n) * 0.12) * relative,
              (0.13 + hash01(key, 30 + n) * 0.08) * relative,
              (0.2 + hash01(key, 40 + n) * 0.1) * relative,
            );
            chunks.push(
              new THREE.Matrix4().compose(
                place(run, along, (hash01(key, 50 + n) - 0.5) * 0.12, crest - size.y * 0.55),
                tumble(key, 60 + n * 3, 0.9),
                size,
              ),
            );
          }
          // Medium chunks slumped down both flanks.
          for (let n = 0; n < 22; n += 1) {
            const along = t + hash01(key, 100 + n);
            const side = n % 2 === 0 ? -1 : 1;
            const out = side * (0.07 + hash01(key, 110 + n) * 0.22);
            const crest = heapHeight(seed, along, wallTop);
            const size = new THREE.Vector3(
              (0.1 + hash01(key, 120 + n) * 0.08) * relative,
              (0.07 + hash01(key, 130 + n) * 0.05) * relative,
              (0.1 + hash01(key, 140 + n) * 0.06) * relative,
            );
            chunks.push(
              new THREE.Matrix4().compose(
                place(run, along, out, crest * coreSurface(out) + size.y * 0.15),
                tumble(key, 150 + n * 3, 1.4),
                size,
              ),
            );
          }
          // Small fragments spilled at the foot.
          for (let n = 0; n < 22; n += 1) {
            const along = t + hash01(key, 200 + n);
            const side = hash01(key, 210 + n) < 0.5 ? -1 : 1;
            const out = side * (0.22 + Math.pow(hash01(key, 220 + n), 0.8) * 0.22);
            const size = 0.5 + hash01(key, 230 + n) * 0.8;
            fragments.push(
              new THREE.Matrix4().compose(
                place(run, along, out, 0.006 * relative),
                tumble(key, 240 + n * 3, 1.2),
                new THREE.Vector3(
                  BRICK * 0.4 * size * relative,
                  COURSE * 0.5 * size * relative,
                  BRICK * 0.28 * size * relative,
                ),
              ),
            );
            const tone = hash01(key, 320 + n);
            tints.push(
              tone < 0.2
                ? new THREE.Color(0x6f6a62)
                : new THREE.Color().setRGB(0.28 + tone * 0.14, 0.1 + tone * 0.05, 0.07),
            );
          }
          stains.push(
            new THREE.Matrix4().compose(
              place(run, t + 0.5, 0, 0.004),
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(-Math.PI / 2, 0, run.alongX ? 0 : Math.PI / 2),
              ),
              new THREE.Vector3(1.05, 0.8, 1),
            ),
          );
        }
      }

      const chunkShape = chunkGeometry();
      const chunkBrick = brickMaterial(maps, relative, "object");
      disposables.push(chunkShape, chunkBrick);
      instanced(chunkShape, chunkBrick, chunks, "terrain:RubbleChunks");

      const chip = new THREE.MeshStandardMaterial({ roughness: 0.95 });
      chip.name = "Brick";
      weatherMaterial(chip);
      disposables.push(chip);
      const chips = instanced(unitBox, chip, fragments, "terrain:Rubble");
      if (chips !== null) {
        tints.forEach((tint, index) => chips.setColorAt(index, tint));
        if (chips.instanceColor !== null) chips.instanceColor.needsUpdate = true;
      }

      // Dust stain: a soft dark smear on the floor around each collapse.
      const dustCanvas = document.createElement("canvas");
      dustCanvas.width = 128;
      dustCanvas.height = 128;
      const dc = dustCanvas.getContext("2d");
      if (dc !== null) {
        for (let n = 0; n < 40; n += 1) {
          const x = 64 + (hash01("dust", n) - 0.5) * 70;
          const y = 64 + (hash01("dust", 50 + n) - 0.5) * 50;
          const r = 10 + hash01("dust", 100 + n) * 26;
          const gradient = dc.createRadialGradient(x, y, 0, x, y, r);
          gradient.addColorStop(0, "rgba(46,34,26,0.2)");
          gradient.addColorStop(1, "rgba(46,34,26,0)");
          dc.fillStyle = gradient;
          dc.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
      const dustTexture = new THREE.CanvasTexture(dustCanvas);
      dustTexture.colorSpace = THREE.SRGBColorSpace;
      const dust = new THREE.MeshStandardMaterial({
        map: dustTexture,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const plane = new THREE.PlaneGeometry(1, 1);
      disposables.push(dustTexture, dust, plane);
      const stainMesh = instanced(plane, dust, stains, "terrain:Dust");
      if (stainMesh !== null) {
        stainMesh.castShadow = false;
        stainMesh.userData["noAO"] = true;
      }
    }
  }
  // Wall bodies (standing walls and low-wall stubs) go in last, so the stubs
  // collected above share the one brick draw.
  instanced(unitBox, brick, bodies, "terrain:WallBody");

  return {
    group,
    dispose: () => {
      for (const item of disposables) item.dispose();
      group.traverse((child) => {
        if (child instanceof THREE.InstancedMesh) child.dispose();
      });
      group.removeFromParent();
    },
  };
};
