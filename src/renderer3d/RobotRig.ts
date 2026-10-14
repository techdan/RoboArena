/** One articulated 3D robot: rigid Blender parts assembled into a hull, turret,
 *  barrel and IK legs, driven by presentation-only motion.
 *
 *    root           ground position + body yaw (walks / hops the tile path)
 *    └── hull       height, bob, lean, flinch (springs)
 *        ├── turret yaw toward scan heading or aim target
 *        │   └── barrel   recoil slide (+ spin for the rotary cannon)
 *        └── hipN   yaw toward the planted foot
 *            └── upper → knee → foot   two-bone IK, knee up (spider stance)
 *
 *  Feet are planted in world space and only step when the body has drifted far
 *  enough from them, in alternating groups. That is what makes the walk read as
 *  a skittering machine rather than a sliding sprite. Nothing here feeds back
 *  into the game: the engine's tile positions are the only truth, and every
 *  pose converges on them.
 */

import * as THREE from "three";
import type { Posture, TileCoord } from "../engine/types";
import {
  approachAngle,
  gaitGroups,
  hash01,
  hopArc,
  skitterEase,
  solveLeg,
  Spring,
  swingHeight,
  tileCenter,
  wrapAngle,
  yawToward,
} from "./kinematics";
import { instantiatePart, teamMaterials, teamPaint, type RobotModel } from "./models";

const POSTURE_HEIGHT: Readonly<Record<Posture, number>> = {
  upright: 1,
  ducking: 0.74,
  crouching: 0.5,
};
/** Robots are drawn larger than life so they read against tile-sized cover. */
export const ROBOT_SCALE = 1.3;

const POSTURE_SPREAD: Readonly<Record<Posture, number>> = {
  upright: 1,
  ducking: 1.12,
  crouching: 1.24,
};

interface Leg {
  readonly hip: THREE.Group;
  readonly upper: THREE.Group;
  readonly knee: THREE.Group;
  readonly foot: THREE.Group;
  readonly group: 0 | 1;
  /** Horizontal rest offset in body space (x right, z forward). */
  readonly rest: THREE.Vector2;
  readonly planted: THREE.Vector3;
  readonly stepFrom: THREE.Vector3;
  readonly stepTo: THREE.Vector3;
  stepStart: number;
  stepDuration: number;
  stepping: boolean;
}

interface MoveSegment {
  readonly from: THREE.Vector2;
  readonly to: THREE.Vector2;
  readonly start: number;
  readonly duration: number;
  readonly hop: boolean;
}

export interface RigEvents {
  /** Called when a foot lands, with the footfall position and whether it was a hop landing. */
  readonly onFootfall?: (at: THREE.Vector3, heavy: boolean) => void;
  readonly onDetachTurret?: (turret: THREE.Object3D, velocity: THREE.Vector3) => void;
}

const tmpV3 = new THREE.Vector3();
const tmpV3b = new THREE.Vector3();

