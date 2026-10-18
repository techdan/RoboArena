/** Art-upgrade walls (`?art=next`): continuous brick masonry and collapsed
 *  low-wall rubble, sized to the robots rather than the tile.
 *
 *  Full walls are plain blocks wearing a generated brick-and-mortar texture
 *  projected in world space, so courses run unbroken across joined pieces at
 *  real brick scale; a capstone tops each block. Low walls become one sculpted
 *  mound per run in the same brick, sagging in the middle and climbing in
 *  ragged steps into any standing wall at either end, with instanced fallen
 *  fragments and a dust stain at the base. Presentation only: cover and line
 *  of sight are the engine's, unchanged. Every irregularity is hashed from tile
 *  coordinates, so each replay shows the identical arena.
 */

import * as THREE from "three";
import type { Arena, Terrain } from "../engine/types";
import { weatherMaterial } from "./arenaArt";
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
/** The brick texture spans 4 bricks by 8 courses. */
const BRICKS_ACROSS = 4;
const COURSES_DOWN = 8;

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
    c.fillStyle = "#7d766c";
    c.fillRect(0, 0, width, height);
    h.fillStyle = "#3a3a3a";
    h.fillRect(0, 0, width, height);
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
        // Fired-clay variation: hue, value and the odd scorched or pale brick.
        const tone = hash01(key, 1);
        const r = 118 + tone * 46 - (hash01(key, 2) < 0.12 ? 40 : 0);
        const g = 48 + tone * 22 + (hash01(key, 3) < 0.08 ? 24 : 0);
        const b = 34 + tone * 14;
        c.fillStyle = `rgb(${r},${g},${b})`;
        // Chipped corners: trim one or two corners with a random bevel.
        const chip = (salt: number) =>
          hash01(key, salt) < 0.35 ? 3 + hash01(key, salt + 1) * 7 : 0;
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
        h.fillStyle = `rgb(${200 + tone * 40},${200 + tone * 40},${200 + tone * 40})`;
        h.fill(path);
        // Pitted face: speckles in both maps.
        for (let n = 0; n < 26; n += 1) {
          const px = x + hash01(key, 100 + n) * w;
          const py = y + hash01(key, 200 + n) * bh;
          const size = 1 + hash01(key, 300 + n) * 2.5;
          const dark = hash01(key, 400 + n) < 0.6;
          c.fillStyle = dark ? "rgba(40,16,10,0.35)" : "rgba(220,170,140,0.18)";
          c.fillRect(px, py, size, size);
          h.fillStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.2)";
          h.fillRect(px, py, size, size);
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

/** Brick masonry material: world-projected bricks, mortar relief, base grime
 *  and a rubble-dust tint on upward faces (the tops of collapsed mounds). */
const brickMaterial = (maps: BrickMaps, scale: number): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
  material.name = "ArtBrick";
  const period = new THREE.Vector2(BRICK * BRICKS_ACROSS * scale, COURSE * COURSES_DOWN * scale);
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uBrick"] = { value: maps.albedo };
    shader.uniforms["uBrickHeight"] = { value: maps.height };
    shader.uniforms["uBrickPeriod"] = { value: period };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vBrickWorld;\nvarying vec3 vBrickNormal;",
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 brickWorld = vec4(transformed, 1.0);
        vec3 brickNormal = objectNormal;
        #ifdef USE_INSTANCING
          brickWorld = instanceMatrix * brickWorld;
          brickNormal = mat3(instanceMatrix) * brickNormal;
        #endif
        vBrickWorld = (modelMatrix * brickWorld).xyz;
        vBrickNormal = mat3(modelMatrix) * brickNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBrickWorld;
        varying vec3 vBrickNormal;
        uniform sampler2D uBrick;
        uniform sampler2D uBrickHeight;
        uniform vec2 uBrickPeriod;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 brickAxis = abs(normalize(vBrickNormal));
        vec2 brickUv = (brickAxis.x > brickAxis.z ? vBrickWorld.zy : vBrickWorld.xy) / uBrickPeriod;
        // Sloped and upward faces are a heap of broken brick: each small cell
        // shows a randomly turned scrap of the brick texture with a dark crevice
        // at its edge, so ordered courses survive only on near-vertical faces.
        float top = smoothstep(0.22, 0.5, brickAxis.y);
        vec2 heap = vBrickWorld.xz / (uBrickPeriod.y * 0.16) + vBrickWorld.y * 3.1;
        vec2 cell = floor(heap);
        vec2 local = fract(heap) - 0.5;
        float spin = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
        mat2 turn = mat2(cos(spin), -sin(spin), sin(spin), cos(spin));
        vec2 topUv = (cell * 0.37 + turn * local * 0.6) * vec2(0.25, 0.5);
        float crevice = smoothstep(0.5, 0.36, max(abs(local.x), abs(local.y)));
        vec3 brick = texture2D(uBrick, brickUv).rgb;
        vec3 rubble = texture2D(uBrick, topUv).rgb * mix(0.45, 0.95, crevice) * vec3(0.95, 0.88, 0.82);
        float brickHeight = mix(
          texture2D(uBrickHeight, brickUv).r,
          texture2D(uBrickHeight, topUv).r * crevice,
          top
        );
        diffuseColor.rgb = mix(brick, rubble, top);
        float grime = 1.0 - smoothstep(0.0, 0.14, vBrickWorld.y);
        diffuseColor.rgb *= 1.0 - grime * 0.4;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (0.5 - brickHeight) * 0.25, 0.4, 1.0);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          // Mortar joints and pitting as bump: surface gradient (Mikkelsen 2010).
          float bump = brickHeight * 0.012;
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
  material.customProgramCacheKey = () => "art-brick";
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
// Low walls: one sculpted rubble mound per straight run of low-wall tiles.

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
  const s = f * f * (3 - 2 * f);
  return THREE.MathUtils.lerp(hash01(seed, i), hash01(seed, i + 1), s);
};

