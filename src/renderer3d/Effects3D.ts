/** Battle effects for the 3D movie: GPU-billboard particles (fire, smoke,
 *  sparks, tracers), flying projectiles, bouncing debris, shockwaves, scorch
 *  decals and pooled flash lights.
 *
 *  Everything is presentation only and time-scaled by playback speed. Effects
 *  are spawned from resolved engine events and never influence them.
 */

import * as THREE from "three";

const MAX_PARTICLES = 6000;
const LIGHT_POOL = 6;
const DEBRIS_POOL = 260;

const particleVertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec4 iColor;
  attribute vec3 iMisc; // size, rotation, stretch
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    vec2 corner = position.xy;
    float size = iMisc.x;
    if (iMisc.z > 0.0) {
      vec3 v = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
      float speed = length(v.xy);
      vec2 dir = speed > 1e-4 ? v.xy / speed : vec2(0.0, 1.0);
      vec2 perp = vec2(-dir.y, dir.x);
      float len = size + speed * iMisc.z;
      mv.xy += dir * corner.y * len + perp * corner.x * size;
    } else {
      float c = cos(iMisc.y);
      float s = sin(iMisc.y);
      mv.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    }
    gl_Position = projectionMatrix * mv;
  }
`;

const particleFragment = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 tex = texture2D(map, vUv);
    gl_FragColor = vec4(vColor.rgb * tex.rgb, vColor.a * tex.a);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

const makeSpriteTexture = (kind: "glow" | "smoke"): THREE.Texture => {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context !== null) {
    if (kind === "glow") {
      const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.25, "rgba(255,255,255,0.75)");
      gradient.addColorStop(0.6, "rgba(255,255,255,0.18)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    } else {
      // Lumpy smoke puff: overlapping soft blobs, deterministic layout.
      for (let i = 0; i < 14; i += 1) {
        const a = i * 2.39996;
        const r = 10 + (i % 5) * 6;
        const x = 64 + Math.cos(a) * r * 0.9;
        const y = 64 + Math.sin(a) * r * 0.9;
        const radius = 30 - (i % 4) * 4;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        const shade = 200 + (i % 3) * 25;
        gradient.addColorStop(0, `rgba(${shade},${shade},${shade},0.32)`);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

interface Particle {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size0: number;
  size1: number;
  r0: number;
  g0: number;
  b0: number;
  r1: number;
  g1: number;
  b1: number;
  a0: number;
  a1: number;
  drag: number;
  gravity: number;
  rot: number;
  spin: number;
  stretch: number;
  /** Seconds before the particle appears (staggered bursts). */
  delay: number;
}

export interface ParticleSpec {
  readonly position: THREE.Vector3Like;
  readonly velocity?: THREE.Vector3Like;
  readonly life: number;
  readonly size: readonly [number, number];
  readonly color: readonly [THREE.ColorRepresentation, THREE.ColorRepresentation];
  readonly alpha: readonly [number, number];
  readonly drag?: number;
  readonly gravity?: number;
  readonly spin?: number;
  readonly stretch?: number;
  readonly delay?: number;
}

const tmpColor0 = new THREE.Color();
const tmpColor1 = new THREE.Color();

/** One blending mode's worth of billboards in a single instanced draw call. */
class ParticleLayer {
  readonly mesh: THREE.Mesh;
  private readonly particles: Particle[] = [];
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly color: Float32Array;
  private readonly misc: Float32Array;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly attributes: THREE.InstancedBufferAttribute[];

  constructor(texture: THREE.Texture, blending: THREE.Blending, renderOrder: number) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute("position", quad.getAttribute("position"));
    this.geometry.setAttribute("uv", quad.getAttribute("uv"));
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.color = new Float32Array(MAX_PARTICLES * 4);
    this.misc = new Float32Array(MAX_PARTICLES * 3);
    this.attributes = [
      new THREE.InstancedBufferAttribute(this.pos, 3),
      new THREE.InstancedBufferAttribute(this.vel, 3),
      new THREE.InstancedBufferAttribute(this.color, 4),
      new THREE.InstancedBufferAttribute(this.misc, 3),
    ];
    for (const attribute of this.attributes) attribute.setUsage(THREE.DynamicDrawUsage);
    const [iPos, iVel, iColor, iMisc] = this.attributes;
    this.geometry.setAttribute("iPos", iPos!);
    this.geometry.setAttribute("iVel", iVel!);
    this.geometry.setAttribute("iColor", iColor!);
    this.geometry.setAttribute("iMisc", iMisc!);
    this.geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  get count(): number {
    return this.particles.length;
  }

  spawn(spec: ParticleSpec): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    tmpColor0.set(spec.color[0]);
    tmpColor1.set(spec.color[1]);
    this.particles.push({
      px: spec.position.x,
      py: spec.position.y,
      pz: spec.position.z,
      vx: spec.velocity?.x ?? 0,
      vy: spec.velocity?.y ?? 0,
      vz: spec.velocity?.z ?? 0,
      age: 0,
      life: spec.life,
      size0: spec.size[0],
      size1: spec.size[1],
      r0: tmpColor0.r,
      g0: tmpColor0.g,
      b0: tmpColor0.b,
      r1: tmpColor1.r,
      g1: tmpColor1.g,
      b1: tmpColor1.b,
      a0: spec.alpha[0],
      a1: spec.alpha[1],
      drag: spec.drag ?? 0,
      gravity: spec.gravity ?? 0,
      rot: Math.random() * Math.PI * 2,
      spin: spec.spin ?? 0,
      stretch: spec.stretch ?? 0,
      delay: spec.delay ?? 0,
    });
  }

  clear(): void {
    this.particles.length = 0;
    this.geometry.instanceCount = 0;
  }

  update(dt: number): void {
    let write = 0;
    const alive: Particle[] = [];
    for (const p of this.particles) {
      if (p.delay > 0) {
        p.delay -= dt;
        alive.push(p);
        continue;
      }
      p.age += dt;
      if (p.age >= p.life) continue;
      alive.push(p);
      const damping = Math.exp(-p.drag * dt);
      p.vx *= damping;
      p.vy = p.vy * damping - p.gravity * dt;
      p.vz *= damping;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      if (p.gravity > 0 && p.py < 0.02) {
        p.py = 0.02;
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.rot += p.spin * dt;
      const t = p.age / p.life;
      const i3 = write * 3;
      const i4 = write * 4;
      this.pos[i3] = p.px;
      this.pos[i3 + 1] = p.py;
      this.pos[i3 + 2] = p.pz;
      this.vel[i3] = p.vx;
      this.vel[i3 + 1] = p.vy;
      this.vel[i3 + 2] = p.vz;
      this.color[i4] = p.r0 + (p.r1 - p.r0) * t;
      this.color[i4 + 1] = p.g0 + (p.g1 - p.g0) * t;
      this.color[i4 + 2] = p.b0 + (p.b1 - p.b0) * t;
      // Quick fade-in avoids popping, then ease to the end alpha.
      const fadeIn = Math.min(1, p.age / Math.min(0.05, p.life * 0.2));
      this.color[i4 + 3] = (p.a0 + (p.a1 - p.a0) * t) * fadeIn;
      this.misc[i3] = p.size0 + (p.size1 - p.size0) * Math.sqrt(t);
      this.misc[i3 + 1] = p.rot;
      this.misc[i3 + 2] = p.stretch;
      write += 1;
    }
    this.particles.length = 0;
    this.particles.push(...alive);
    this.geometry.instanceCount = write;
    for (const attribute of this.attributes) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, write * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

interface Projectile {
  readonly object: THREE.Object3D;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly arc: number;
  readonly duration: number;
  readonly kind: "missile" | "grenade";
  age: number;
  readonly onArrive: () => void;
  readonly light: number;
}

interface Debris {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly rotation: THREE.Euler;
  readonly spin: THREE.Vector3;
  readonly scale: number;
  age: number;
  life: number;
}

interface Flash {
  readonly light: THREE.PointLight;
  intensity: number;
  decay: number;
  follow: (() => THREE.Vector3) | null;
}

interface Ring {
  readonly mesh: THREE.Mesh;
  age: number;
  life: number;
  size: number;
}

interface Thrown {
  readonly object: THREE.Object3D;
  readonly velocity: THREE.Vector3;
  readonly spin: THREE.Vector3;
  resting: boolean;
}

export class Effects3D {
  readonly group = new THREE.Group();
  private readonly glow: ParticleLayer;
  private readonly smoke: ParticleLayer;
  private readonly glowTexture = makeSpriteTexture("glow");
  private readonly smokeTexture = makeSpriteTexture("smoke");
  private readonly flashes: Flash[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly debris: Debris[] = [];
  private readonly debrisMesh: THREE.InstancedMesh;
  private readonly rings: Ring[] = [];
  private readonly scorches: THREE.Mesh[] = [];
  private readonly scorchMaterial: THREE.MeshBasicMaterial;
  private readonly scorchGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly ringGeometry = new THREE.RingGeometry(0.85, 1, 48);
  private readonly missileTemplate: THREE.Object3D;
  private readonly grenadeTemplate: THREE.Object3D;
  private readonly thrown: Thrown[] = [];
  private readonly burners: { at: () => THREE.Vector3; until: number; strength: number }[] = [];
  /** Armed Time Bombs on the board, keyed by bomb id (see `syncBombs`). */
  private readonly bombs = new Map<string, THREE.Object3D>();
  private readonly bombTemplate: THREE.Object3D;
  /** Accumulated screen shake; the camera director reads and decays it. */
  shake = 0;
  private time = 0;

  constructor() {
    this.group.name = "effects";
    this.smoke = new ParticleLayer(this.smokeTexture, THREE.NormalBlending, 20);
    this.glow = new ParticleLayer(this.glowTexture, THREE.AdditiveBlending, 21);
    this.group.add(this.smoke.mesh, this.glow.mesh);

    for (let i = 0; i < LIGHT_POOL; i += 1) {
      const light = new THREE.PointLight(0xffa040, 0, 6, 2);
      light.castShadow = false;
      this.group.add(light);
      this.flashes.push({ light, intensity: 0, decay: 10, follow: null });
    }

    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.06, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.7, metalness: 0.5 }),
      DEBRIS_POOL,
    );
    this.debrisMesh.count = 0;
    this.debrisMesh.castShadow = true;
    this.debrisMesh.frustumCulled = false;
    this.group.add(this.debrisMesh);

    const scorchCanvas = document.createElement("canvas");
    scorchCanvas.width = 128;
    scorchCanvas.height = 128;
    const context = scorchCanvas.getContext("2d");
    if (context !== null) {
      const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
      gradient.addColorStop(0, "rgba(5,4,3,0.9)");
      gradient.addColorStop(0.5, "rgba(12,9,7,0.55)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);
    }
    this.scorchMaterial = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(scorchCanvas),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    // Projectile meshes.
    const missile = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.2, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8d4c8, metalness: 0.6, roughness: 0.3 }),
    );
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.025, 0.07, 10),
      new THREE.MeshStandardMaterial({ color: 0xe0a020, metalness: 0.3, roughness: 0.4 }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.135;
    const tail = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd080 }),
    );
    tail.position.z = -0.11;
    missile.add(body, nose, tail);
    this.missileTemplate = missile;
    const grenade = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x3d4a2a, metalness: 0.4, roughness: 0.5 }),
    );
    this.grenadeTemplate = grenade;
    const bomb = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.5, roughness: 0.45 }),
    );
    shell.position.y = 0.13;
    shell.castShadow = true;
    const fuse = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4d3d }),
    );
    fuse.position.set(0.06, 0.28, 0);
    bomb.add(shell, fuse);
    this.bombTemplate = bomb;
  }

  get particleCount(): number {
    return this.glow.count + this.smoke.count;
  }

  /** Drops every live effect (seek / scrub / restart). Thrown wreck parts are kept. */
  clear(): void {
    this.glow.clear();
    this.smoke.clear();
    for (const projectile of this.projectiles) projectile.object.removeFromParent();
    this.projectiles.length = 0;
    this.debris.length = 0;
    this.debrisMesh.count = 0;
    for (const ring of this.rings) ring.mesh.removeFromParent();
    this.rings.length = 0;
    for (const flash of this.flashes) {
      flash.intensity = 0;
      flash.light.intensity = 0;
      flash.follow = null;
    }
    this.burners.length = 0;
    this.shake = 0;
  }

  /** Clears scorch marks too: used when the movie jumps backwards. */
  clearDecals(): void {
    for (const scorch of this.scorches) scorch.removeFromParent();
    this.scorches.length = 0;
  }

  private flash(
    at: THREE.Vector3Like,
    color: THREE.ColorRepresentation,
    intensity: number,
    decay: number,
    distance = 6,
    follow: (() => THREE.Vector3) | null = null,
  ): number {
    // Reuse the dimmest light so the pool never changes the shader light count.
    let index = 0;
    for (let i = 1; i < this.flashes.length; i += 1) {
      if ((this.flashes[i]?.intensity ?? 0) < (this.flashes[index]?.intensity ?? 0)) index = i;
    }
    const flash = this.flashes[index];
    if (flash === undefined) return -1;
    flash.light.position.set(at.x, at.y, at.z);
    flash.light.color.set(color);
    flash.light.distance = distance;
    flash.intensity = intensity;
    flash.decay = decay;
    flash.follow = follow;
    return index;
  }

  muzzleFlash(at: THREE.Vector3, direction: THREE.Vector3, heavy: boolean): void {
    const dir = direction.clone().normalize();
    this.flash(at, 0xffc070, heavy ? 22 : 12, 22, 4);
    this.glow.spawn({
      position: at,
      life: 0.07,
      size: [heavy ? 0.42 : 0.3, heavy ? 0.6 : 0.4],
      color: [0xfff4d0, 0xff9a30],
      alpha: [1, 0],
    });
    for (let i = 0; i < (heavy ? 10 : 6); i += 1) {
      const spread = 0.35;
      const v = dir
        .clone()
        .multiplyScalar(3 + Math.random() * 3)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * spread * 4,
            (Math.random() - 0.5) * spread * 4,
            (Math.random() - 0.5) * spread * 4,
          ),
        );
      this.glow.spawn({
        position: at,
        velocity: v,
        life: 0.06 + Math.random() * 0.06,
        size: [0.1, 0.03],
        color: [0xffe6a0, 0xff6a10],
        alpha: [1, 0],
        drag: 8,
        stretch: 0.03,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      this.smoke.spawn({
        position: at,
        velocity: dir
          .clone()
          .multiplyScalar(0.6 + Math.random() * 0.5)
          .setY(0.25 + Math.random() * 0.2),
        life: 0.7 + Math.random() * 0.5,
        size: [0.1, 0.42],
        color: [0x9a958c, 0x55524d],
        alpha: [0.35, 0],
        drag: 2.5,
        spin: (Math.random() - 0.5) * 2,
      });
    }
  }

  /** A bullet tracer streaking from muzzle to target. */
  tracer(from: THREE.Vector3, to: THREE.Vector3, seconds: number, color = 0xffd27a): void {
    const velocity = to.clone().sub(from).divideScalar(Math.max(0.016, seconds));
    this.glow.spawn({
      position: from,
      velocity,
      life: seconds,
      size: [0.05, 0.05],
      color: [color, 0xffffff],
      alpha: [1, 0.9],
      stretch: 0.045,
    });
    this.glow.spawn({
      position: from,
      velocity,
      life: seconds,
      size: [0.14, 0.12],
      color: [0xff9a40, 0xff6a10],
      alpha: [0.45, 0.3],
    });
  }

  launchMissile(
    from: THREE.Vector3,
    to: THREE.Vector3,
    seconds: number,
    onArrive: () => void,
  ): void {
    const object = this.missileTemplate.clone(true);
    object.position.copy(from);
    this.group.add(object);
    const light = this.flash(from, 0xffa040, 8, 0, 3);
    this.projectiles.push({
      object,
      from: from.clone(),
      to: to.clone(),
      arc: 0.6 + from.distanceTo(to) * 0.08,
      duration: seconds,
      kind: "missile",
      age: 0,
      onArrive,
      light,
    });
    // Launch backblast.
    for (let i = 0; i < 8; i += 1) {
      this.smoke.spawn({
        position: from,
        velocity: {
          x: (Math.random() - 0.5) * 1.6,
          y: 0.2 + Math.random() * 0.6,
          z: (Math.random() - 0.5) * 1.6,
        },
        life: 1 + Math.random() * 0.8,
        size: [0.15, 0.6],
        color: [0xc8c0b0, 0x6d6862],
        alpha: [0.45, 0],
        drag: 2,
        spin: (Math.random() - 0.5) * 2,
      });
    }
  }

  lobGrenade(from: THREE.Vector3, to: THREE.Vector3, seconds: number, onArrive: () => void): void {
    const object = this.grenadeTemplate.clone(true);
    object.position.copy(from);
    this.group.add(object);
    this.projectiles.push({
      object,
      from: from.clone(),
      to: to.clone(),
      arc: 1.2 + from.distanceTo(to) * 0.12,
      duration: seconds,
      kind: "grenade",
      age: 0,
      onArrive,
      light: -1,
    });
  }

  explosion(at: THREE.Vector3, scale: number): void {
    const big = scale >= 1;
    this.flash(at.clone().setY(at.y + 0.4), 0xff8a30, big ? 30 : 12, big ? 5 : 9, big ? 8 : 5);
    this.shake = Math.min(1.2, this.shake + (big ? 0.65 : 0.18) * scale);
    // Core flash.
    this.glow.spawn({
      position: at,
      life: big ? 0.18 : 0.1,
      size: [0.45 * scale, 1.15 * scale],
      color: [0xfff4e0, 0xffa030],
      alpha: [0.85, 0],
    });
    // Fireball: layered additive puffs from white-hot to deep orange.
    const fireCount = Math.round(26 * scale);
    for (let i = 0; i < fireCount; i += 1) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.9,
        Math.random() - 0.5,
      ).normalize();
      this.glow.spawn({
        position: { x: at.x + dir.x * 0.1, y: at.y + 0.1 + dir.y * 0.1, z: at.z + dir.z * 0.1 },
        velocity: dir.multiplyScalar((1.2 + Math.random() * 2.4) * scale),
        life: 0.35 + Math.random() * 0.4,
        size: [0.25 * scale, (0.55 + Math.random() * 0.4) * scale],
        color: [i % 3 === 0 ? 0xfff2c0 : 0xffa030, 0xa02008],
        alpha: [0.95, 0],
        drag: 3.5,
        spin: (Math.random() - 0.5) * 3,
        delay: Math.random() * 0.05,
      });
    }
    // Sparks.
    for (let i = 0; i < Math.round(28 * scale); i += 1) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.8 + 0.2,
        Math.random() - 0.5,
      ).normalize();
      this.glow.spawn({
        position: at,
        velocity: dir.multiplyScalar(3 + Math.random() * 5 * scale),
        life: 0.4 + Math.random() * 0.6,
        size: [0.035, 0.015],
        color: [0xffe8a0, 0xff5010],
        alpha: [1, 0.2],
        gravity: 6,
        drag: 1.2,
        stretch: 0.04,
      });
    }
    // Smoke column: rises, spreads, lingers.
    for (let i = 0; i < Math.round(18 * scale); i += 1) {
      this.smoke.spawn({
        position: {
          x: at.x + (Math.random() - 0.5) * 0.4 * scale,
          y: at.y + 0.2,
          z: at.z + (Math.random() - 0.5) * 0.4 * scale,
        },
        velocity: {
          x: (Math.random() - 0.5) * 0.8,
          y: 0.5 + Math.random() * 0.9,
          z: (Math.random() - 0.5) * 0.8,
        },
        life: 1.6 + Math.random() * 1.6,
        size: [0.3 * scale, (1.0 + Math.random() * 0.6) * scale],
        color: [0x5a524a, 0x2a2826],
        alpha: [0.75, 0],
        drag: 1.4,
        spin: (Math.random() - 0.5) * 1.2,
        delay: 0.05 + Math.random() * 0.15,
      });
    }
    this.debrisBurst(at, Math.round(14 * scale), 2.5 + 2 * scale);
    this.shockwave(at, big ? 2.2 * scale : 0.9, big ? 0.45 : 0.3);
    this.scorch(at, big ? 1.5 * scale : 0.7);
  }

  hitSparks(at: THREE.Vector3, from: THREE.Vector3): void {
    const back = at.clone().sub(from).setY(0).normalize().negate();
    this.flash(at, 0xffd080, 10, 14, 3);
    this.glow.spawn({
      position: at,
      life: 0.08,
      size: [0.25, 0.4],
      color: [0xffffff, 0xffc060],
      alpha: [1, 0],
    });
    for (let i = 0; i < 16; i += 1) {
      const v = back
        .clone()
        .multiplyScalar(2 + Math.random() * 3)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            Math.random() * 3,
            (Math.random() - 0.5) * 4,
          ),
        );
      this.glow.spawn({
        position: at,
        velocity: v,
        life: 0.25 + Math.random() * 0.35,
        size: [0.03, 0.012],
        color: [0xfff0c0, 0xff7020],
        alpha: [1, 0.1],
        gravity: 7,
        stretch: 0.035,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      this.smoke.spawn({
        position: at,
        velocity: { x: back.x * 0.4, y: 0.3 + Math.random() * 0.3, z: back.z * 0.4 },
        life: 0.8,
        size: [0.12, 0.4],
        color: [0x6e6a64, 0x3a3836],
        alpha: [0.4, 0],
        drag: 2,
      });
    }
    this.debrisBurst(at, 4, 2.5);
  }

  /** A miss kicks up dirt where the round lands. */
  dust(at: THREE.Vector3, amount = 1): void {
    for (let i = 0; i < Math.round(7 * amount); i += 1) {
      this.smoke.spawn({
        position: {
          x: at.x + (Math.random() - 0.5) * 0.2,
          y: 0.05,
          z: at.z + (Math.random() - 0.5) * 0.2,
        },
        velocity: {
          x: (Math.random() - 0.5) * 1.2 * amount,
          y: 0.4 + Math.random() * 0.8,
          z: (Math.random() - 0.5) * 1.2 * amount,
        },
        life: 0.6 + Math.random() * 0.6,
        size: [0.1 * amount, 0.45 * amount],
        color: [0x8a7a62, 0x5a4e3e],
        alpha: [0.6, 0],
        drag: 3,
        gravity: 0.6,
        spin: (Math.random() - 0.5) * 2,
      });
    }
  }

  footfall(at: THREE.Vector3, heavy: boolean): void {
    const count = heavy ? 10 : 1;
    if (!heavy && Math.random() > 0.35) return;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + Math.random();
      this.smoke.spawn({
        position: { x: at.x, y: 0.03, z: at.z },
        velocity: {
          x: Math.cos(angle) * (heavy ? 1.4 : 0.3),
          y: 0.15,
          z: Math.sin(angle) * (heavy ? 1.4 : 0.3),
        },
        life: heavy ? 0.7 : 0.45,
        size: [0.08, heavy ? 0.42 : 0.2],
        color: [0x8a7d68, 0x5a5044],
        alpha: [heavy ? 0.5 : 0.25, 0],
        drag: 4,
      });
    }
    if (heavy) this.shake = Math.min(1, this.shake + 0.06);
  }

  /** Hologram reticle closing on a scan-locked target. */
  lockOn(at: THREE.Vector3, color: THREE.ColorRepresentation = 0xff3b30): void {
    this.shockwave(at.clone().setY(0.03), 0.55, 0.45, color, true);
    this.glow.spawn({
      position: at.clone().setY(at.y + 0.1),
      life: 0.4,
      size: [0.5, 0.15],
      color: [color, color],
      alpha: [0.8, 0],
    });
  }

  /**
   * Deploy beacon: a team-coloured landing ring and a light column that the
   * robot falls through over `seconds`.
   */
  deployBeam(at: THREE.Vector3, color: THREE.ColorRepresentation, seconds: number): void {
    const ground = at.clone().setY(0.03);
    this.shockwave(ground, 0.7, seconds, color, true);
    this.flash(at.clone().setY(1.2), color, 8, 3, 5);
    for (let i = 0; i < 16; i += 1) {
      const y = 0.2 + (i / 16) * 5;
      this.glow.spawn({
        position: {
          x: at.x + (Math.random() - 0.5) * 0.1,
          y,
          z: at.z + (Math.random() - 0.5) * 0.1,
        },
        velocity: { x: 0, y: -3 - Math.random() * 2, z: 0 },
        life: seconds * (0.6 + Math.random() * 0.4),
        size: [0.22, 0.06],
        color: [0xffffff, color],
        alpha: [0.55, 0],
        stretch: 0.08,
        delay: Math.random() * seconds * 0.3,
      });
    }
  }

  /** Landing burst under a robot that just deployed. */
  deployLanding(at: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.dust(at, 1.4);
    this.shockwave(at.clone().setY(0.03), 1.1, 0.5, color, true);
    this.flash(at.clone().setY(0.4), color, 10, 9, 4);
    this.shake = Math.min(1, this.shake + 0.12);
  }

  /** Ghost marker where an enemy was last seen. */
  ghostMarker(at: THREE.Vector3): void {
    this.shockwave(at.clone().setY(0.03), 0.45, 0.9, 0x9a9aff, true);
  }

  /** Electric crackle of a Zap on the zapper's tile. */
  zapArc(at: THREE.Vector3): void {
    this.flash(at.clone().setY(at.y + 0.3), 0x7fdcff, 14, 16, 3);
    this.glow.spawn({
      position: at,
      life: 0.12,
      size: [0.3, 0.6],
      color: [0xffffff, 0x7fdcff],
      alpha: [1, 0],
    });
    for (let i = 0; i < 22; i += 1) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.8,
        Math.random() - 0.5,
      ).normalize();
      this.glow.spawn({
        position: at,
        velocity: dir.multiplyScalar(2 + Math.random() * 3),
        life: 0.15 + Math.random() * 0.25,
        size: [0.03, 0.01],
        color: [0xe8fbff, 0x4fa8ff],
        alpha: [1, 0.1],
        drag: 4,
        stretch: 0.05,
      });
    }
    this.shockwave(at.clone().setY(0.03), 0.5, 0.25, 0x7fdcff, true);
  }

  /** Shows exactly the given armed bombs, adding and removing markers as needed. */
  syncBombs(bombs: readonly { readonly id: string; readonly at: THREE.Vector3 }[]): void {
    const wanted = new Set(bombs.map((bomb) => bomb.id));
    for (const [id, object] of this.bombs) {
      if (wanted.has(id)) continue;
      object.removeFromParent();
      this.bombs.delete(id);
    }
    for (const bomb of bombs) {
      let object = this.bombs.get(bomb.id);
      if (object === undefined) {
        object = this.bombTemplate.clone();
        this.bombs.set(bomb.id, object);
        this.group.add(object);
      }
      object.position.set(bomb.at.x, 0, bomb.at.z);
    }
  }

  /** Keeps a wreck smouldering until `until` (scene seconds). */
  burn(at: () => THREE.Vector3, until: number, strength = 1): void {
    this.burners.push({ at, until, strength });
  }

  /** Throws a detached part (a destroyed robot's turret) with simple physics. */
  throwPart(object: THREE.Object3D, velocity: THREE.Vector3): void {
    const world = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    object.getWorldPosition(world);
    object.getWorldQuaternion(quaternion);
    object.removeFromParent();
    object.position.copy(world);
    object.quaternion.copy(quaternion);
    this.group.add(object);
    this.thrown.push({
      object,
      velocity: velocity.clone(),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 12,
      ),
      resting: false,
    });
  }

  private debrisBurst(at: THREE.Vector3, count: number, speed: number): void {
    for (let i = 0; i < count; i += 1) {
      if (this.debris.length >= DEBRIS_POOL) this.debris.shift();
      this.debris.push({
        position: at.clone().setY(Math.max(0.05, at.y)),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * speed,
          1.5 + Math.random() * speed,
          (Math.random() - 0.5) * speed,
        ),
        rotation: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 20,
        ),
        scale: 0.5 + Math.random() * 1.2,
        age: 0,
        life: 2.5 + Math.random() * 1.5,
      });
    }
  }

  private shockwave(
    at: THREE.Vector3,
    size: number,
    life: number,
    color: THREE.ColorRepresentation = 0xffc080,
    ground = false,
  ): void {
    const mesh = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, ground ? at.y : 0.05, at.z);
    mesh.renderOrder = 19;
    this.group.add(mesh);
    this.rings.push({ mesh, age: 0, life, size });
  }

  private scorch(at: THREE.Vector3, size: number): void {
    const mesh = new THREE.Mesh(this.scorchGeometry, this.scorchMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(at.x, 0.006 + this.scorches.length * 0.0002, at.z);
    mesh.scale.setScalar(size);
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.scorches.push(mesh);
    if (this.scorches.length > 80) this.scorches.shift()?.removeFromParent();
  }

  update(dt: number): void {
    this.time += dt;
    // Projectiles.
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const p = this.projectiles[i];
      if (p === undefined) continue;
      p.age += dt;
      const u = Math.min(1, p.age / p.duration);
      const previous = p.object.position.clone();
      const eased = p.kind === "missile" ? u * u * (1.6 - 0.6 * u) : u;
      p.object.position.lerpVectors(p.from, p.to, eased);
      p.object.position.y += Math.sin(Math.PI * eased) * p.arc;
      const heading = p.object.position.clone().sub(previous);
      if (heading.lengthSq() > 1e-8) p.object.lookAt(p.object.position.clone().add(heading));
      if (p.kind === "missile") {
        const flash = this.flashes[p.light];
        if (flash !== undefined) {
          flash.light.position.copy(p.object.position);
          flash.intensity = 6;
        }
        const back = heading.clone().normalize().multiplyScalar(-0.12);
        this.glow.spawn({
          position: p.object.position.clone().add(back),
          life: 0.12,
          size: [0.14, 0.05],
          color: [0xfff0b0, 0xff6010],
          alpha: [1, 0],
        });
        this.smoke.spawn({
          position: p.object.position.clone().add(back),
          velocity: { x: (Math.random() - 0.5) * 0.2, y: 0.15, z: (Math.random() - 0.5) * 0.2 },
          life: 1.4 + Math.random() * 0.6,
          size: [0.08, 0.38],
          color: [0xd8d2c6, 0x77726b],
          alpha: [0.55, 0],
          drag: 1.5,
          spin: (Math.random() - 0.5) * 2,
        });
      } else if (Math.random() < 0.5) {
        this.smoke.spawn({
          position: p.object.position,
          life: 0.5,
          size: [0.04, 0.16],
          color: [0xa09a90, 0x6a6660],
          alpha: [0.35, 0],
        });
      }
      if (u >= 1) {
        p.object.removeFromParent();
        const flash = this.flashes[p.light];
        if (flash !== undefined) flash.intensity = 0;
        this.projectiles.splice(i, 1);
        p.onArrive();
      }
    }

    // Flash lights decay.
    for (const flash of this.flashes) {
      if (flash.follow !== null) flash.light.position.copy(flash.follow());
      flash.intensity *= Math.exp(-flash.decay * dt);
      if (flash.intensity < 0.05) flash.intensity = 0;
      flash.light.intensity = flash.intensity;
    }

    // Burning wrecks.
    for (let i = this.burners.length - 1; i >= 0; i -= 1) {
      const burner = this.burners[i];
      if (burner === undefined) continue;
      if (this.time > burner.until) {
        this.burners.splice(i, 1);
        continue;
      }
      const at = burner.at();
      if (Math.random() < dt * 22 * burner.strength) {
        this.glow.spawn({
          position: {
            x: at.x + (Math.random() - 0.5) * 0.25,
            y: at.y + 0.05,
            z: at.z + (Math.random() - 0.5) * 0.25,
          },
          velocity: { x: 0, y: 0.5 + Math.random() * 0.5, z: 0 },
          life: 0.35 + Math.random() * 0.3,
          size: [0.18, 0.05],
          color: [0xffc050, 0xc02808],
          alpha: [0.85, 0],
          drag: 1,
        });
      }
      if (Math.random() < dt * 10 * burner.strength) {
        this.smoke.spawn({
          position: { x: at.x, y: at.y + 0.25, z: at.z },
          velocity: {
            x: 0.15 + (Math.random() - 0.5) * 0.2,
            y: 0.6 + Math.random() * 0.4,
            z: (Math.random() - 0.5) * 0.2,
          },
          life: 2.2 + Math.random(),
          size: [0.18, 0.9],
          color: [0x3c3834, 0x1c1b1a],
          alpha: [0.6, 0],
          drag: 0.6,
          spin: Math.random() - 0.5,
        });
      }
    }

    // Debris physics.
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let write = 0;
    for (let i = this.debris.length - 1; i >= 0; i -= 1) {
      const d = this.debris[i];
      if (d === undefined) continue;
      d.age += dt;
      if (d.age > d.life) {
        this.debris.splice(i, 1);
        continue;
      }
      d.velocity.y -= 9.8 * dt;
      d.position.addScaledVector(d.velocity, dt);
      if (d.position.y < 0.02) {
        d.position.y = 0.02;
        d.velocity.y = Math.abs(d.velocity.y) * 0.35;
        d.velocity.x *= 0.55;
        d.velocity.z *= 0.55;
        d.spin.multiplyScalar(0.6);
      }
      d.rotation.x += d.spin.x * dt;
      d.rotation.y += d.spin.y * dt;
      d.rotation.z += d.spin.z * dt;
      const fade = Math.min(1, (d.life - d.age) / 0.6);
      quaternion.setFromEuler(d.rotation);
      scale.setScalar(d.scale * fade);
      matrix.compose(d.position, quaternion, scale);
      this.debrisMesh.setMatrixAt(write, matrix);
      write += 1;
    }
    this.debrisMesh.count = write;
    this.debrisMesh.instanceMatrix.needsUpdate = true;

    // Thrown wreck parts.
    for (const part of this.thrown) {
      if (part.resting) continue;
      part.velocity.y -= 9.8 * dt;
      part.object.position.addScaledVector(part.velocity, dt);
      part.object.rotation.x += part.spin.x * dt;
      part.object.rotation.y += part.spin.y * dt;
      part.object.rotation.z += part.spin.z * dt;
      if (part.object.position.y < 0.06) {
        part.object.position.y = 0.06;
        if (Math.abs(part.velocity.y) < 1.2) {
          part.resting = true;
          continue;
        }
        part.velocity.y = Math.abs(part.velocity.y) * 0.3;
        part.velocity.x *= 0.5;
        part.velocity.z *= 0.5;
        part.spin.multiplyScalar(0.5);
        this.dust(part.object.position, 0.6);
      }
    }

    // Shockwave rings.
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i];
      if (ring === undefined) continue;
      ring.age += dt;
      const t = ring.age / ring.life;
      if (t >= 1) {
        ring.mesh.removeFromParent();
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const s = ring.size * (0.2 + 0.8 * (1 - Math.pow(1 - t, 3)));
      ring.mesh.scale.setScalar(s);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    }

    this.glow.update(dt);
    this.smoke.update(dt);
    this.shake *= Math.exp(-dt * 4);
  }

  /** Returns detached turrets to their robots' control (seek backwards). */
  releaseThrown(object: THREE.Object3D): void {
    const index = this.thrown.findIndex((part) => part.object === object);
    if (index >= 0) this.thrown.splice(index, 1);
  }

  dispose(): void {
    this.clear();
    this.clearDecals();
    this.syncBombs([]);
    this.bombTemplate.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.glow.dispose();
    this.smoke.dispose();
    this.glowTexture.dispose();
    this.smokeTexture.dispose();
    this.debrisMesh.geometry.dispose();
    (this.debrisMesh.material as THREE.Material).dispose();
    this.scorchGeometry.dispose();
    this.ringGeometry.dispose();
    this.scorchMaterial.map?.dispose();
    this.scorchMaterial.dispose();
    this.group.removeFromParent();
  }
}
