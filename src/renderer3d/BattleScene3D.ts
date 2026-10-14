/** The 3D turn movie: a lit, post-processed arena that plays a deterministic
 *  movie timeline with legged robots, projectiles and a cinematic camera.
 *
 *  It consumes exactly what the 2D Pixi renderer consumes — `MovieTimeline`
 *  snapshots and their per-tick resolution events — and is driven by the same
 *  MoviePlayer clock, so playback, scrubbing, speed and idle compression keep
 *  their meaning. Wall-clock interpolation inside a beat is presentation only.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { MatchState, TileCoord, WeaponId } from "../engine/types";
import type { ParticipantResolutionEvent } from "../lib/net/protocol";
import type { MovieSnapshot, MovieTimeline } from "../renderer/animations";
import { planMovement } from "../renderer/motion";
import { buildArena, type ArenaBuild } from "./ArenaBuilder";
import { Effects3D } from "./Effects3D";
import {
  grenadeFlightSeconds,
  hash01,
  headingYaw,
  missileFlightSeconds,
  tileCenter,
  tracerFlightSeconds,
} from "./kinematics";
import { loadModelLibrary, type ModelLibrary } from "./models";
import { RobotRig } from "./RobotRig";

export type CameraMode = "director" | "free" | "overview";

export interface RenderOptions {
  readonly animate: boolean;
  readonly speed: number;
  readonly reducedMotion: boolean;
}

const EXPLOSIVES: ReadonlySet<WeaponId> = new Set(["missile-launcher", "grenade-launcher"]);

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, length(d) * 1.25);
      color.rgb *= mix(1.0 - strength, 1.0, v);
      gl_FragColor = color;
    }
  `,
};

interface Focus {
  readonly point: THREE.Vector3;
  readonly weight: number;
  readonly until: number;
}

export class BattleScene3D {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly controls: OrbitControls;
  private readonly effects = new Effects3D();
  private readonly rigs = new Map<string, RobotRig>();
  private readonly sun: THREE.DirectionalLight;
  private arena: ArenaBuild | null = null;
  private library: ModelLibrary | null = null;
  private frame = 0;
  private lastTime = 0;
  private now = 0;
  private speed = 1;
  private reducedMotion = false;
  private renderedIndex: number | null = null;
  private cameraMode: CameraMode = "director";
  private readonly focuses: Focus[] = [];
  private readonly cameraGoal = new THREE.Vector3();
  private readonly lookGoal = new THREE.Vector3();
  private readonly lookCurrent = new THREE.Vector3();
  private orbitAngle = 0;
  private disposed = false;
  private readonly beams: THREE.Mesh[] = [];
  private readonly scheduled: { at: number; run: () => void }[] = [];
  /** Capture mode: no rAF loop; frames advance only through `advance()`. */
  private manualClock = false;
  onCameraModeChange: ((mode: CameraMode) => void) | null = null;

  private constructor(
    private readonly host: HTMLElement,
    private readonly state: MatchState,
    private readonly timeline: MovieTimeline,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.canvas = this.renderer.domElement;
    this.canvas.dataset.movieCanvas = "true";
    this.canvas.dataset.movieRenderer = "3d";
    this.canvas.setAttribute("aria-label", "RoboArena 3D turn movie");
    this.canvas.setAttribute("role", "img");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    host.appendChild(this.canvas);

    const { width, height } = state.arena;
    this.camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 400);
    this.camera.position.set(width / 2, Math.max(width, height) * 0.95, height * 1.32);
    this.lookCurrent.set(width / 2, 0, height / 2);
    this.camera.lookAt(this.lookCurrent);

    // Night stadium: deep blue sky, warm floodlight key, cool fill.
    this.scene.background = new THREE.Color(0x0b0f16);
    this.scene.fog = new THREE.Fog(0x0b0f16, Math.max(width, height) * 1.2, Math.max(width, height) * 3.2);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0x8fb4ff, 0x2a2118, 0.55);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.0);
    this.sun.position.set(width * 0.15 - 8, 26, height * 0.05 - 6);
    this.sun.target.position.set(width / 2, 0, height / 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const span = Math.max(width, height) * 0.8;
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 90 });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 0.9);
    rim.position.set(width + 10, 14, height + 12);
    rim.target.position.set(width / 2, 0, height / 2);
    this.scene.add(rim, rim.target);
    this.scene.add(this.effects.group);

    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }),
    );
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(VignetteShader));
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 3;
    this.controls.maxDistance = Math.max(width, height) * 2.2;
    this.controls.target.copy(this.lookCurrent);
    this.controls.addEventListener("start", () => this.setCameraMode("free"));
  }

  /** Loads models, builds the arena and starts the render loop. */
  static async create(
    host: HTMLElement,
    state: MatchState,
    timeline: MovieTimeline,
    options: { readonly manualClock?: boolean } = {},
  ): Promise<BattleScene3D> {
    const scene = new BattleScene3D(host, state, timeline);
    if (options.manualClock === true) scene.manualClock = true;
    try {
      await scene.initialize();
    } catch (error) {
      scene.dispose();
      throw error;
    }
    return scene;
  }

  private async initialize(): Promise<void> {
    this.library = await loadModelLibrary();
    if (this.disposed) return;
    this.arena = buildArena(this.state.arena, this.library, this.renderer);
    this.scene.add(this.arena.group);
    this.addFloodlightBeams(this.arena.floodlights);
    // Warm up shaders so the first explosion does not hitch.
    this.resize();
    this.renderer.compile(this.scene, this.camera);
    this.lastTime = performance.now() / 1000;
    if (this.manualClock) return;
    const loop = () => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      this.tick();
    };
    this.frame = requestAnimationFrame(loop);
  }

  private addFloodlightBeams(lights: readonly THREE.Vector3[]): void {
    if (this.arena === null) return;
    const center = this.arena.center;
    for (const light of lights) {
      const length = light.distanceTo(center) * 0.9;
      const geometry = new THREE.ConeGeometry(2.6, length, 24, 1, true);
      geometry.translate(0, -length / 2, 0);
      const material = new THREE.MeshBasicMaterial({
        color: 0xfff1d0,
        transparent: true,
        opacity: 0.022,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(geometry, material);
      beam.position.copy(light);
      beam.lookAt(center);
      beam.rotateX(-Math.PI / 2);
      this.scene.add(beam);
      this.beams.push(beam);
      const spot = new THREE.SpotLight(0xfff0d8, 10, length * 1.6, 0.5, 0.9, 1.2);
      spot.position.copy(light);
      spot.target.position.copy(center);
      this.scene.add(spot, spot.target);
    }
  }

  setCameraMode(mode: CameraMode): void {
    if (mode === this.cameraMode) return;
    this.cameraMode = mode;
    this.controls.enabled = true;
    if (mode !== "free") this.controls.target.copy(this.lookCurrent);
    this.onCameraModeChange?.(mode);
  }

  /** Moves the camera toward (factor < 1) or away from its look target. */
  dolly(factor: number): void {
    this.setCameraMode("free");
    const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    const distance = THREE.MathUtils.clamp(offset.length(), this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
  }

  get mode(): CameraMode {
    return this.cameraMode;
  }

  resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private rigFor(id: string, robot: MovieSnapshot["robots"][string]): RobotRig | undefined {
    const existing = this.rigs.get(id);
    if (existing !== undefined) return existing;
    const model = this.library?.robots.get(robot.robotClass);
    if (model === undefined) return undefined;
    const rig = new RobotRig(id, model, robot.teamColor, {
      onFootfall: (at, heavy) => {
        if (!this.reducedMotion) this.effects.footfall(at, heavy);
      },
      onDetachTurret: (turret, velocity) => this.effects.throwPart(turret, velocity),
    });
    this.rigs.set(id, rig);
    this.scene.add(rig.root);
    return rig;
  }

  private worldOf(tile: TileCoord, y = 0.35): THREE.Vector3 {
    const centre = tileCenter(tile);
    return new THREE.Vector3(centre.x, y, centre.z);
  }

  private focus(point: THREE.Vector3, weight: number, seconds: number): void {
    this.focuses.push({ point: point.clone(), weight, until: this.now + seconds });
  }

  private after(seconds: number, run: () => void): void {
    if (seconds <= 0) run();
    else this.scheduled.push({ at: this.now + seconds, run });
  }

  /** Presents snapshot `index`; `animate` plays the beat, otherwise it snaps. */
  render(index: number, options: RenderOptions): void {
    const snapshot = this.timeline.snapshots[index];
    if (snapshot === undefined || this.library === null) return;
    const advanced = this.renderedIndex !== null && index === this.renderedIndex + 1;
    const previous = this.renderedIndex === null ? undefined : this.timeline.snapshots[this.renderedIndex];
    this.renderedIndex = index;
    this.speed = Math.max(0.01, options.speed);
    this.reducedMotion = options.reducedMotion;
    const animate = options.animate && advanced && !options.reducedMotion;
    const secs = (seconds: number) => seconds / this.speed;

    if (!advanced) {
      this.effects.clear();
      this.scheduled.length = 0;
      this.effects.clearDecals();
    }

    // Robots: visibility, posture, scan heading, position, HP, death.
    for (const rig of this.rigs.values()) rig.visible = false;
    for (const robot of Object.values(snapshot.robots)) {
      const rig = this.rigFor(robot.id, robot);
      if (rig === undefined) continue;
      const before = previous?.robots[robot.id];
      rig.visible = robot.position !== "dock";
      rig.root.visible = rig.visible;
      if (robot.position === "dock") continue;
      rig.setHp(robot.hp, robot.armor);
      rig.setPosture(robot.posture, animate);
      rig.setScanYaw(headingYaw(robot.scanHeading), animate);
      const from = before?.position;
      const plan =
        animate && from !== undefined && from !== "dock" ? planMovement(from, robot.position, this.speed) : null;
      if (plan !== null) {
        rig.moveTo(robot.position, plan.durationMs / 1000, plan.kind === "double-straight", this.now);
        this.focus(this.worldOf(robot.position, 0), 0.4, secs(0.6));
      } else if (
        !animate ||
        from === undefined ||
        from === "dock" ||
        from.x !== robot.position.x ||
        from.y !== robot.position.y
      ) {
        rig.place(robot.position, this.now);
      }
      if (!animate) {
        if (!robot.destroyed && rig.destroyed) this.effects.releaseThrown(rig.turret);
        rig.setDestroyed(robot.destroyed, false);
      }
      if (robot.destroyed && !animate && rig.destroyed) {
        // Keep wrecks smouldering when the viewer lands on a later tick.
        const at = () => rig.chestWorld();
        this.effects.burn(at, this.now + 6, 0.6);
      }
    }
    // Robots missing from the snapshot (lost from sight) disappear.
    for (const [id, rig] of this.rigs) {
      if (snapshot.robots[id] === undefined) rig.root.visible = false;
    }

    if (options.reducedMotion) return;
    this.playEvents(this.timeline.eventsByTick.get(snapshot.tick) ?? [], snapshot, animate, secs);
  }

  private playEvents(
    events: readonly ParticipantResolutionEvent[],
    snapshot: MovieSnapshot,
    animate: boolean,
    secs: (seconds: number) => number,
  ): void {
    const launches = new Map<string, number>();
    const flightByShot = new Map<string, number>();
    const rigOf = (id: string) => this.rigs.get(id);

    for (const event of events) {
      if (event.kind !== "projectile-launched") continue;
      const tiles = Math.hypot(event.target.x - event.from.x, event.target.y - event.from.y);
      const seconds =
        event.weapon === "missile-launcher"
          ? missileFlightSeconds(tiles)
          : event.weapon === "grenade-launcher"
            ? grenadeFlightSeconds(tiles)
            : tracerFlightSeconds(tiles);
      launches.set(event.projectileId, secs(seconds));
      flightByShot.set(`${event.shooterId}#${event.shotIndex}`, secs(seconds));
    }

    for (const event of events) {
      switch (event.kind) {
        case "fired": {
          const rig = rigOf(event.shooterId);
          if (rig === undefined) break;
          rig.snapAim(this.worldOf(event.target));
          this.focus(rig.groundPosition(), 1, secs(1.2));
          this.focus(this.worldOf(event.target, 0), 0.8, secs(1.2));
          break;
        }
        case "projectile-launched": {
          const rig = rigOf(event.shooterId);
          const to = this.worldOf(event.target, 0.3);
          const from = rig?.muzzleWorld(event.shotIndex) ?? this.worldOf(event.from, 0.5);
          const flight = launches.get(event.projectileId) ?? secs(0.2);
          const heavy = EXPLOSIVES.has(event.weapon);
          if (animate) {
            const stagger = secs((event.shotIndex % 3) * 0.05);
            this.after(stagger, () => {
              const muzzle = rig?.muzzleWorld(event.shotIndex) ?? from;
              this.effects.muzzleFlash(muzzle, to.clone().sub(muzzle), heavy);
              rig?.fireKick(heavy);
              if (event.weapon === "missile-launcher") {
                this.effects.launchMissile(muzzle, to.setY(0.15), flight, () => undefined);
              } else if (event.weapon === "grenade-launcher") {
                this.effects.lobGrenade(muzzle, to.setY(0.1), flight, () => undefined);
              } else {
                const color = event.weapon === "auto-rifle" ? 0xffb060 : event.weapon === "burst-gun" ? 0x9fe8ff : 0xffe3a0;
                this.effects.tracer(muzzle, to, flight, color);
              }
            });
          }
          break;
        }
        case "projectile-impacted": {
          const delay = launches.get(event.projectileId) ?? 0;
          const at = this.worldOf(event.target, 0.15);
          this.after(animate ? delay : 0, () => {
            if (event.outcome === "blast" || EXPLOSIVES.has(event.weapon)) {
              this.effects.explosion(at, event.weapon === "missile-launcher" ? 1.1 : 0.9);
              this.focus(at, 1.2, secs(1.4));
            } else if (event.outcome === "miss") {
              this.effects.dust(at.setY(0.05), 0.8);
            }
          });
          break;
        }
        case "shot-missed": {
          if (event.reason === "out-of-range" || event.reason === "no-target") break;
          const delay = flightByShot.get(`${event.shooterId}#${event.shotIndex}`) ?? 0;
          const jitter = (hash01(`${event.shooterId}${event.tick}`, event.shotIndex) - 0.5) * 0.7;
          const at = this.worldOf(event.target, 0.05).add(new THREE.Vector3(jitter, 0, -jitter * 0.6));
          if (animate) this.after(delay, () => this.effects.dust(at, 0.6));
          break;
        }
        case "damaged": {
          const rig = rigOf(event.targetId);
          if (rig === undefined) break;
          const source = event.sourceId === undefined ? undefined : rigOf(event.sourceId);
          const delay = flightByShot.get(`${event.sourceId ?? "?"}#${event.shotIndex}`) ?? 0;
          if (!animate) break;
          this.after(delay, () => {
            const from = source?.groundPosition() ?? rig.groundPosition().add(new THREE.Vector3(0, 0, -1));
            if (event.damageKind === "direct") this.effects.hitSparks(rig.chestWorld(), from);
            rig.flinch(from, Math.min(1.4, 0.4 + event.damage / 40));
            this.focus(rig.groundPosition(), 0.9, secs(1));
          });
          break;
        }
        case "destroyed": {
          const rig = rigOf(event.robotId);
          if (rig === undefined) break;
          // Deaths land after whatever shot caused them reaches the robot.
          let delay = 0;
          for (const other of events) {
            if (other.kind === "damaged" && other.targetId === event.robotId) {
              delay = Math.max(delay, flightByShot.get(`${other.sourceId ?? "?"}#${other.shotIndex}`) ?? 0);
            }
          }
          if (!animate) {
            rig.setDestroyed(true, false);
            break;
          }
          this.after(delay + secs(0.08), () => {
            const at = rig.chestWorld();
            this.effects.explosion(at, 1.35);
            rig.setDestroyed(true, true);
            this.effects.burn(() => rig.chestWorld(), this.now + 14, 1);
            this.focus(at, 2, secs(2.2));
          });
          break;
        }
        case "scan-target-acquired": {
          const target = rigOf(event.targetId);
          if (target !== undefined && animate) this.effects.lockOn(target.groundPosition().setY(0.04));
          break;
        }
        case "enemy-lost":
          if (animate) this.effects.ghostMarker(this.worldOf(event.lastSeenAt, 0.03));
          break;
        case "last-known-marker":
          if (animate) this.effects.ghostMarker(this.worldOf(event.at, 0.03));
          break;
        case "deployed": {
          const rig = rigOf(event.robotId);
          if (rig !== undefined && animate) {
            // Drop-in from above with a heavy landing.
            const at = this.worldOf(event.to, 0);
            rig.place(event.to, this.now);
            this.effects.footfall(at, true);
            this.effects.lockOn(at.setY(0.03), 0x6fe0ff);
          }
          break;
        }
        default:
          break;
      }
    }
    void snapshot;
  }

  /**
   * Deterministic frame stepping for automated captures: software GL in CI is
   * far too slow for real-time playback, so tests advance scene time in fixed
   * steps and render once at the end.
   */
  enableManualClock(): void {
    this.manualClock = true;
    cancelAnimationFrame(this.frame);
  }

  advance(seconds: number, step = 1 / 60): void {
    for (let t = 0; t < seconds - 1e-6; t += step) this.tick(step, false);
    this.composer.render(step);
  }

  /** Places the free camera (captures and debugging). */
  lookFrom(position: THREE.Vector3Like, target: THREE.Vector3Like): void {
    this.setCameraMode("free");
    this.camera.position.set(position.x, position.y, position.z);
    this.controls.target.set(target.x, target.y, target.z);
    this.controls.update();
  }

  private tick(fixedDt?: number, draw = true): void {
    let dt = fixedDt ?? 0;
    if (fixedDt === undefined) {
      const wall = performance.now() / 1000;
      dt = Math.min(0.1, Math.max(0, wall - this.lastTime));
      this.lastTime = wall;
    }
    this.now += dt;

    for (let i = this.scheduled.length - 1; i >= 0; i -= 1) {
      const item = this.scheduled[i];
      if (item !== undefined && item.at <= this.now) {
        this.scheduled.splice(i, 1);
        item.run();
      }
    }
    for (const rig of this.rigs.values()) rig.update(this.now, dt, this.speed);
    this.effects.update(dt * Math.min(2, Math.max(0.5, this.speed)));
    this.updateCamera(dt);
    if (draw) this.composer.render(dt);
  }

  private updateCamera(dt: number): void {
    const arena = this.arena;
    if (arena === null) return;
    const { width, height } = this.state.arena;
    const extent = Math.max(width, height);

    if (this.cameraMode === "free") {
      this.controls.update(dt);
      this.lookCurrent.copy(this.controls.target);
    } else {
      // Director: drift toward the weighted centre of recent action, framing it
      // from a high three-quarter angle that slowly orbits for parallax.
      for (let i = this.focuses.length - 1; i >= 0; i -= 1) {
        if ((this.focuses[i]?.until ?? 0) < this.now) this.focuses.splice(i, 1);
      }
      let weight = 0;
      const centroid = new THREE.Vector3();
      for (const focus of this.focuses) {
        centroid.addScaledVector(focus.point, focus.weight);
        weight += focus.weight;
      }
      let spread = 0;
      if (weight > 0 && this.cameraMode === "director") {
        centroid.divideScalar(weight);
        for (const focus of this.focuses) spread = Math.max(spread, focus.point.distanceTo(centroid));
        this.lookGoal.copy(centroid).lerp(arena.center, 0.08);
      } else {
        this.lookGoal.copy(arena.center);
        spread = extent * 0.6;
      }
      this.orbitAngle += dt * (this.cameraMode === "overview" ? 0.05 : 0.025);
      const overview = this.cameraMode === "overview" || weight === 0;
      const distance = overview
        ? extent * 1.25
        : THREE.MathUtils.clamp(spread * 1.9 + 5.5, 6.5, extent * 1.05);
      const elevation = overview ? 0.95 : 0.78;
      const azimuth = Math.sin(this.orbitAngle) * 0.45;
      this.cameraGoal.set(
        this.lookGoal.x + Math.sin(azimuth) * distance * Math.cos(elevation),
        this.lookGoal.y + Math.sin(elevation) * distance,
        this.lookGoal.z + Math.cos(azimuth) * distance * Math.cos(elevation),
      );
      const ease = 1 - Math.exp(-dt * (overview ? 0.9 : 1.6));
      this.camera.position.lerp(this.cameraGoal, ease);
      this.lookCurrent.lerp(this.lookGoal, 1 - Math.exp(-dt * 2.2));
      this.camera.lookAt(this.lookCurrent);
      this.controls.target.copy(this.lookCurrent);
    }

    // Screen shake from explosions and heavy landings.
    const shake = this.reducedMotion ? 0 : this.effects.shake;
    if (shake > 0.001) {
      const t = this.now * 60;
      this.camera.position.x += Math.sin(t * 1.3) * shake * 0.08;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * shake * 0.06;
      this.camera.position.z += Math.sin(t * 1.1 + 2) * shake * 0.08;
    }
    for (const beam of this.beams) {
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.02 + Math.sin(this.now * 0.7 + beam.id) * 0.004;
    }
  }

  /** Exposes a few live numbers for automated visual checks. */
  stats(): { robots: number; particles: number; drawCalls: number; triangles: number } {
    return {
      robots: [...this.rigs.values()].filter((rig) => rig.root.visible).length,
      particles: this.effects.particleCount,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    for (const rig of this.rigs.values()) rig.dispose();
    this.rigs.clear();
    this.effects.dispose();
    this.arena?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
