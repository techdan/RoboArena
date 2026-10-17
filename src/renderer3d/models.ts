/** Loads the Blender-built glTF models (tools/blender/build_models.py) and turns
 *  them into reusable part templates. Robots are assembled per instance by
 *  `RobotRig`; arena props are instanced by `ArenaBuilder`.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { RobotClass } from "../engine/types";
import type { ArenaThemeId } from "./themes";

/** Instance repeated rigid pieces (legs/feet), retaining their joint transforms.
 * The invisible source meshes remain in the rig for animation and material changes.
 */
export function instanceRigidParts(root: THREE.Object3D): { update(): void; dispose(): void } {
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((node) => {
    if (
      !(node instanceof THREE.Mesh) ||
      node instanceof THREE.InstancedMesh ||
      node instanceof THREE.SkinnedMesh ||
      node.children.length > 0 ||
      Array.isArray(node.material) ||
      node.material.transparent ||
      node.morphTargetInfluences !== undefined ||
      !node.visible
    )
      return;
    const key = `${node.geometry.uuid}:${node.material.uuid}:${node.castShadow}:${node.receiveShadow}:${node.renderOrder}:${node.layers.mask}`;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  });
  const batches: { mesh: THREE.InstancedMesh; sources: THREE.Mesh[] }[] = [];
  for (const sources of groups.values()) {
    if (sources.length < 2) continue;
    const first = sources[0]!;
    const mesh = new THREE.InstancedMesh(first.geometry, first.material, sources.length);
    mesh.name = "rig-instances";
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = first.layers.mask;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const source of sources) source.visible = false;
    root.add(mesh);
    batches.push({ mesh, sources });
  }
  const inverse = new THREE.Matrix4();
  const matrix = new THREE.Matrix4();
  return {
    update: () => {
      root.updateMatrixWorld(true);
      inverse.copy(root.matrixWorld).invert();
      for (const { mesh, sources } of batches) {
        mesh.material = sources[0]!.material;
        mesh.castShadow = sources[0]!.castShadow;
        mesh.receiveShadow = sources[0]!.receiveShadow;
        sources.forEach((source, index) =>
          mesh.setMatrixAt(index, matrix.multiplyMatrices(inverse, source.matrixWorld)),
        );
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
    dispose: () => {
      for (const { mesh } of batches) {
        mesh.removeFromParent();
        mesh.dispose();
      }
    },
  };
}

/** Robot design families: same classes and weapons, different locomotion.
 *  The shipped "mixed" roster gives each class its own chassis (strider Rifle,
 *  hound Burst, crab Machine gun, titan Missile); the rest are concept sets. */
export type RobotFamily =
  "mixed" | "walker" | "hound" | "titan" | "mantis" | "biped" | "hover" | "treads";
export const DEFAULT_ROBOT_FAMILY: RobotFamily = "mixed";
export const isRobotFamily = (value: unknown): value is RobotFamily =>
  typeof value === "string" &&
  ["mixed", "walker", "hound", "titan", "mantis", "biped", "hover", "treads"].includes(value);

const ROBOT_KINDS = ["rifle", "burst", "auto", "missile"] as const;

export const MODEL_URLS = {
  robot: (family: RobotFamily, kind: (typeof ROBOT_KINDS)[number]) =>
    family === "mixed"
      ? `/assets/models/robots/${kind}.glb`
      : `/assets/models/robots/${family}/${kind}.glb`,
  props: (theme: ArenaThemeId) => `/assets/models/arena/props-${theme}.glb`,
} as const;

/** How the rig moves the hull: splayed spider legs, upright legs that plant
 *  under their hips with knees folding backward, or no legs at all. */
export type Locomotion = "legs" | "upright" | "hover" | "treads";

const LOCOMOTION_CODES: Readonly<Record<string, Locomotion>> = {
  s: "legs",
  b: "upright",
  h: "hover",
  t: "treads",
};

export interface RobotModel {
  readonly robotClass: RobotClass;
  readonly hull: THREE.Object3D;
  readonly turret: THREE.Object3D;
  readonly barrel: THREE.Object3D;
  readonly legUpper: THREE.Object3D;
  readonly legLower: THREE.Object3D;
  readonly foot: THREE.Object3D;
  /** Hull-space hip sockets, in model order (front-left, front-right, …). */
  readonly hips: readonly THREE.Vector3[];
  readonly turretMount: THREE.Vector3;
  readonly barrelMount: THREE.Vector3;
  /** Barrel-space muzzle points. */
  readonly muzzles: readonly THREE.Vector3[];
  readonly hullHeight: number;
  readonly upperLength: number;
  readonly lowerLength: number;
  readonly locomotion: Locomotion;
  /** How far splayed feet rest from their hips, as a fraction of leg length. */
  readonly restReach: number;
}

export type PropName =
  | "Wall"
  | "WallB"
  | "LowWall"
  | "OuterWall"
  | "Bush"
  | "Rubble0"
  | "Rubble1"
  | "Rubble2"
  | "Crate"
  | "FloodTower"
  | "Grandstand";

export interface ModelLibrary {
  readonly robots: ReadonlyMap<RobotClass, RobotModel>;
  readonly props: ReadonlyMap<PropName, THREE.Object3D>;
}

const findNode = (root: THREE.Object3D, name: string): THREE.Object3D => {
  const node = root.getObjectByName(name);
  if (node === undefined) throw new Error(`Model is missing node "${name}".`);
  return node;
};

/** Detaches a part template, zeroing its placement so the part's origin is its joint. */
const detachPart = (root: THREE.Object3D, name: string): THREE.Object3D => {
  const node = findNode(root, name);
  node.removeFromParent();
  node.position.set(0, 0, 0);
  node.rotation.set(0, 0, 0);
  node.updateMatrixWorld(true);
  node.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return node;
};

const parseRobot = (robotClass: RobotClass, scene: THREE.Object3D): RobotModel => {
  const rig = scene.children.find((child) => child.name.startsWith("Rig_"));
  if (rig === undefined) throw new Error(`${robotClass} model has no Rig_ metrics node.`);
  const [, hullText, upperText, lowerText, code, reachText] = rig.name.split("_");
  const [hull, upper, lower] = [hullText, upperText, lowerText].map(Number);
  const position = (name: string) => findNode(scene, name).position.clone();
  const hips: THREE.Vector3[] = [];
  for (let index = 0; scene.getObjectByName(`Hip${index}`) !== undefined; index += 1) {
    hips.push(position(`Hip${index}`));
  }
  const muzzles: THREE.Vector3[] = [];
  for (let index = 0; scene.getObjectByName(`Muzzle${index}`) !== undefined; index += 1) {
    muzzles.push(position(`Muzzle${index}`));
  }
  return {
    robotClass,
    hull: detachPart(scene, "Hull"),
    turret: detachPart(scene, "Turret"),
    barrel: detachPart(scene, "Barrel"),
    legUpper: detachPart(scene, "LegUpper"),
    legLower: detachPart(scene, "LegLower"),
    foot: detachPart(scene, "Foot"),
    hips,
    turretMount: position("TurretMount"),
    barrelMount: position("BarrelMount"),
    muzzles,
    hullHeight: (hull ?? 400) / 1000,
    upperLength: (upper ?? 300) / 1000,
    lowerLength: (lower ?? 400) / 1000,
    locomotion: LOCOMOTION_CODES[code ?? "s"] ?? "legs",
    restReach: reachText === undefined ? 0.62 : Number(reachText) / 1000,
  };
};

const PROP_NAMES: readonly PropName[] = [
  "Wall",
  "WallB",
  "LowWall",
  "OuterWall",
  "Bush",
  "Rubble0",
  "Rubble1",
  "Rubble2",
  "Crate",
  "FloodTower",
  "Grandstand",
];

const robotsPromises = new Map<RobotFamily, Promise<ReadonlyMap<RobotClass, RobotModel>>>();
const propsPromises = new Map<ArenaThemeId, Promise<ReadonlyMap<PropName, THREE.Object3D>>>();

const loadRobots = (loader: GLTFLoader, family: RobotFamily) => {
  let promise = robotsPromises.get(family);
  if (promise === undefined) {
    promise = (async () => {
      const scenes = await Promise.all(
        ROBOT_KINDS.map(
          async (kind) => [kind, await loader.loadAsync(MODEL_URLS.robot(family, kind))] as const,
        ),
      );
      const robots = new Map<RobotClass, RobotModel>();
      for (const [kind, gltf] of scenes) robots.set(kind, parseRobot(kind, gltf.scene));
      // Stealth is post-v1; until it has its own model it borrows the rifle chassis.
      const rifle = robots.get("rifle");
      if (rifle !== undefined) robots.set("stealth", { ...rifle, robotClass: "stealth" });
      return robots;
    })();
    robotsPromises.set(family, promise);
    promise.catch(() => robotsPromises.delete(family));
  }
  return promise;
};

const loadProps = (loader: GLTFLoader, theme: ArenaThemeId) => {
  let promise = propsPromises.get(theme);
  if (promise === undefined) {
    promise = (async () => {
      const gltf = await loader.loadAsync(MODEL_URLS.props(theme));
      const props = new Map<PropName, THREE.Object3D>();
      for (const name of PROP_NAMES) {
        // Optional variants (e.g. WallB) only exist in some themes.
        if (gltf.scene.getObjectByName(name) !== undefined) {
          props.set(name, detachPart(gltf.scene, name));
        }
      }
      return props;
    })();
    propsPromises.set(theme, promise);
    promise.catch(() => propsPromises.delete(theme));
  }
  return promise;
};

/** Loads every model once per page; later movies reuse the parsed templates. */
export const loadModelLibrary = async (
  theme: ArenaThemeId,
  family: RobotFamily = DEFAULT_ROBOT_FAMILY,
): Promise<ModelLibrary> => {
  const loader = new GLTFLoader();
  const [robots, props] = await Promise.all([loadRobots(loader, family), loadProps(loader, theme)]);
  return { robots, props };
};

/** Team colours from the room palette; anything else is parsed as a CSS colour. */
const TEAM_PAINT: Readonly<Record<string, string>> = {
  red: "#d8453a",
  blue: "#3f7fd9",
  green: "#3fae57",
  yellow: "#e0b73a",
};

export const teamPaint = (teamColor: string): THREE.Color => {
  const hex = TEAM_PAINT[teamColor];
  if (hex !== undefined) return new THREE.Color(hex);
  const color = new THREE.Color();
  try {
    color.setStyle(teamColor);
  } catch {
    color.set("#9aa3ad");
  }
  return color;
};

export interface MaterialSet {
  /** Per-team paint and glow are cloned; everything else is shared. */
  readonly resolve: (material: THREE.Material) => THREE.Material;
  readonly charred: THREE.MeshStandardMaterial;
  readonly dispose: () => void;
}

/** Builds the material remapping for one team: `TeamPaint` and `Glow` take the team colour. */
export const teamMaterials = (teamColor: string, glowIntensity = 1.8): MaterialSet => {
  const paint = teamPaint(teamColor);
  const cache = new Map<THREE.Material, THREE.Material>();
  const charred = new THREE.MeshStandardMaterial({
    color: 0x1b1714,
    roughness: 0.95,
    metalness: 0.2,
  });
  return {
    charred,
    dispose: () => {
      for (const [original, resolved] of cache) if (resolved !== original) resolved.dispose();
      cache.clear();
      charred.dispose();
    },
    resolve: (material) => {
      const cached = cache.get(material);
      if (cached !== undefined) return cached;
      let next = material;
      if (material instanceof THREE.MeshStandardMaterial) {
        if (material.name === "TeamPaint") {
          const clone = material.clone();
          clone.color.copy(paint);
          next = clone;
        } else if (material.name === "Glow") {
          const clone = material.clone();
          const glow = paint.clone().lerp(new THREE.Color(0xffffff), 0.12);
          clone.color.copy(glow);
          clone.emissive.copy(glow);
          clone.emissiveIntensity = glowIntensity;
          next = clone;
        }
      }
      cache.set(material, next);
      return next;
    },
  };
};

/** Deep-clones a part template, sharing geometry and remapping materials. */
export const instantiatePart = (
  template: THREE.Object3D,
  materials: MaterialSet,
): THREE.Object3D => {
  const clone = template.clone(true);
  clone.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material)
        ? child.material.map(materials.resolve)
        : materials.resolve(child.material);
    }
  });
  return clone;
};
