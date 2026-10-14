/** Planner overlays for the 3D arena: route ribbons, time pips, destination
 *  rings, targeting heatmaps, scan wedges, aim arcs and last-known markers.
 *
 *  Everything is drawn on (or just above) the arena floor in world units
 *  (1 unit = 1 tile, tile centre at x + 0.5, z + 0.5; see kinematics.ts), so
 *  the overlays read as light projected onto the arena rather than UI pasted
 *  over it. Inputs are plain tile data computed by `src/planner/*`.
 */

import * as THREE from "three";
import type { TileCoord } from "../engine/types";
import { tileCenter } from "./kinematics";

const FLOOR = 0.035;

const additive = (color: THREE.ColorRepresentation, opacity: number) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

const flat = (geometry: THREE.BufferGeometry, material: THREE.Material, y = FLOOR) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = 5;
  return mesh;
};

const centre = (tile: TileCoord) => {
  const c = tileCenter(tile);
  return new THREE.Vector2(c.x, c.z);
};

/** A flat strip following tile centres with mitred corners. */
const stripGeometry = (points: readonly THREE.Vector2[], width: number) => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let travelled = 0;
  points.forEach((point, i) => {
    const prev = points[i - 1] ?? point;
    const next = points[i + 1] ?? point;
    const dirIn = point.clone().sub(prev).normalize();
    const dirOut = next.clone().sub(point).normalize();
    const tangent = dirIn.clone().add(dirOut);
    if (tangent.lengthSq() < 1e-6) tangent.copy(dirOut.lengthSq() > 0 ? dirOut : dirIn);
    tangent.normalize();
    const normal = new THREE.Vector2(-tangent.y, tangent.x);
    const segment = dirOut.lengthSq() > 0 ? dirOut : dirIn;
    const miter = 1 / Math.max(0.5, Math.abs(normal.dot(new THREE.Vector2(-segment.y, segment.x))));
    if (i > 0) travelled += point.distanceTo(prev);
    const half = (width / 2) * miter;
    // Strip lies in the XY plane and is rotated onto the floor, so world z = -y.
    positions.push(point.x + normal.x * half, -(point.y + normal.y * half), 0);
    positions.push(point.x - normal.x * half, -(point.y - normal.y * half), 0);
    uvs.push(travelled, 0, travelled, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
};

/** Soft-edged glowing ribbon: bright core, faded edges, travelling chevrons. */
const ribbonMaterial = (color: THREE.ColorRepresentation, opacity: number) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float across = abs(vUv.y - 0.5) * 2.0;
        float core = smoothstep(1.0, 0.15, across);
        float chevron = fract(vUv.x * 2.2 - across * 0.35 - uTime * 0.8);
        float stripe = smoothstep(0.0, 0.12, chevron) * smoothstep(0.55, 0.3, chevron);
        float alpha = uOpacity * (core * 0.55 + stripe * core * 0.75);
        gl_FragColor = vec4(uColor * (0.8 + stripe * 0.9), alpha);
      }`,
  });

export interface RouteOverlay {
  readonly tiles: readonly TileCoord[];
  readonly color: string;
  /** Tile indices where a pip marks each whole second of travel. */
  readonly secondMarks?: readonly number[];
  readonly emphasis?: "selected" | "normal" | "dim";
}

export interface HeatTile {
  readonly tile: TileCoord;
  readonly color: number;
  readonly alpha: number;
  readonly pattern: "none" | "hatch" | "reverse-hatch" | "dim";
}

export class PlannerOverlays3D {
  readonly group = new THREE.Group();
  private readonly animated: THREE.ShaderMaterial[] = [];
  private readonly pulses: { mesh: THREE.Object3D; phase: number }[] = [];

  constructor() {
    this.group.name = "PlannerOverlays";
  }

  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((node) => {
        if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
          node.geometry.dispose();
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) material.dispose();
        }
      });
    }
    this.animated.length = 0;
    this.pulses.length = 0;
  }

  update(time: number): void {
    for (const material of this.animated) material.uniforms.uTime!.value = time;
    for (const { mesh, phase } of this.pulses) {
      const s = 1 + 0.08 * Math.sin(time * 3 + phase);
      mesh.scale.set(s, s, s);
    }
  }

  /** A planned move: ribbon, a pip per second, and a destination ring. */
  route(route: RouteOverlay): void {
    if (route.tiles.length < 2) return;
    const emphasis = route.emphasis ?? "normal";
    const opacity = emphasis === "selected" ? 1 : emphasis === "dim" ? 0.35 : 0.7;
    const points = route.tiles.map(centre);
    const material = ribbonMaterial(route.color, opacity);
    this.animated.push(material);
    const width = emphasis === "selected" ? 0.26 : 0.18;
    this.group.add(flat(stripGeometry(points, width), material, FLOOR + 0.004));
    for (const index of route.secondMarks ?? []) {
      const tile = route.tiles[index];
      if (tile === undefined) continue;
      const pip = flat(new THREE.CircleGeometry(0.07, 16), additive("#ffffff", 0.85 * opacity));
      const c = centre(tile);
      pip.position.set(c.x, FLOOR + 0.01, c.y);
      this.group.add(pip);
    }
    const end = route.tiles[route.tiles.length - 1]!;
    this.destination(end, route.color, opacity);
  }

  private destination(tile: TileCoord, color: string, opacity: number): void {
    const c = centre(tile);
    const ring = flat(new THREE.RingGeometry(0.36, 0.44, 40), additive(color, 0.9 * opacity));
    ring.position.set(c.x, FLOOR + 0.008, c.y);
    this.group.add(ring);
    const fill = flat(new THREE.CircleGeometry(0.36, 40), additive(color, 0.12 * opacity));
    fill.position.set(c.x, FLOOR + 0.006, c.y);
    this.group.add(fill);
  }

  /** Pulsing selection halo with a soft light column. */
  selection(tile: TileCoord, color: string): void {
    const c = centre(tile);
    const halo = new THREE.Group();
    halo.position.set(c.x, FLOOR + 0.01, c.y);
    const ring = flat(new THREE.RingGeometry(0.46, 0.53, 48), additive(color, 1), 0);
    const inner = flat(new THREE.RingGeometry(0.3, 0.32, 48), additive(color, 0.6), 0);
    halo.add(ring, inner);
    this.group.add(halo);
    this.pulses.push({ mesh: halo, phase: 0 });
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.5, 2.2, 32, 1, true),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: { uColor: { value: new THREE.Color(color) } },
        vertexShader: /* glsl */ `
          varying float vH;
          void main() { vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; varying float vH;
          void main() { gl_FragColor = vec4(uColor, pow(1.0 - vH, 2.2) * 0.28); }`,
      }),
    );
    column.position.set(c.x, 1.1, c.y);
    this.group.add(column);
  }

  /** Targeting heatmap: lit tiles inside the wedge, darkened tiles outside it. */
  heatmap(tiles: readonly HeatTile[]): void {
    const lit = tiles.filter((t) => t.pattern === "none");
    const shaded = tiles.filter((t) => t.pattern !== "none");
    const geometry = new THREE.PlaneGeometry(0.9, 0.9);
    if (lit.length > 0) {
      const mesh = new THREE.InstancedMesh(
        geometry,
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
        lit.length,
      );
      this.fillInstances(mesh, lit, FLOOR + 0.002);
      this.group.add(mesh);
    }
    if (shaded.length > 0) {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
        }),
        shaded.length,
      );
      this.fillInstances(mesh, shaded, FLOOR + 0.001, false);
      this.group.add(mesh);
    }
  }

  private fillInstances(
    mesh: THREE.InstancedMesh,
    tiles: readonly HeatTile[],
    y: number,
    colored = true,
  ): void {
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const color = new THREE.Color();
    tiles.forEach((tile, i) => {
      const c = centre(tile.tile);
      matrix.compose(new THREE.Vector3(c.x, y, c.y), rotation, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, matrix);
      if (colored) mesh.setColorAt(i, color.setHex(tile.color).multiplyScalar(tile.alpha * 1.1));
    });
    mesh.renderOrder = 4;
  }

  /** Scan/fire wedge: two bright rays and the range arc, plus a faint fill. */
  wedge(origin: TileCoord, yaw: number, halfAngle: number, range: number, color: string): void {
    const c = centre(origin);
    const group = new THREE.Group();
    group.position.set(c.x, FLOOR + 0.012, c.y);
    // CircleGeometry sweeps from +X in its XY plane; laid flat, angle a points
    // at world (cos a, -sin a), so world yaw atan2(dx, dz) is a = yaw - PI / 2.
    const start = yaw - Math.PI / 2 - halfAngle;
    const fill = flat(
      new THREE.CircleGeometry(range + 0.5, 64, start, halfAngle * 2),
      additive(color, 0.07),
      0,
    );
    const arc = flat(
      new THREE.RingGeometry(range + 0.42, range + 0.5, 96, 1, start, halfAngle * 2),
      additive(color, 0.95),
      0,
    );
    group.add(fill, arc);
    const rayMaterial = additive(color, 0.9);
    for (const side of [-1, 1]) {
      const angle = yaw + side * halfAngle;
      const tip = new THREE.Vector2(Math.sin(angle), Math.cos(angle)).multiplyScalar(range + 0.5);
      group.add(flat(stripGeometry([new THREE.Vector2(0, 0), tip], 0.05), rayMaterial.clone(), 0));
    }
    this.group.add(group);
  }

  /** Aim arc from shooter to target with a reticle on the target tile. */
  aim(from: TileCoord, to: TileCoord, color: string, lob = false): void {
    const a = centre(from);
    const b = centre(to);
    const distance = a.distanceTo(b);
    const height = lob ? Math.max(1.2, distance * 0.35) : 0.15;
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a.x, 0.75, a.y),
      new THREE.Vector3((a.x + b.x) / 2, 0.75 + height, (a.y + b.y) / 2),
      new THREE.Vector3(b.x, 0.55, b.y),
    );
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 48, 0.025, 6, false),
      additive(color, 0.95),
    );
    this.group.add(tube);
    const reticle = new THREE.Group();
    reticle.position.set(b.x, FLOOR + 0.015, b.y);
    reticle.add(flat(new THREE.RingGeometry(0.42, 0.48, 48), additive(color, 1), 0));
    for (let i = 0; i < 4; i += 1) {
      const tick = flat(new THREE.PlaneGeometry(0.22, 0.05), additive(color, 1), 0);
      const angle = (i * Math.PI) / 2;
      tick.position.set(Math.cos(angle) * 0.6, 0, Math.sin(angle) * 0.6);
      tick.rotation.z = angle;
      reticle.add(tick);
    }
    this.group.add(reticle);
    this.pulses.push({ mesh: reticle, phase: 1.3 });
  }

  /** Enemy contact marker: a red chevron ring. */
  contact(tile: TileCoord, color = "#ff4d4d"): void {
    const c = centre(tile);
    const ring = flat(new THREE.RingGeometry(0.44, 0.5, 6), additive(color, 0.95));
    ring.position.set(c.x, FLOOR + 0.01, c.y);
    this.group.add(ring);
  }

  /** Last-known position: a floor X inside a dashed circle. */
  lastKnown(tile: TileCoord, color = "#ff6b5a"): void {
    const c = centre(tile);
    const group = new THREE.Group();
    group.position.set(c.x, FLOOR + 0.012, c.y);
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const bar = flat(new THREE.PlaneGeometry(0.7, 0.08), additive(color, 0.95), 0);
      bar.rotation.z = angle;
      group.add(bar);
    }
    for (let i = 0; i < 12; i += 1) {
      const dash = flat(
        new THREE.RingGeometry(0.46, 0.5, 6, 1, (i * Math.PI) / 6, Math.PI / 12),
        additive(color, 0.8),
        0,
      );
      group.add(dash);
    }
    this.group.add(group);
  }
}
