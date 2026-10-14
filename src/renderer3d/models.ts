/** Loads the Blender-built glTF models (tools/blender/build_models.py) and turns
 *  them into reusable part templates. Robots are assembled per instance by
 *  `RobotRig`; arena props are instanced by `ArenaBuilder`.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { RobotClass } from "../engine/types";
import type { ArenaThemeId } from "./themes";

export const MODEL_URLS = {
  robots: {
    rifle: "/assets/models/robots/rifle.glb",
    burst: "/assets/models/robots/burst.glb",
    auto: "/assets/models/robots/auto.glb",
    missile: "/assets/models/robots/missile.glb",
  },
  props: (theme: ArenaThemeId) => `/assets/models/arena/props-${theme}.glb`,
} as const;

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
  const [, hull, upper, lower] = rig.name.split("_").map(Number);
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

let robotsPromise: Promise<ReadonlyMap<RobotClass, RobotModel>> | null = null;
const propsPromises = new Map<ArenaThemeId, Promise<ReadonlyMap<PropName, THREE.Object3D>>>();

const loadRobots = (loader: GLTFLoader) => {
  robotsPromise ??= (async () => {
    const entries = Object.entries(MODEL_URLS.robots) as [RobotClass, string][];
    const scenes = await Promise.all(
      entries.map(async ([kind, url]) => [kind, await loader.loadAsync(url)] as const),
    );
    const robots = new Map<RobotClass, RobotModel>();
    for (const [kind, gltf] of scenes) robots.set(kind, parseRobot(kind, gltf.scene));
    // Stealth is post-v1; until it has its own model it borrows the rifle chassis.
    const rifle = robots.get("rifle");
    if (rifle !== undefined) robots.set("stealth", { ...rifle, robotClass: "stealth" });
    return robots;
  })();
  robotsPromise.catch(() => {
    robotsPromise = null;
  });
  return robotsPromise;
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
export const loadModelLibrary = async (theme: ArenaThemeId): Promise<ModelLibrary> => {
  const loader = new GLTFLoader();
  const [robots, props] = await Promise.all([loadRobots(loader), loadProps(loader, theme)]);
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
