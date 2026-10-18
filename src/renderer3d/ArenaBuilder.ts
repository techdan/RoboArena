/** Builds the static 3D battlefield from the engine's arena tiles: a painted
 *  floor that keeps the tactical grid legible, instanced Blender props for
 *  terrain, and stadium dressing (stands, floodlight towers) beyond the walls.
 *
 *  Terrain heights are presentation only; the engine's cover rules are not
 *  derived from them. Variation (rotation, scale, rubble choice) is hashed from
 *  the tile coordinate, so every replay of a match shows the identical arena.
 */

import * as THREE from "three";
import type { Arena, Terrain } from "../engine/types";
import { hash01 } from "./kinematics";
import type { ModelLibrary, PropName } from "./models";
import type { ArenaTheme, FloorPalette } from "./themes";
import { buildFoliage, paintFloorDetail, weatherMaterial } from "./arenaArt";

const FLOOR_PX = 64;

interface Placement {
  readonly prop: PropName;
  readonly matrix: THREE.Matrix4;
}

/**
 * The grandstand canopy is a broad, flat slab of polished steel; seen from the
 * top-down planning camera it mirrors the floodlights into a blinding white
 * bar along each stand. Stands get a brushed, mostly matte steel instead.
 */
const standSteel = new WeakMap<THREE.Material, THREE.Material>();
const matteStandSteel = (material: THREE.Material | THREE.Material[]) => {
  if (Array.isArray(material) || !(material instanceof THREE.MeshStandardMaterial)) return material;
  if (material.name !== "ArenaSteel") return material;
  const cached = standSteel.get(material);
  if (cached !== undefined) return cached;
  const matte = material.clone();
  matte.metalness = 0.35;
  matte.roughness = 0.85;
  standSteel.set(material, matte);
  return matte;
};

/**
 * Art upgrade: the stands are window dressing. The crowd stays recognisable
 * but dim, the structure recedes, the canopy lamps glow faintly over the seats
 * and the LED ribbons and seat strips go out, so the edge never shimmers.
 */
const quietStands = new WeakMap<THREE.Material, THREE.Material>();
const quietStand = (material: THREE.Material | THREE.Material[]) => {
  if (Array.isArray(material) || !(material instanceof THREE.MeshStandardMaterial)) return material;
  const cached = quietStands.get(material);
  if (cached !== undefined) return cached;
  const quiet = material.clone();
  const name = material.name;
  const crowd = name.startsWith("Crowd") || name.startsWith("Banner");
  quiet.color.multiplyScalar(crowd ? 0.5 : 0.28);
  quiet.emissiveIntensity = name === "CanopyLight" ? material.emissiveIntensity * 0.2 : 0;
  quiet.metalness = 0;
  quiet.roughness = 1;
  quiet.onBeforeCompile = () => undefined;
  quiet.customProgramCacheKey = () => "quiet-stand";
  quietStands.set(material, quiet);
  return quiet;
};

/** Collects one instanced batch per (prop, mesh primitive). */
const instanceProps = (
  library: ModelLibrary,
  placements: readonly Placement[],
  parent: THREE.Object3D,
  art = false,
): void => {
  const byProp = new Map<PropName, THREE.Matrix4[]>();
  for (const placement of placements) {
    const list = byProp.get(placement.prop) ?? [];
    list.push(placement.matrix);
    byProp.set(placement.prop, list);
  }
  for (const [prop, matrices] of byProp) {
    const template = library.props.get(prop);
    if (template === undefined) continue;
    template.updateMatrixWorld(true);
    template.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material =
        prop !== "Grandstand"
          ? child.material
          : art
            ? quietStand(child.material)
            : matteStandSteel(child.material);
      const mesh = new THREE.InstancedMesh(child.geometry, material, matrices.length);
      const local = child.matrixWorld;
      matrices.forEach((matrix, index) =>
        mesh.setMatrixAt(index, new THREE.Matrix4().multiplyMatrices(matrix, local)),
      );
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = prop !== "Grandstand";
      mesh.receiveShadow = true;
      mesh.name = `terrain:${prop}`;
      mesh.computeBoundingSphere();
      parent.add(mesh);
    });
  }
};

