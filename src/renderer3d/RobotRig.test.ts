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

/** The shipped crab Auto ("Bulldog", auto.glb): its rotary cannon's axis sits
 *  below the BarrelMount, through the single centred muzzle. */
const AUTO_AXIS = new THREE.Vector3(0, -0.2015, 0);
const bulldog = (): RobotModel => {
  const barrel = new THREE.Object3D();
  // Two probes on the cannon: one on its spin axis, one on an outer barrel.
  const onAxis = new THREE.Object3D();
  onAxis.name = "probe-axis";
  onAxis.position.set(AUTO_AXIS.x, AUTO_AXIS.y, 0.3);
  const outer = new THREE.Object3D();
  outer.name = "probe-outer";
  outer.position.set(AUTO_AXIS.x + 0.046, AUTO_AXIS.y, 0.3);
  barrel.add(onAxis, outer);
  return {
    ...strider(),
    robotClass: "auto",
    barrel,
    barrelMount: new THREE.Vector3(0, 0.156, 0.144),
    muzzles: [new THREE.Vector3(0, -0.2015, 0.465)],
  };
};

describe("RobotRig rotary cannon", () => {
  it("spins the barrels about the cannon's own axis instead of swinging the gun", () => {
    const rig = new RobotRig("auto-1", bulldog(), "#3fa7ff");
    rig.place({ x: 2, y: 2 }, 0);
    const inTurret = (name: string) => {
      rig.root.updateMatrixWorld(true);
      const probe = rig.root.getObjectByName(name)!;
      return rig.turret.worldToLocal(probe.getWorldPosition(new THREE.Vector3()));
    };
    const axisBefore = inTurret("probe-axis");
    const radiusBefore = inTurret("probe-outer").sub(axisBefore);
    const muzzleBefore = rig.turret.worldToLocal(rig.muzzleWorld(0));

    rig.fireKick(false);
    let now = 0;
    let turned = 0;
    for (let frame = 0; frame < 20; frame += 1) {
      now += 1 / 60;
      rig.update(now, 1 / 60, 1);
      const outerNow = inTurret("probe-outer").sub(inTurret("probe-axis"));
      turned = Math.max(turned, Math.abs(Math.atan2(outerNow.y, outerNow.x)));
      // The axis line holds still (only recoil may slide it along the barrel).
      const axisNow = inTurret("probe-axis");
      expect(Math.hypot(axisNow.x - axisBefore.x, axisNow.y - axisBefore.y)).toBeLessThan(1e-4);
      // Outer barrels keep their distance from the axis while they turn.
      expect(Math.hypot(outerNow.x, outerNow.y)).toBeCloseTo(
        Math.hypot(radiusBefore.x, radiusBefore.y),
        4,
      );
      // The muzzle flash stays at the front of the cannon.
      const muzzleNow = rig.turret.worldToLocal(rig.muzzleWorld(0));
      expect(Math.hypot(muzzleNow.x - muzzleBefore.x, muzzleNow.y - muzzleBefore.y)).toBeLessThan(
        1e-4,
      );
    }
    expect(turned).toBeGreaterThan(0.5);
  });
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