/** Mound crest height along a run, in tiles. */
const crest = (
  run: Run,
  s: number,
  wallTop: number,
  course: number,
  ends: { readonly before: boolean; readonly after: boolean },
): number => {
  const seed = `${run.alongX ? "x" : "z"}${run.line}:${run.start}`;
  const low = wallTop * 0.22;
  // Sagging crest with a jagged, broken top.
  let h =
    low * (0.85 + 0.3 * noise1(seed, s * 3)) + wallTop * 0.07 * (noise1(seed, s * 13 + 7) - 0.5);
  const d0 = s - run.start;
  const d1 = run.end + 1 - s;
  for (const [d, wall] of [
    [d0, ends.before],
    [d1, ends.after],
  ] as const) {
    if (wall) {
      // Climb toward the standing wall in ragged steps, about two-thirds up.
      const rise = Math.pow(Math.max(0, 1 - d / 0.26), 1.4);
      if (rise > 0) {
        const stepped = Math.floor((low + (wallTop * 0.62 - low) * rise) / course) * course;
        h = Math.max(h, stepped + course * 0.4 * noise1(seed, s * 23 + 3));
      }
    } else {
      h *= THREE.MathUtils.smoothstep(d, 0, 0.16) * 0.8 + 0.2;
    }
  }
  return Math.max(0.02, h);
};

/** A heap, not a wall: wide spill toes and gentle slopes up to the crest. */
const MOUND_ACROSS = [-1, -0.7, -0.36, 0, 0.36, 0.7, 1] as const;
const MOUND_LIFT = [0, 0.32, 0.78, 1, 0.78, 0.32, 0] as const;
const MOUND_HALF_WIDTH = WALL_THICKNESS * 0.9;
/** Mound surface height at fraction `a` (-1..1) across, for a crest height. */
const moundLift = (a: number): number => {
  for (let k = 1; k < MOUND_ACROSS.length; k += 1) {
    const a1 = MOUND_ACROSS[k]!;
    if (a <= a1) {
      const a0 = MOUND_ACROSS[k - 1]!;
      return THREE.MathUtils.lerp(MOUND_LIFT[k - 1]!, MOUND_LIFT[k]!, (a - a0) / (a1 - a0));
    }
  }
  return 0;
};