const tileMatrix = (
  x: number,
  z: number,
  yaw: number,
  scale: THREE.Vector3Like = { x: 1, y: 1, z: 1 },
  y = 0,
) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale.x, scale.y, scale.z),
  );

/**
 * Art upgrade sizing. Tiles are larger than robots, so props are sized to the
 * robots rather than the tile: full walls stand a little above the tallest
 * robot, low walls at crouch height, shrubs and rubble at robot scale. Blocked
 * tiles keep the ordinary floor; the wall on top marks them. All of this is
 * presentation only; cover and line-of-sight rules are unchanged.
 */
export interface ArtSizing {
  /** Robot scale in tile units (the rig's root scale). */
  readonly robotScale: number;
  /** Keep the shipped tile-filling walls (review comparison). */
  readonly tileWalls: boolean;
  /** Keep the sandbag block low wall instead of collapsed rubble (review). */
  readonly blockLowWalls: boolean;
}
/** Props were authored for robots at scale 1.15 on a 1-tile grid. */
const AUTHORED_ROBOT_SCALE = 1.15;
/** Tallest robot (missile titan) per unit of rig scale, measured in tiles. */
const TALLEST_ROBOT_PER_SCALE = 1.046;
/** "Wall" model top (capstones), tiles. */
const WALL_MODEL_TOP = 0.72;
const WALL_THICKNESS = 0.5;
const PILLAR_SIZE = 0.6;

/** Wall pieces for one tile: a thick bar along each run, or a pillar. */
const artWallMatrices = (arena: Arena, x: number, y: number, height: number): THREE.Matrix4[] => {
  const solid = (dx: number, dy: number) => {
    const terrain = arena.tiles[y + dy]?.[x + dx]?.terrain;
    // Low walls join too: a collapsed section meets the standing wall's end.
    return terrain === "wall" || terrain === "outer-wall" || terrain === "low-wall";
  };
  const left = solid(-1, 0);
  const right = solid(1, 0);
  const near = solid(0, -1);
  const far = solid(0, 1);
  const half = WALL_THICKNESS / 2;
  const pieces: THREE.Matrix4[] = [];
  if (left || right) {
    const x0 = left ? 0 : 0.5 - half;
    const x1 = right ? 1 : 0.5 + half;
    pieces.push(
      tileMatrix(x + (x0 + x1) / 2, y + 0.5, 0, { x: x1 - x0, y: height, z: WALL_THICKNESS }),
    );
  }
  if (near || far) {
    const z0 = near ? 0 : 0.5 - half;
    const z1 = far ? 1 : 0.5 + half;
    // A quarter turn maps the model's local x (its run axis) onto world z.
    pieces.push(
      tileMatrix(x + 0.5, y + (z0 + z1) / 2, Math.PI / 2, {
        x: z1 - z0,
        y: height,
        z: WALL_THICKNESS,
      }),
    );
  }
  if (pieces.length === 0)
    pieces.push(tileMatrix(x + 0.5, y + 0.5, 0, { x: PILLAR_SIZE, y: height, z: PILLAR_SIZE }));
  return pieces;
};