export class RobotRig {
  readonly root = new THREE.Group();
  readonly hull = new THREE.Group();
  readonly turret = new THREE.Group();
  readonly barrel = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly muzzles: THREE.Object3D[] = [];
  private readonly ring: THREE.Mesh;
  private readonly hpBar: THREE.Sprite;
  private readonly hpCanvas: HTMLCanvasElement;
  private readonly hpTexture: THREE.CanvasTexture;
  private readonly paintMeshes: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }[] =
    [];
  private readonly charred: THREE.Material;
  private readonly spin: boolean;

  private position = new THREE.Vector2();
  private velocity = new THREE.Vector2();
  private segment: MoveSegment | null = null;
  private bodyYaw = 0;
  private bodyYawTarget = 0;
  private turretYaw = 0;
  private turretYawTarget = 0;
  private aimHold = 0;
  private posture: Posture = "upright";
  private readonly height: Spring;
  private readonly pitch = new Spring(0, 120, 11);
  private readonly roll = new Spring(0, 120, 11);
  private readonly shoveX = new Spring(0, 160, 14);
  private readonly shoveZ = new Spring(0, 160, 14);
  private readonly recoil = new Spring(0, 260, 16);
  private airborne = 0;
  private gaitClock = 0;
  private barrelSpin = 0;
  private barrelSpinVelocity = 0;
  private destroyedState = false;
  private hp = 1;
  private hpMax = 1;
  private idlePhase: number;
  visible = true;

  constructor(
    readonly id: string,
    private readonly model: RobotModel,
    teamColor: string,
    private readonly events: RigEvents = {},
    glowIntensity = 1.8,
  ) {
    const materials = teamMaterials(teamColor, glowIntensity);
    this.charred = materials.charred;
    this.spin = model.robotClass === "auto";
    this.idlePhase = hash01(id) * Math.PI * 2;
    this.height = new Spring(model.hullHeight, 140, 13);
    this.root.name = `robot:${id}`;
    this.root.scale.setScalar(ROBOT_SCALE);

    const hullPart = instantiatePart(model.hull, materials);
    this.hull.add(hullPart);
    this.hull.position.y = model.hullHeight;
    this.root.add(this.hull);

    this.turret.position.copy(model.turretMount);
    this.turret.add(instantiatePart(model.turret, materials));
    this.hull.add(this.turret);
    this.barrel.position.copy(model.barrelMount);
    this.barrel.add(instantiatePart(model.barrel, materials));
    this.turret.add(this.barrel);
    for (const muzzle of model.muzzles) {
      const anchor = new THREE.Object3D();
      anchor.position.copy(muzzle);
      this.barrel.add(anchor);
      this.muzzles.push(anchor);
    }

    const groups = gaitGroups(model.hips.length);
    model.hips.forEach((hipPosition, index) => {
      const hip = new THREE.Group();
      hip.position.copy(hipPosition);
      const upper = new THREE.Group();
      upper.add(instantiatePart(model.legUpper, materials));
      const knee = new THREE.Group();
      knee.position.x = model.upperLength;
      knee.add(instantiatePart(model.legLower, materials));
      const foot = new THREE.Group();
      foot.position.x = model.lowerLength;
      foot.add(instantiatePart(model.foot, materials));
      knee.add(foot);
      upper.add(knee);
      hip.add(upper);
      this.hull.add(hip);
      const outward = new THREE.Vector2(hipPosition.x, hipPosition.z).normalize();
      const reach = (model.upperLength + model.lowerLength) * 0.62;
      this.legs.push({
        hip,
        upper,
        knee,
        foot,
        group: groups[index] ?? 0,
        rest: new THREE.Vector2(
          hipPosition.x + outward.x * reach,
          hipPosition.z + outward.y * reach * 0.8,
        ),
        planted: new THREE.Vector3(),
        stepFrom: new THREE.Vector3(),
        stepTo: new THREE.Vector3(),
        stepStart: 0,
        stepDuration: 0.14,
        stepping: false,
      });
    });

    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const list = Array.isArray(child.material) ? child.material : [child.material];
      if (list.some((material) => material.name === "TeamPaint" || material.name === "Glow")) {
        this.paintMeshes.push({ mesh: child, original: child.material });
      }
    });

    // Team ring: a soft emissive halo on the ground so sides read at a glance.
    const paint = teamPaint(teamColor);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.35, 40),
      new THREE.MeshBasicMaterial({
        color: paint,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.ring.renderOrder = 2;
    this.root.add(this.ring);

    this.hpCanvas = document.createElement("canvas");
    this.hpCanvas.width = 128;
    this.hpCanvas.height = 20;
    this.hpTexture = new THREE.CanvasTexture(this.hpCanvas);
    this.hpTexture.colorSpace = THREE.SRGBColorSpace;
    this.hpBar = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.hpTexture, depthTest: false, transparent: true }),
    );
    this.hpBar.scale.set(0.46, 0.072, 1);
    this.hpBar.renderOrder = 10;
    this.root.add(this.hpBar);
  }

  /** World position of the robot's ground anchor. */
  groundPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, 0, this.position.y);
  }

  /** World position of a muzzle (cycled by shot index). */
  muzzleWorld(index: number, out = new THREE.Vector3()): THREE.Vector3 {
    const muzzle = this.muzzles[index % Math.max(1, this.muzzles.length)];
    if (muzzle === undefined) return this.hull.getWorldPosition(out);
    return muzzle.getWorldPosition(out);
  }

  /** Centre of mass, for impact effects. */
  chestWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.hull.getWorldPosition(out);
  }

  get destroyed(): boolean {
    return this.destroyedState;
  }

  /** Jumps straight to a tile with feet planted (seek, first frame, deploy). */
  place(tile: TileCoord, now: number): void {
    const centre = tileCenter(tile);
    this.position.set(centre.x, centre.z);
    this.segment = null;
    this.velocity.set(0, 0);
    this.airborne = 0;
    this.applyRootTransform();
    this.plantAll(now);
  }

  /** Starts walking (single) or leaping (double straight) to a tile. */
  moveTo(tile: TileCoord, durationSeconds: number, hop: boolean, now: number): void {
    const centre = tileCenter(tile);
    const to = new THREE.Vector2(centre.x, centre.z);
    if (to.distanceTo(this.position) < 1e-3) return;
    this.segment = {
      from: this.position.clone(),
      to,
      start: now,
      duration: Math.max(0.08, durationSeconds),
      hop,
    };
    this.bodyYawTarget = yawToward(to.x - this.position.x, to.y - this.position.y);
  }

  setPosture(posture: Posture, animate: boolean): void {
    this.posture = posture;
    this.height.target = this.model.hullHeight * POSTURE_HEIGHT[posture];
    if (!animate) this.height.snap(this.height.target);
  }

  /** Scan heading: the turret settles here whenever it is not holding an aim. */
  setScanYaw(yaw: number, animate: boolean): void {
    this.turretYawTarget = yaw;
    if (!animate) this.turretYaw = yaw;
  }

  /** Swings the turret onto a target and holds it there for a moment. */
  aimAt(target: THREE.Vector3, holdSeconds: number): void {
    this.aimHold = holdSeconds;
    this.aimYaw = yawToward(target.x - this.position.x, target.z - this.position.y);
  }
  private aimYaw = 0;

  /** Instant aim, so a muzzle flash spawned this frame comes out of the right barrel. */
  snapAim(target: THREE.Vector3): void {
    this.aimAt(target, 0.6);
    this.turretYaw = this.aimYaw;
    this.applyRootTransform();
  }

  fireKick(heavy: boolean): void {
    this.recoil.kick(heavy ? -2.2 : -1.3);
    this.pitch.kick(heavy ? -1.6 : -0.6);
    if (this.spin) this.barrelSpinVelocity = 40;
  }

  /** Knocks the hull away from `from` (world position of the shooter or blast). */
  flinch(from: THREE.Vector3, strength: number): void {
    const dx = this.position.x - from.x;
    const dz = this.position.y - from.z;
    const length = Math.hypot(dx, dz) || 1;
    this.shoveX.kick((dx / length) * strength * 1.6);
    this.shoveZ.kick((dz / length) * strength * 1.6);
    // Pitch/roll in body space so the hull tips away from the hit.
    const local = new THREE.Vector2(dx / length, dz / length).rotateAround(
      new THREE.Vector2(),
      -this.bodyYaw,
    );
    this.pitch.kick(local.y * strength * 5);
    this.roll.kick(-local.x * strength * 5);
  }

  setHp(hp: number, max: number): void {
    if (hp === this.hp && max === this.hpMax) return;
    this.hp = hp;
    this.hpMax = Math.max(1, max);
    // Healthy robots carry no bar: the arena stays readable with 16 robots.
    this.hpBar.visible = !this.destroyedState && hp < this.hpMax;
    this.drawHpBar();
  }

  private drawHpBar(): void {
    const context = this.hpCanvas.getContext("2d");
    if (context === null) return;
    const { width, height } = this.hpCanvas;
    const fraction = Math.max(0, Math.min(1, this.hp / this.hpMax));
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(6, 10, 12, 0.8)";
    context.beginPath();
    context.roundRect(0, 0, width, height, 6);
    context.fill();
    const color = fraction > 0.6 ? "#5df28a" : fraction > 0.3 ? "#f2c94c" : "#ff5a4f";
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(3, 3, (width - 6) * fraction, height - 6, 4);
    context.fill();
    context.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = 1; i < 10; i += 1) context.fillRect((width / 10) * i, 3, 2, height - 6);
    this.hpTexture.needsUpdate = true;
  }

  /** Death: hull slumps, legs splay, paint chars; animated deaths throw the turret. */
  setDestroyed(destroyed: boolean, animate: boolean): void {
    if (destroyed === this.destroyedState) return;
    this.destroyedState = destroyed;
    this.ring.visible = !destroyed;
    this.hpBar.visible = !destroyed && this.hp < this.hpMax;
    for (const { mesh, original } of this.paintMeshes) {
      mesh.material = destroyed
        ? Array.isArray(original)
          ? original.map((material) =>
              material.name === "TeamPaint" || material.name === "Glow" ? this.charred : material,
            )
          : this.charred
        : original;
    }
    if (destroyed) {
      this.segment = null;
      this.height.target = 0.12;
      this.roll.target = hash01(this.id, 3) > 0.5 ? 0.32 : -0.32;
      this.pitch.target = 0.18;
      if (animate) {
        this.height.kick(3.5);
        if (this.events.onDetachTurret !== undefined) {
          const turret = this.turret;
          const velocity = new THREE.Vector3(
            (hash01(this.id, 5) - 0.5) * 2.4,
            4.2,
            (hash01(this.id, 6) - 0.5) * 2.4,
          );
          this.events.onDetachTurret(turret, velocity);
        } else {
          this.turret.rotation.z = 0.5;
        }
      } else {
        this.height.snap(0.12);
        this.roll.snap(this.roll.target);
        this.pitch.snap(this.pitch.target);
        this.turret.visible = false;
      }
    } else {
      this.reattachTurret();
      this.height.target = this.model.hullHeight * POSTURE_HEIGHT[this.posture];
      this.height.snap(this.height.target);
      this.roll.snap(0);
      this.pitch.snap(0);
    }
  }

  /** Puts a thrown turret back (seeking backwards past a death). */
  reattachTurret(): void {
    if (this.turret.parent !== this.hull) {
      this.turret.removeFromParent();
      this.hull.add(this.turret);
    }
    this.turret.visible = true;
    this.turret.position.copy(this.model.turretMount);
    this.turret.rotation.set(0, 0, 0);
    this.turret.scale.setScalar(1);
  }

  private plantAll(now: number): void {
    this.root.updateMatrixWorld(true);
    for (const leg of this.legs) {
      this.restWorld(leg, leg.planted, 0);
      leg.stepping = false;
      leg.stepStart = now;
    }
  }

  private restWorld(leg: Leg, out: THREE.Vector3, lookahead: number): THREE.Vector3 {
    const spread = this.destroyedState ? 1.35 : POSTURE_SPREAD[this.posture];
    const cos = Math.cos(this.bodyYaw);
    const sin = Math.sin(this.bodyYaw);
    const rx = leg.rest.x * spread * ROBOT_SCALE;
    const rz = leg.rest.y * spread * ROBOT_SCALE;
    // rotation.y = θ maps local (x, z) to (x cos θ + z sin θ, -x sin θ + z cos θ).
    out.set(
      this.position.x + rx * cos + rz * sin + this.velocity.x * lookahead,
      0,
      this.position.y - rx * sin + rz * cos + this.velocity.y * lookahead,
    );
    return out;
  }

  private applyRootTransform(): void {
    this.root.position.set(this.position.x, 0, this.position.y);
    this.root.rotation.y = this.bodyYaw;
    this.turret.rotation.y = this.destroyedState ? this.turret.rotation.y : this.turretYaw - this.bodyYaw;
    this.root.updateMatrixWorld(true);
  }

  update(now: number, dt: number, speed: number): void {
    if (!this.visible) return;
    const previous = this.position.clone();

    // 1. Travel along the active tile segment.
    let hopLift = 0;
    if (this.segment !== null) {
      const { from, to, start, duration, hop } = this.segment;
      const u = Math.min(1, (now - start) / duration);
      const eased = hop ? u : skitterEase(u);
      this.position.lerpVectors(from, to, eased);
      if (hop) {
        hopLift = hopArc(u) * 0.55;
        this.airborne = u < 1 ? 1 : 0;
      }
      if (u >= 1) {
        const wasHop = hop;
        this.segment = null;
        if (wasHop) {
          this.airborne = 0;
          this.height.kick(-3.2);
          this.pitch.kick(1.2);
          this.applyRootTransform();
          this.plantAll(now);
          this.events.onFootfall?.(this.groundPosition(tmpV3), true);
        }
      }
    }
    if (dt > 0) {
      const vx = (this.position.x - previous.x) / dt;
      const vz = (this.position.y - previous.y) / dt;
      this.velocity.set(
        THREE.MathUtils.lerp(this.velocity.x, vx, 0.35),
        THREE.MathUtils.lerp(this.velocity.y, vz, 0.35),
      );
    }
    const moving = this.velocity.lengthSq() > 0.05;

    // 2. Headings: body follows travel; turret holds aim, else tracks scan heading.
    if (!this.destroyedState) {
      this.bodyYaw = approachAngle(this.bodyYaw, this.bodyYawTarget, dt * 9 * Math.max(1, speed));
      this.aimHold = Math.max(0, this.aimHold - dt * speed);
      const turretGoal = this.aimHold > 0 ? this.aimYaw : this.turretYawTarget;
      this.turretYaw = approachAngle(this.turretYaw, turretGoal, dt * 7 * Math.max(1, speed));
    }

    // 3. Secondary motion springs (presentation time runs with playback speed).
    const sdt = dt * Math.max(0.25, speed);
    this.gaitClock += sdt * (moving ? 14 : 1.2);
    const idleBob = this.destroyedState ? 0 : Math.sin(now * 2.1 + this.idlePhase) * 0.006;
    const walkBob = moving ? Math.abs(Math.sin(this.gaitClock)) * 0.025 : 0;
    const height = this.height.step(sdt);
    const local = this.velocity.clone().rotateAround(new THREE.Vector2(), -this.bodyYaw);
    this.pitch.target = this.destroyedState ? this.pitch.target : -local.y * 0.06;
    this.roll.target = this.destroyedState
      ? this.roll.target
      : wrapAngle(this.bodyYawTarget - this.bodyYaw) * 0.25;
    const pitch = this.pitch.step(sdt);
    const roll = this.roll.step(sdt);
    const shoveX = this.shoveX.step(sdt);
    const shoveZ = this.shoveZ.step(sdt);
    const recoil = this.recoil.step(sdt);

    this.hull.position.set(0, height + hopLift + walkBob + idleBob, 0);
    this.hull.rotation.set(pitch * 0.12, 0, roll * 0.12, "YXZ");
    // Shove is world-space; convert into the root's yawed frame.
    const cos = Math.cos(this.bodyYaw);
    const sin = Math.sin(this.bodyYaw);
    this.hull.position.x += (shoveX * cos - shoveZ * sin) * 0.05;
    this.hull.position.z += (shoveX * sin + shoveZ * cos) * 0.05;
    this.barrel.position.z = this.model.barrelMount.z + recoil * 0.05;
    if (this.spin) {
      this.barrelSpinVelocity *= Math.exp(-sdt * 2.5);
      this.barrelSpin += this.barrelSpinVelocity * sdt;
      this.barrel.rotation.z = this.barrelSpin;
    }
    this.ring.position.y = 0.015;
    this.hpBar.position.set(0, height + hopLift + 0.55, 0);
    this.applyRootTransform();

    // 4. Feet: planted in world space, stepping in alternating groups.
    const stepDuration = 0.15 / Math.max(0.5, speed);
    const threshold = this.destroyedState ? 0 : moving ? 0.12 : 0.04;
    const stepping = [false, false];
    for (const leg of this.legs) if (leg.stepping) stepping[leg.group] = true;
    for (const leg of this.legs) {
      if (this.airborne > 0) {
        // Tuck legs under the hull mid-leap.
        this.restWorld(leg, leg.planted, 0);
        leg.planted.lerp(tmpV3b.set(this.position.x, 0, this.position.y), 0.3);
        leg.planted.y = hopLift * 0.6 + 0.06;
        leg.stepping = false;
        continue;
      }
      if (leg.stepping) {
        const u = (now - leg.stepStart) / leg.stepDuration;
        if (u >= 1) {
          leg.stepping = false;
          leg.planted.copy(leg.stepTo);
          leg.planted.y = 0;
          if (moving || this.destroyedState) this.events.onFootfall?.(leg.planted, false);
        } else {
          leg.planted.lerpVectors(leg.stepFrom, leg.stepTo, skitterEase(u));
          leg.planted.y = swingHeight(u, 0.16);
        }
        continue;
      }
      const target = this.restWorld(leg, tmpV3, moving ? stepDuration * 1.1 : 0);
      const drift = Math.hypot(target.x - leg.planted.x, target.z - leg.planted.z);
      const otherGroup = leg.group === 0 ? 1 : 0;
      if (drift > threshold && !stepping[otherGroup]) {
        leg.stepping = true;
        stepping[leg.group] = true;
        leg.stepStart = now;
        leg.stepDuration = this.destroyedState ? 0.3 : stepDuration;
        leg.stepFrom.copy(leg.planted);
        leg.stepTo.copy(target);
        // Planted legs sink slightly into the ground plane at y=0.
        leg.planted.y = 0;
      } else {
        leg.planted.y = 0;
      }
    }

    // 5. Solve every leg toward its foot.
    this.hull.updateMatrixWorld(true);
    for (const leg of this.legs) {
      const footLocal = this.hull.worldToLocal(tmpV3.copy(leg.planted));
      footLocal.y += 0.03; // foot pad thickness
      const dx = footLocal.x - leg.hip.position.x;
      const dy = footLocal.y - leg.hip.position.y;
      const dz = footLocal.z - leg.hip.position.z;
      leg.hip.rotation.set(0, Math.atan2(-dz, dx), 0);
      const reach = Math.hypot(dx, dz);
      const solution = solveLeg(reach, dy, this.model.upperLength, this.model.lowerLength);
      leg.upper.rotation.set(0, 0, solution.hipPitch);
      leg.knee.rotation.set(0, 0, solution.kneePitch);
      leg.foot.rotation.set(0, 0, solution.footPitch);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.hpTexture.dispose();
    (this.hpBar.material as THREE.SpriteMaterial).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}