const moundGeometry = (
  arena: Arena,
  runs: readonly Run[],
  wallTop: number,
  course: number,
): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];
  // Cross-section across the run: spill toe, shoulders and crest.
  const across = MOUND_ACROSS;
  const lift = MOUND_LIFT;
  const halfWidth = MOUND_HALF_WIDTH;
  for (const run of runs) {
    const at = (t: number) =>
      run.alongX ? arena.tiles[run.line]?.[t]?.terrain : arena.tiles[t]?.[run.line]?.terrain;
    const ends = { before: standing(at(run.start - 1)), after: standing(at(run.end + 1)) };
    const seed = `m${run.alongX ? "x" : "z"}${run.line}:${run.start}`;
    const samples = (run.end + 1 - run.start) * 16;
    const base = positions.length / 3;
    for (let i = 0; i <= samples; i += 1) {
      const s = run.start + (i / samples) * (run.end + 1 - run.start);
      const h = crest(run, s, wallTop, course, ends);
      for (let k = 0; k < across.length; k += 1) {
        const a = across[k]!;
        const wobble = (hash01(seed, i * 7 + k) - 0.5) * 0.12;
        // The spill toe wanders more than the crest, so the footprint is ragged.
        const toe = k === 0 || k === across.length - 1;
        const offset = a * halfWidth + (toe ? wobble * 1.8 : wobble);
        const y =
          k === 0 || k === across.length - 1
            ? -0.005
            : lift[k]! * h * (0.65 + hash01(seed, 900 + i * 7 + k) * 0.6);
        const c = run.line + 0.5 + offset;
        if (run.alongX) positions.push(s, y, c);
        else positions.push(c, y, s);
      }
    }
    const stride = across.length;
    for (let i = 0; i < samples; i += 1)
      for (let k = 0; k < stride - 1; k += 1) {
        const a = base + i * stride + k;
        const b = a + stride;
        // Wind so faces point outward for both run directions.
        if (run.alongX) indices.push(a, a + 1, b, b, a + 1, b + 1);
        else indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    // Close both ends (hidden inside a standing wall when one is there).
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
  const course = COURSE * relative;
  const maps = paintBricks();
  const brick = brickMaterial(maps, relative);
  disposables.push(maps.albedo, maps.height, brick);

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
  instanced(unitBox, brick, bodies, "terrain:WallBody");
  const capstone = new THREE.MeshStandardMaterial({ color: 0x5a5753, roughness: 0.95 });
  capstone.name = "CapStone";
  weatherMaterial(capstone);
  disposables.push(capstone);
  instanced(unitBox, capstone, caps, "terrain:WallCap");

  if (options.lowWalls) {
    const runs = lowWallRuns(arena);
    if (runs.length > 0) {
      const geometry = moundGeometry(arena, runs, wallTop, course);
      const mound = new THREE.Mesh(geometry, brick);
      mound.castShadow = true;
      mound.receiveShadow = true;
      mound.name = "terrain:LowWallMound";
      group.add(mound);
      disposables.push(geometry);

      // Fallen fragments: mixed sizes and tumbles, one instanced draw.
      const fragments: THREE.Matrix4[] = [];
      const tints: THREE.Color[] = [];
      const stains: THREE.Matrix4[] = [];
      for (const run of runs)
        for (let t = run.start; t <= run.end; t += 1) {
          const key = `${run.alongX ? t : run.line},${run.alongX ? run.line : t}`;
          for (let n = 0; n < 26; n += 1) {
            const along = t + hash01(key, 70 + n);
            const side = hash01(key, 90 + n) < 0.5 ? -1 : 1;
            const out = side * (0.28 + Math.pow(hash01(key, 110 + n), 0.8) * 0.26);
            const size = 0.6 + hash01(key, 130 + n) * 0.9;
            const position = new THREE.Vector3(
              run.alongX ? along : run.line + 0.5 + out,
              0.008 * relative,
              run.alongX ? run.line + 0.5 + out : along,
            );
            fragments.push(
              new THREE.Matrix4().compose(
                position,
                new THREE.Quaternion().setFromEuler(
                  new THREE.Euler(
                    (hash01(key, 150 + n) - 0.5) * 1.2,
                    hash01(key, 170 + n) * Math.PI * 2,
                    (hash01(key, 190 + n) - 0.5) * 1.2,
                  ),
                ),
                new THREE.Vector3(
                  BRICK * 0.45 * size * relative,
                  COURSE * 0.55 * size * relative,
                  BRICK * 0.3 * size * relative,
                ),
              ),
            );
            const tone = hash01(key, 210 + n);
            tints.push(
              tone < 0.18
                ? new THREE.Color(0x77736c)
                : new THREE.Color().setRGB(0.3 + tone * 0.14, 0.11 + tone * 0.05, 0.075),
            );
          }
          // Loose bricks heaped on the mound itself break up its silhouette.
          const ends = {
            before: standing(
              run.alongX
                ? arena.tiles[run.line]?.[run.start - 1]?.terrain
                : arena.tiles[run.start - 1]?.[run.line]?.terrain,
            ),
            after: standing(
              run.alongX
                ? arena.tiles[run.line]?.[run.end + 1]?.terrain
                : arena.tiles[run.end + 1]?.[run.line]?.terrain,
            ),
          };
          for (let n = 0; n < 40; n += 1) {
            const s = t + hash01(key, 300 + n);
            const a = (hash01(key, 340 + n) - 0.5) * 1.5;
            const h = crest(run, s, wallTop, course, ends) * moundLift(a) * 0.92;
            const out = a * MOUND_HALF_WIDTH;
            const size = 0.7 + hash01(key, 380 + n) * 0.8;
            fragments.push(
              new THREE.Matrix4().compose(
                new THREE.Vector3(
                  run.alongX ? s : run.line + 0.5 + out,
                  h,
                  run.alongX ? run.line + 0.5 + out : s,
                ),
                new THREE.Quaternion().setFromEuler(
                  new THREE.Euler(
                    (hash01(key, 420 + n) - 0.5) * 1.6,
                    hash01(key, 460 + n) * Math.PI * 2,
                    (hash01(key, 500 + n) - 0.5) * 1.6,
                  ),
                ),
                new THREE.Vector3(
                  BRICK * 0.5 * size * relative,
                  COURSE * 0.6 * size * relative,
                  BRICK * 0.32 * size * relative,
                ),
              ),
            );
            const tone = hash01(key, 540 + n);
            tints.push(
              tone < 0.12
                ? new THREE.Color(0x77736c)
                : new THREE.Color().setRGB(0.3 + tone * 0.14, 0.11 + tone * 0.05, 0.075),
            );
          }
          stains.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(
                run.alongX ? t + 0.5 : run.line + 0.5,
                0.004,
                run.alongX ? run.line + 0.5 : t + 0.5,
              ),
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(-Math.PI / 2, 0, run.alongX ? 0 : Math.PI / 2),
              ),
              new THREE.Vector3(1.15, 0.95, 1),
            ),
          );
        }
      const chip = new THREE.MeshStandardMaterial({ roughness: 0.9 });
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
          gradient.addColorStop(0, "rgba(46,34,26,0.18)");
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