/** Paints the arena floor (colour map, plus an emissive map for glowing seams). */
const paintFloor = (
  arena: Arena,
  palette: FloorPalette,
): { color: HTMLCanvasElement; glow: HTMLCanvasElement | null } => {
  const canvas = document.createElement("canvas");
  canvas.width = arena.width * FLOOR_PX;
  canvas.height = arena.height * FLOOR_PX;
  const glowCanvas = palette.glowSeams === null ? null : document.createElement("canvas");
  if (glowCanvas !== null) {
    glowCanvas.width = canvas.width;
    glowCanvas.height = canvas.height;
  }
  const context = canvas.getContext("2d");
  const glow = glowCanvas?.getContext("2d") ?? null;
  if (context === null) return { color: canvas, glow: glowCanvas };
  if (glow !== null) {
    glow.fillStyle = "#000";
    glow.fillRect(0, 0, canvas.width, canvas.height);
  }

  context.fillStyle = palette.base;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < arena.width * arena.height * 0.9; i += 1) {
    const x = hash01("mx", i) * canvas.width;
    const y = hash01("my", i) * canvas.height;
    const r = 20 + hash01("mr", i) * 90;
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, hash01("ml", i) > 0.5 ? palette.mottleLight : palette.mottleDark);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(x - r, y - r, r * 2, r * 2);
  }

  for (let ty = 0; ty < arena.height; ty += 1) {
    for (let tx = 0; tx < arena.width; tx += 1) {
      const terrain: Terrain | undefined = arena.tiles[ty]?.[tx]?.terrain;
      const px = tx * FLOOR_PX;
      const py = ty * FLOOR_PX;
      const key = `${tx},${ty}`;
      const tone = (hash01(key, 1) - 0.5) * palette.plateTone;
      context.fillStyle =
        tone > 0 ? `rgba(255,245,220,${tone / 255})` : `rgba(0,0,0,${-tone / 255})`;
      context.fillRect(px, py, FLOOR_PX, FLOOR_PX);
      if (terrain === "rough") {
        context.fillStyle = palette.rough;
        context.fillRect(px, py, FLOOR_PX, FLOOR_PX);
        const [shadeBase, g, b] = palette.gravel;
        for (let n = 0; n < 70; n += 1) {
          const gx = px + hash01(key, 10 + n) * FLOOR_PX;
          const gy = py + hash01(key, 200 + n) * FLOOR_PX;
          const size = 1 + hash01(key, 400 + n) * 3.5;
          const shade = shadeBase + hash01(key, 600 + n) * 80;
          context.fillStyle = `rgb(${shade},${shade * g},${shade * b})`;
          context.fillRect(gx, gy, size, size);
        }
      }
      if (terrain === "crevice") {
        context.fillStyle = palette.creviceFill;
        context.fillRect(px, py, FLOOR_PX, FLOOR_PX);
        const crack = new Path2D();
        const steps = 7;
        crack.moveTo(px, py + FLOOR_PX * 0.5);
        for (let n = 0; n <= steps; n += 1) {
          crack.lineTo(
            px + (FLOOR_PX * n) / steps,
            py + FLOOR_PX * (0.12 + hash01(key, 800 + n) * 0.2),
          );
        }
        for (let n = steps; n >= 0; n -= 1) {
          crack.lineTo(
            px + (FLOOR_PX * n) / steps,
            py + FLOOR_PX * (0.68 + hash01(key, 900 + n) * 0.2),
          );
        }
        crack.closePath();
        context.fillStyle = "#050404";
        context.fill(crack);
        context.strokeStyle = palette.creviceGlow;
        context.lineWidth = 1.5;
        context.stroke(crack);
        if (glow !== null) {
          glow.strokeStyle = palette.creviceGlow;
          glow.lineWidth = 2.5;
          glow.stroke(crack);
        }
      }
      if (terrain === "open" && hash01(key, 7) < palette.scorchChance) {
        const cx = px + FLOOR_PX / 2;
        const cy = py + FLOOR_PX / 2;
        const gradient = context.createRadialGradient(cx, cy, 2, cx, cy, FLOOR_PX * 0.7);
        gradient.addColorStop(0, "rgba(8,6,5,0.5)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = gradient;
        context.fillRect(px - FLOOR_PX / 2, py - FLOOR_PX / 2, FLOOR_PX * 2, FLOOR_PX * 2);
      }
      // Plate seams: the readable tactical grid.
      context.strokeStyle = palette.seam;
      context.lineWidth = 2;
      context.strokeRect(px + 1, py + 1, FLOOR_PX - 2, FLOOR_PX - 2);
      context.strokeStyle = palette.seamHighlight;
      context.lineWidth = 1;
      context.strokeRect(px + 3, py + 3, FLOOR_PX - 6, FLOOR_PX - 6);
      if (glow !== null && palette.glowSeams !== null) {
        glow.strokeStyle = palette.glowSeams;
        glow.lineWidth = 1.5;
        glow.strokeRect(px + 0.75, py + 0.75, FLOOR_PX - 1.5, FLOOR_PX - 1.5);
        context.strokeStyle = "rgba(60, 200, 255, 0.18)";
        context.lineWidth = 1.5;
        context.strokeRect(px + 0.75, py + 0.75, FLOOR_PX - 1.5, FLOOR_PX - 1.5);
      }
      if (palette.rivets !== null) {
        context.fillStyle = palette.rivets;
        for (const [cx, cy] of [
          [6, 6],
          [FLOOR_PX - 6, 6],
          [6, FLOOR_PX - 6],
          [FLOOR_PX - 6, FLOOR_PX - 6],
        ] as const) {
          context.beginPath();
          context.arc(px + cx, py + cy, 1.6, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
  }

  // Home pads: striped deployment corners.
  for (const home of arena.homeAreas) {
    for (const tile of home.tiles) {
      const px = tile.x * FLOOR_PX;
      const py = tile.y * FLOOR_PX;
      for (const target of glow === null ? [context] : [context, glow]) {
        target.save();
        target.beginPath();
        target.rect(px, py, FLOOR_PX, FLOOR_PX);
        target.clip();
        target.strokeStyle = palette.homeStripe;
        target.lineWidth = 8;
        for (let offset = -FLOOR_PX; offset < FLOOR_PX * 2; offset += 20) {
          target.beginPath();
          target.moveTo(px + offset, py);
          target.lineTo(px + offset + FLOOR_PX, py + FLOOR_PX);
          target.stroke();
        }
        target.restore();
      }
    }
  }
  return { color: canvas, glow: glowCanvas };
};

export interface ArenaBuild {
  readonly group: THREE.Group;
  readonly center: THREE.Vector3;
  readonly radius: number;
  /** Floodlight positions, for volumetric beams. */
  readonly floodlights: readonly THREE.Vector3[];
  dispose(): void;
}

export const buildArena = (
  arena: Arena,
  library: ModelLibrary,
  renderer: THREE.WebGLRenderer,
  theme: ArenaTheme,
  art = false,
  sizing: ArtSizing | null = null,
): ArenaBuild => {
  const group = new THREE.Group();
  group.name = "arena";
  const disposables: { dispose(): void }[] = [];

  // Floor.
  const painted = paintFloor(arena, theme.floor);
  const floorTexture = new THREE.CanvasTexture(painted.color);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  floorTexture.generateMipmaps = true;
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorTexture,
    roughness: theme.floor.roughness,
    metalness: theme.floor.metalness,
  });
  if (painted.glow !== null) {
    const glowTexture = new THREE.CanvasTexture(painted.glow);
    glowTexture.colorSpace = THREE.SRGBColorSpace;
    glowTexture.anisotropy = floorTexture.anisotropy;
    floorMaterial.emissiveMap = glowTexture;
    floorMaterial.emissive.set(0xffffff);
    floorMaterial.emissiveIntensity = theme.floor.glowIntensity;
    disposables.push(glowTexture);
  }
  if (art) {
    const detail = paintFloorDetail(arena, FLOOR_PX, {
      roughness: theme.floor.roughness,
      metalness: theme.floor.metalness,
      relief: 7,
    });
    const normalMap = new THREE.CanvasTexture(detail.normal);
    const orm = new THREE.CanvasTexture(detail.orm);
    for (const texture of [normalMap, orm]) {
      texture.anisotropy = floorTexture.anisotropy;
      disposables.push(texture);
    }
    floorMaterial.normalMap = normalMap;
    floorMaterial.roughnessMap = orm;
    floorMaterial.aoMap = orm;
    floorMaterial.aoMapIntensity = 1;
    floorMaterial.roughness = 1;
    // Relief shading darkens the floor slightly; lift it back so the board
    // stays at least as bright as the flat painted floor (legibility first).
    floorMaterial.color.setScalar(1.06);
    floorMaterial.name = "ArenaFloor";
    weatherMaterial(floorMaterial);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(arena.width, arena.height), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(arena.width / 2, 0, arena.height / 2);
  floor.receiveShadow = true;
  floor.name = "floor";
  group.add(floor);
  disposables.push(floorTexture, floorMaterial, floor.geometry);

  // Apron beyond the arena: dark asphalt reaching the stands.
  const apronMaterial = new THREE.MeshStandardMaterial({ color: theme.apron, roughness: 0.95 });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), apronMaterial);
  apron.rotation.x = -Math.PI / 2;
  apron.scale.set(arena.width + 40, arena.height + 40, 1);
  apron.position.set(arena.width / 2, -0.01, arena.height / 2);
  apron.receiveShadow = true;
  group.add(apron);
  disposables.push(apronMaterial, apron.geometry);

  const placements: Placement[] = [];
  const crevices: THREE.Matrix4[] = [];
  const bushes: THREE.Matrix4[] = [];
  for (let y = 0; y < arena.height; y += 1) {
    for (let x = 0; x < arena.width; x += 1) {
      const terrain = arena.tiles[y]?.[x]?.terrain;
      const key = `${x},${y}`;
      const cx = x + 0.5;
      const cz = y + 0.5;
      const quarter = Math.floor(hash01(key, 1) * 4) * (Math.PI / 2);
      switch (terrain) {
        case "wall":
          if (sizing !== null && !sizing.tileWalls) {
            const top = TALLEST_ROBOT_PER_SCALE * sizing.robotScale * 1.12;
            const height = (top / WALL_MODEL_TOP) * (0.96 + hash01(key, 2) * 0.08);
            for (const matrix of artWallMatrices(arena, x, y, height))
              placements.push({ prop: "Wall", matrix });
            break;
          }
          placements.push({
            prop:
              art && library.props.has("WallTall")
                ? "WallTall"
                : library.props.has("WallB") && hash01(key, 13) > 0.5
                  ? "WallB"
                  : "Wall",
            matrix: tileMatrix(cx, cz, quarter, { x: 1, y: 0.92 + hash01(key, 2) * 0.16, z: 1 }),
          });
          break;
        case "outer-wall":
          placements.push({ prop: "OuterWall", matrix: tileMatrix(cx, cz, 0) });
          break;
        case "low-wall": {
          // Low walls align with their neighbours so runs read as barriers.
          const horizontal =
            arena.tiles[y]?.[x - 1]?.terrain === "low-wall" ||
            arena.tiles[y]?.[x + 1]?.terrain === "low-wall";
          if (
            sizing !== null &&
            !sizing.tileWalls &&
            !sizing.blockLowWalls &&
            library.props.has("LowWallRubble")
          ) {
            // A collapsed section spanning edge to edge, running toward whichever
            // neighbours it connects (standing walls or more low wall).
            const joins = (dx: number, dy: number) => {
              const next = arena.tiles[y + dy]?.[x + dx]?.terrain;
              return next === "low-wall" || next === "wall" || next === "outer-wall";
            };
            const alongX = joins(-1, 0) || joins(1, 0) || !(joins(0, -1) || joins(0, 1));
            const scale = { x: 1, y: sizing.robotScale / AUTHORED_ROBOT_SCALE, z: 1 };
            placements.push({
              prop: "LowWallRubble",
              matrix: tileMatrix(cx, cz, alongX ? 0 : Math.PI / 2, scale),
            });
            // Ends that meet a standing wall climb toward it instead of dropping
            // sheer. The ramp is built at local +X; each yaw turns it to face one
            // neighbour (+X, -X, -Z, +Z in turn).
            const standing = (dx: number, dy: number) => {
              const next = arena.tiles[y + dy]?.[x + dx]?.terrain;
              return next === "wall" || next === "outer-wall";
            };
            const ends: readonly [number, number, number][] = alongX
              ? [
                  [1, 0, 0],
                  [-1, 0, Math.PI],
                ]
              : [
                  [0, -1, Math.PI / 2],
                  [0, 1, -Math.PI / 2],
                ];
            if (library.props.has("LowWallRamp"))
              for (const [dx, dy, yaw] of ends)
                if (standing(dx, dy))
                  placements.push({ prop: "LowWallRamp", matrix: tileMatrix(cx, cz, yaw, scale) });
            break;
          }
          const relative =
            sizing === null || sizing.tileWalls ? 1 : sizing.robotScale / AUTHORED_ROBOT_SCALE;
          placements.push({
            prop: "LowWall",
            matrix: tileMatrix(cx, cz, horizontal ? 0 : Math.PI / 2, {
              x: 1,
              y: relative,
              z: relative,
            }),
          });
          break;
        }
        case "bush": {
          // Art upgrade: shrubs sit inside their tile, leaving floor around them.
          const s = art ? 0.72 + hash01(key, 3) * 0.16 : 0.9 + hash01(key, 3) * 0.3;
          if (art && theme.id === "coliseum") {
            if (sizing === null || sizing.tileWalls) {
              bushes.push(tileMatrix(cx, cz, hash01(key, 4) * Math.PI * 2, { x: s, y: s, z: s }));
              break;
            }
            // Two or three robot-sized clumps scattered across the tile.
            const clump = s * (sizing.robotScale / AUTHORED_ROBOT_SCALE) * 1.1;
            const count = hash01(key, 40) > 0.5 ? 3 : 2;
            for (let n = 0; n < count; n += 1) {
              const angle = (n / count) * Math.PI * 2 + hash01(key, 41) * Math.PI;
              const spread = count === 2 ? 0.2 : 0.24;
              bushes.push(
                tileMatrix(
                  cx + Math.cos(angle) * spread,
                  cz + Math.sin(angle) * spread,
                  hash01(key, 42 + n) * Math.PI * 2,
                  { x: clump, y: clump, z: clump },
                ),
              );
            }
            break;
          }
          placements.push({
            prop: "Bush",
            matrix: tileMatrix(cx, cz, hash01(key, 4) * Math.PI * 2, { x: s, y: s, z: s }),
          });
          break;
        }
        case "rough": {
          if (sizing !== null && !sizing.tileWalls) {
            // Smaller, more numerous rubble: three robot-scaled heaps per tile.
            const relative = sizing.robotScale / AUTHORED_ROBOT_SCALE;
            for (let n = 0; n < 3; n += 1) {
              const heap = Math.floor(hash01(key, 50 + n) * 3) as 0 | 1 | 2;
              placements.push({
                prop: `Rubble${heap}`,
                matrix: tileMatrix(
                  cx + (hash01(key, 53 + n) - 0.5) * 0.6,
                  cz + (hash01(key, 56 + n) - 0.5) * 0.6,
                  hash01(key, 59 + n) * Math.PI * 2,
                  { x: relative, y: relative, z: relative },
                ),
              });
            }
            break;
          }
          const variant = Math.floor(hash01(key, 5) * 3) as 0 | 1 | 2;
          placements.push({
            prop: `Rubble${variant}`,
            matrix: tileMatrix(cx, cz, hash01(key, 6) * Math.PI * 2),
          });
          break;
        }
        case "crevice":
          crevices.push(tileMatrix(cx, cz, 0, { x: 1, y: 1, z: 1 }, -0.001));
          break;
        default:
          if (hash01(key, 9) > 0.985) {
            placements.push({
              prop: "Crate",
              matrix: tileMatrix(
                cx + (hash01(key, 10) - 0.5) * 0.4,
                cz + (hash01(key, 11) - 0.5) * 0.4,
                hash01(key, 12) * 3,
                { x: 0.8, y: 0.8, z: 0.8 },
              ),
            });
          }
      }
    }
  }

  // Stadium: grandstands on all four sides, floodlight towers at the corners.
  const margin = 4.5;
  const w = arena.width;
  const h = arena.height;
  const sides: { x: number; z: number; yaw: number; length: number }[] = [
    // Model tiers climb toward glTF -Z, so each side faces its stands outward.
    { x: w / 2, z: -margin, yaw: 0, length: w },
    { x: w / 2, z: h + margin, yaw: Math.PI, length: w },
    { x: -margin, z: h / 2, yaw: Math.PI / 2, length: h },
    { x: w + margin, z: h / 2, yaw: -Math.PI / 2, length: h },
  ];
  for (const side of sides) {
    const sections = Math.ceil(side.length / 4);
    for (let i = 0; i < sections; i += 1) {
      const offset = (i - (sections - 1) / 2) * 4;
      const dx = Math.cos(side.yaw) * offset;
      const dz = -Math.sin(side.yaw) * offset;
      placements.push({
        prop: "Grandstand",
        matrix: tileMatrix(side.x + dx, side.z + dz, side.yaw, { x: 1, y: 1, z: 1 }),
      });
    }
  }
  const floodlights: THREE.Vector3[] = [];
  for (const [fx, fz] of [
    [-margin + 0.5, -margin + 0.5],
    [w + margin - 0.5, -margin + 0.5],
    [-margin + 0.5, h + margin - 0.5],
    [w + margin - 0.5, h + margin - 0.5],
  ] as const) {
    const yaw = Math.atan2(w / 2 - fx, h / 2 - fz) + Math.PI;
    placements.push({
      prop: "FloodTower",
      matrix: tileMatrix(fx, fz, yaw, { x: 1.4, y: 1.6, z: 1.4 }),
    });
    floodlights.push(new THREE.Vector3(fx, 6.6, fz));
  }
  if (art) {
    for (const template of library.props.values())
      template.traverse((child) => {
        if (child instanceof THREE.Mesh && !Array.isArray(child.material))
          weatherMaterial(child.material);
      });
  }
  instanceProps(library, placements, group, art);
  if (bushes.length > 0) {
    const foliage = buildFoliage(bushes, ["#5a9e36", "#6cb03e", "#82c24a", "#94cc58", "#4a8a2e"]);
    group.add(foliage.mesh);
    disposables.push(foliage);
  }

  // Crevices: a dark sunken slot with a faint magma glow at the bottom.
  if (crevices.length > 0) {
    const geometry = new THREE.PlaneGeometry(0.98, 0.5);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: theme.id === "neon" ? 0x5a0a48 : theme.id === "scrapyard" ? 0x000000 : 0x3a1206,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.InstancedMesh(geometry, material, crevices.length);
    crevices.forEach((matrix, index) =>
      glow.setMatrixAt(
        index,
        matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.004, 0)),
      ),
    );
    glow.instanceMatrix.needsUpdate = true;
    group.add(glow);
    disposables.push(geometry, material);
  }

  return {
    group,
    center: new THREE.Vector3(w / 2, 0, h / 2),
    radius: Math.hypot(w, h) / 2,
    floodlights,
    dispose: () => {
      for (const item of disposables) item.dispose();
      group.traverse((child) => {
        if (child instanceof THREE.InstancedMesh) child.dispose();
      });
      group.removeFromParent();
    },
  };
};
