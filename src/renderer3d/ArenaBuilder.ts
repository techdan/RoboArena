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

const FLOOR_PX = 64;

interface Placement {
  readonly prop: PropName;
  readonly matrix: THREE.Matrix4;
}

/** Collects one instanced batch per (prop, mesh primitive). */
const instanceProps = (
  library: ModelLibrary,
  placements: readonly Placement[],
  parent: THREE.Object3D,
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
      const mesh = new THREE.InstancedMesh(child.geometry, child.material, matrices.length);
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

/** Paints the arena floor: plated concrete, scorched dirt, gravel and crevices. */
const paintFloor = (arena: Arena): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = arena.width * FLOOR_PX;
  canvas.height = arena.height * FLOOR_PX;
  const context = canvas.getContext("2d");
  if (context === null) return canvas;

  // Base: warm dusty concrete with large-scale mottling.
  context.fillStyle = "#4a4741";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < arena.width * arena.height * 0.9; i += 1) {
    const x = hash01("mx", i) * canvas.width;
    const y = hash01("my", i) * canvas.height;
    const r = 20 + hash01("mr", i) * 90;
    const light = hash01("ml", i) > 0.5;
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, light ? "rgba(140,128,104,0.10)" : "rgba(20,18,15,0.12)");
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
      // Each tile is a concrete plate: subtle per-plate tone, bevelled seams.
      const tone = (hash01(key, 1) - 0.5) * 14;
      context.fillStyle = `rgba(${tone > 0 ? 255 : 0},${tone > 0 ? 245 : 0},${tone > 0 ? 220 : 0},${Math.abs(tone) / 255})`;
      context.fillRect(px, py, FLOOR_PX, FLOOR_PX);
      if (terrain === "rough") {
        context.fillStyle = "rgba(58, 46, 34, 0.75)";
        context.fillRect(px, py, FLOOR_PX, FLOOR_PX);
        for (let g = 0; g < 70; g += 1) {
          const gx = px + hash01(key, 10 + g) * FLOOR_PX;
          const gy = py + hash01(key, 200 + g) * FLOOR_PX;
          const s = 1 + hash01(key, 400 + g) * 3.5;
          const shade = 60 + hash01(key, 600 + g) * 80;
          context.fillStyle = `rgb(${shade},${shade * 0.92},${shade * 0.8})`;
          context.fillRect(gx, gy, s, s);
        }
      }
      if (terrain === "crevice") {
        context.fillStyle = "rgba(20, 16, 12, 0.6)";
        context.fillRect(px, py, FLOOR_PX, FLOOR_PX);
        context.fillStyle = "#050404";
        context.beginPath();
        const steps = 7;
        context.moveTo(px, py + FLOOR_PX * 0.5);
        for (let s = 0; s <= steps; s += 1) {
          const sx = px + (FLOOR_PX * s) / steps;
          context.lineTo(sx, py + FLOOR_PX * (0.12 + hash01(key, 800 + s) * 0.2));
        }
        for (let s = steps; s >= 0; s -= 1) {
          const sx = px + (FLOOR_PX * s) / steps;
          context.lineTo(sx, py + FLOOR_PX * (0.68 + hash01(key, 900 + s) * 0.2));
        }
        context.closePath();
        context.fill();
        context.strokeStyle = "rgba(255, 120, 40, 0.35)";
        context.lineWidth = 1.5;
        context.stroke();
      }
      if (terrain === "open" && hash01(key, 7) > 0.93) {
        // Scorch marks from earlier bouts.
        const gradient = context.createRadialGradient(
          px + FLOOR_PX / 2,
          py + FLOOR_PX / 2,
          2,
          px + FLOOR_PX / 2,
          py + FLOOR_PX / 2,
          FLOOR_PX * 0.7,
        );
        gradient.addColorStop(0, "rgba(8,6,5,0.55)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = gradient;
        context.fillRect(px - FLOOR_PX / 2, py - FLOOR_PX / 2, FLOOR_PX * 2, FLOOR_PX * 2);
      }
      // Plate seams: the readable tactical grid.
      context.strokeStyle = "rgba(10, 10, 9, 0.55)";
      context.lineWidth = 2;
      context.strokeRect(px + 1, py + 1, FLOOR_PX - 2, FLOOR_PX - 2);
      context.strokeStyle = "rgba(200, 190, 170, 0.08)";
      context.lineWidth = 1;
      context.strokeRect(px + 3, py + 3, FLOOR_PX - 6, FLOOR_PX - 6);
      // Rivets on plate corners.
      context.fillStyle = "rgba(190, 180, 160, 0.18)";
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

  // Home pads: hazard-striped deployment corners.
  for (const home of arena.homeAreas) {
    for (const tile of home.tiles) {
      const px = tile.x * FLOOR_PX;
      const py = tile.y * FLOOR_PX;
      context.save();
      context.beginPath();
      context.rect(px, py, FLOOR_PX, FLOOR_PX);
      context.clip();
      context.strokeStyle = "rgba(240, 170, 30, 0.09)";
      context.lineWidth = 8;
      for (let s = -FLOOR_PX; s < FLOOR_PX * 2; s += 20) {
        context.beginPath();
        context.moveTo(px + s, py);
        context.lineTo(px + s + FLOOR_PX, py + FLOOR_PX);
        context.stroke();
      }
      context.restore();
    }
  }
  return canvas;
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
): ArenaBuild => {
  const group = new THREE.Group();
  group.name = "arena";
  const disposables: { dispose(): void }[] = [];

  // Floor.
  const floorCanvas = paintFloor(arena);
  const floorTexture = new THREE.CanvasTexture(floorCanvas);
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  floorTexture.generateMipmaps = true;
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorTexture,
    roughness: 0.88,
    metalness: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(arena.width, arena.height), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(arena.width / 2, 0, arena.height / 2);
  floor.receiveShadow = true;
  floor.name = "floor";
  group.add(floor);
  disposables.push(floorTexture, floorMaterial, floor.geometry);

  // Apron beyond the arena: dark asphalt reaching the stands.
  const apronMaterial = new THREE.MeshStandardMaterial({ color: 0x1d1e1f, roughness: 0.95 });
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), apronMaterial);
  apron.rotation.x = -Math.PI / 2;
  apron.scale.set(arena.width + 40, arena.height + 40, 1);
  apron.position.set(arena.width / 2, -0.01, arena.height / 2);
  apron.receiveShadow = true;
  group.add(apron);
  disposables.push(apronMaterial, apron.geometry);

  const placements: Placement[] = [];
  const crevices: THREE.Matrix4[] = [];
  for (let y = 0; y < arena.height; y += 1) {
    for (let x = 0; x < arena.width; x += 1) {
      const terrain = arena.tiles[y]?.[x]?.terrain;
      const key = `${x},${y}`;
      const cx = x + 0.5;
      const cz = y + 0.5;
      const quarter = Math.floor(hash01(key, 1) * 4) * (Math.PI / 2);
      switch (terrain) {
        case "wall":
          placements.push({ prop: "Wall", matrix: tileMatrix(cx, cz, quarter, { x: 1, y: 0.92 + hash01(key, 2) * 0.16, z: 1 }) });
          break;
        case "outer-wall":
          placements.push({ prop: "OuterWall", matrix: tileMatrix(cx, cz, 0) });
          break;
        case "low-wall": {
          // Low walls align with their neighbours so runs read as barriers.
          const horizontal =
            arena.tiles[y]?.[x - 1]?.terrain === "low-wall" ||
            arena.tiles[y]?.[x + 1]?.terrain === "low-wall";
          placements.push({ prop: "LowWall", matrix: tileMatrix(cx, cz, horizontal ? 0 : Math.PI / 2) });
          break;
        }
        case "bush": {
          const s = 0.9 + hash01(key, 3) * 0.3;
          placements.push({ prop: "Bush", matrix: tileMatrix(cx, cz, hash01(key, 4) * Math.PI * 2, { x: s, y: s, z: s }) });
          break;
        }
        case "rough": {
          const variant = Math.floor(hash01(key, 5) * 3) as 0 | 1 | 2;
          placements.push({ prop: `Rubble${variant}`, matrix: tileMatrix(cx, cz, hash01(key, 6) * Math.PI * 2) });
          break;
        }
        case "crevice":
          crevices.push(tileMatrix(cx, cz, 0, { x: 1, y: 1, z: 1 }, -0.001));
          break;
        default:
          if (hash01(key, 9) > 0.985) {
            placements.push({
              prop: "Crate",
              matrix: tileMatrix(cx + (hash01(key, 10) - 0.5) * 0.4, cz + (hash01(key, 11) - 0.5) * 0.4, hash01(key, 12) * 3, { x: 0.8, y: 0.8, z: 0.8 }),
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
    placements.push({ prop: "FloodTower", matrix: tileMatrix(fx, fz, yaw, { x: 1.4, y: 1.6, z: 1.4 }) });
    floodlights.push(new THREE.Vector3(fx, 6.6, fz));
  }
  instanceProps(library, placements, group);

  // Crevices: a dark sunken slot with a faint magma glow at the bottom.
  if (crevices.length > 0) {
    const geometry = new THREE.PlaneGeometry(0.98, 0.5);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0x3a1206, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.InstancedMesh(geometry, material, crevices.length);
    crevices.forEach((matrix, index) => glow.setMatrixAt(index, matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.004, 0))));
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
