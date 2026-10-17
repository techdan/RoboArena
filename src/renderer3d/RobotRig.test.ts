import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RobotModel } from "./models";
import { RobotRig } from "./RobotRig";

/** The shipped strider Rifle's rig metrics (rifle.glb: Rig_660_360_420_b). */
const strider = (): RobotModel => ({
  robotClass: "rifle",
  hull: new THREE.Object3D(),
  turret: new THREE.Object3D(),
  barrel: new THREE.Object3D(),
  legUpper: new THREE.Object3D(),
  legLower: new THREE.Object3D(),
  foot: new THREE.Object3D(),
  hips: [new THREE.Vector3(0.19, 0, -0.02), new THREE.Vector3(-0.19, 0, -0.02)],
  turretMount: new THREE.Vector3(),
  barrelMount: new THREE.Vector3(),
  muzzles: [],
  hullHeight: 0.66,
  upperLength: 0.36,
  lowerLength: 0.42,
  locomotion: "upright",
  restReach: 0.62,
});

const originalDocument = globalThis.document;
beforeAll(() => {
  // The rig draws its HP bar on a canvas; a stub is enough for motion tests.
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = originalDocument;
});

describe("RobotRig walk", () => {
  it.each([0.5, 0.25, 0.22, 0.12])(
    "keeps both strider feet stepping at %ss per tile",
    (tileSeconds) => {
      const steps = [0, 0];
      const rig = new RobotRig("r1", strider(), "#3fa7ff", {
        onFootfall: (at) => {
          const local = rig.root.worldToLocal(at.clone());
          const side = local.x > 0 ? 0 : 1;
          steps[side] = (steps[side] ?? 0) + 1;
        },
      });
      let now = 0;
      const dt = 1 / 60;
      rig.faceYaw(Math.PI / 2, false);
      rig.place({ x: 2, y: 2 }, now);
      let worstReach = 0;
      const legSpan = (0.36 + 0.42) * 1.3;
      for (let tile = 3; tile < 9; tile += 1) {
        rig.moveTo({ x: tile, y: 2 }, tileSeconds, false, now);
        for (let frame = 0; frame < Math.round(tileSeconds * 60); frame += 1) {
          now += dt;
          rig.update(now, dt, 1);
          rig.root.updateMatrixWorld(true);
          const legs = (rig as unknown as { legs: { planted: THREE.Vector3 }[] }).legs;
          const hips = (rig as unknown as { legs: { hip: THREE.Object3D }[] }).legs;
          legs.forEach((leg, index) => {
            const hip = hips[index]!.hip.getWorldPosition(new THREE.Vector3());
            worstReach = Math.max(worstReach, hip.distanceTo(leg.planted) / legSpan);
          });
        }
      }
      expect(Math.min(...steps)).toBeGreaterThanOrEqual(2);
      // Past full leg length the IK can only point the leg straight at the foot;
      // a straight leg at push-off is fine, a foot stranded tiles behind is not.
      expect(worstReach).toBeLessThan(1.05);
    },
  );
});
