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
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type {
  Heading,
  MatchState,
  Posture,
  RobotClass,
  TileCoord,
  WeaponId,
} from "../engine/types";
import type { ParticipantResolutionEvent } from "../lib/net/protocol";
import {
  projectileFlightSeconds,
  type MovieSnapshot,
  type MovieTimeline,
} from "../renderer/animations";
import { planMovement } from "../renderer/motion";
import { buildArena, type ArenaBuild } from "./ArenaBuilder";
import { PlannerOverlays3D } from "./PlannerOverlays3D";
import { Effects3D } from "./Effects3D";
import {
  grenadeFlightSeconds,
  hash01,
  headingYaw,
  missileFlightSeconds,
  tileCenter,
  tracerFlightSeconds,
} from "./kinematics";
import {
  DEFAULT_ROBOT_FAMILY,
  loadModelLibrary,
  type ModelLibrary,
  type RobotFamily,
} from "./models";
import { RobotRig } from "./RobotRig";
import { preferredGraphicsQuality, type GraphicsQuality } from "./support";
import { ARENA_THEMES, DEFAULT_ARENA_THEME, type ArenaTheme, type ArenaThemeId } from "./themes";

/** A robot pose for the planner board (see `syncRobots`). */
export interface PlannedRobotPose {
  readonly id: string;
  readonly robotClass: RobotClass;
  readonly color: string;
  readonly position: TileCoord | "dock";
  readonly posture: Posture;
  readonly scanHeading: Heading;
}

export type CameraMode = "director" | "free" | "overview";

export interface RenderOptions {
  readonly animate: boolean;
  readonly speed: number;
  readonly reducedMotion: boolean;
}

/** How long a deploying robot falls from the sky, at 1x playback. */
const DEPLOY_DROP_SECONDS = 0.7;
/** The planner's quicker drop when a robot is first placed or rehearsed in. */
const PLANNER_DROP_SECONDS = 0.45;

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

/** Vertical sky gradient (zenith, mid, horizon) used as the scene background. */
const skyTexture = (stops: readonly [string, string, string]): THREE.Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    // The camera looks down on the arena, so only the top of the frame shows
    // sky: put the bright horizon band there and let it fall off into night.
    gradient.addColorStop(0, stops[1]);
    gradient.addColorStop(0.3, stops[2]);
    gradient.addColorStop(1, stops[0]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

/** Frame rate for pulsing route and target overlays while planning. */
const PLANNING_AMBIENT_FPS = 20;

export class BattleScene3D {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly ao: GTAOPass;
  private readonly controls: OrbitControls;
  private readonly effects = new Effects3D();
  private readonly rigs = new Map<string, RobotRig>();
  private readonly posed = new Map<string, TileCoord>();
  /** Planner robots last shown in the dock, so their deploy can drop in. */
  private readonly docked = new Set<string>();
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

  private readonly theme: ArenaTheme;
  private robotFamily: RobotFamily = DEFAULT_ROBOT_FAMILY;
  private motes: THREE.Points | null = null;
  private readonly ghosts: RobotRig[] = [];
  private cameraTween: {
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private viewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private quality: GraphicsQuality = "full";
  /**
   * While planning nothing moves on its own, so frames are drawn on demand:
   * after input, overlay or robot changes, camera motion, and at a low
   * ambient rate for pulsing overlays. Drawing every frame kept integrated
   * GPUs saturated, which queued pointer input and made the cursor trail.
   */
  private planning = false;
  private drawRequested = true;
  private drawUntil = 0;
  private shadowsUntil = 0;
  private lastDraw = -Infinity;
  private overlayVersion = -1;
  /** Planner overlays (routes, heatmaps, wedges) projected onto the floor. */
  readonly overlays = new PlannerOverlays3D();

  private constructor(
    private readonly host: HTMLElement,
    private readonly state: MatchState,
    private readonly timeline: MovieTimeline,
    themeId: ArenaThemeId,
  ) {
    this.theme = ARENA_THEMES[themeId];
    const theme = this.theme;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = theme.exposure;
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

    this.scene.background = skyTexture(theme.sky);
    this.scene.fog = new THREE.Fog(
      theme.fog.color,
      Math.max(theme.fog.near, Math.max(width, height) * 1.1),
      Math.max(theme.fog.far, Math.max(width, height) * 3),
    );
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = theme.environment;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
    const sunDistance = 30;
    this.sun.position.set(
      width / 2 + Math.cos(theme.sun.azimuth) * Math.cos(theme.sun.elevation) * sunDistance,
      Math.sin(theme.sun.elevation) * sunDistance,
      height / 2 + Math.sin(theme.sun.azimuth) * Math.cos(theme.sun.elevation) * sunDistance,
    );
    this.sun.target.position.set(width / 2, 0, height / 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const span = Math.max(width, height) * 0.8;
    Object.assign(this.sun.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: 1,
      far: 90,
    });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight(theme.rim.color, theme.rim.intensity);
    rim.position.set(width + 10, 14, height + 12);
    rim.target.position.set(width / 2, 0, height / 2);
    this.scene.add(rim, rim.target);
    this.scene.add(this.effects.group);
    this.scene.add(this.overlays.group);

    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }),
    );
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Ambient occlusion grounds robots and props: contact shadows in every crease.
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.blendIntensity = 0.9;
    this.ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1, scale: 1 });
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      theme.bloom.strength,
      theme.bloom.radius,
      theme.bloom.threshold,
    );
    this.composer.addPass(this.bloom);
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms["strength"]!.value = theme.vignette;
    this.composer.addPass(vignette);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 3;
    this.controls.maxDistance = Math.max(width, height) * 2.2;
    this.controls.target.copy(this.lookCurrent);
    this.controls.addEventListener("start", () => this.setCameraMode("free"));
    this.controls.addEventListener("change", () => this.requestDraw());
  }

  /** GPU name as the browser reports it, for picking a default quality. */
  gpuName(): string | null {
    const gl = this.renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    try {
      return String(gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL));
    } catch {
      return null;
    }
  }

  get graphicsQuality(): GraphicsQuality {
    return this.quality;
  }

  /** Switches between the full post-processing stack and a light one. */
  setGraphicsQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    const full = quality === "full";
    this.renderer.setPixelRatio(full ? Math.min(window.devicePixelRatio, 2) : 1);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples === (full ? 4 : 0)) continue;
      target.samples = full ? 4 : 0;
      target.dispose();
    }
    this.ao.enabled = full;
    this.bloom.enabled = full;
    const mapSize = full ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.type = full ? THREE.PCFShadowMap : THREE.BasicShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  /** Asks for a fresh frame, and keeps drawing for `seconds` while things settle. */
  private requestDraw(seconds = 0): void {
    this.drawRequested = true;
    this.drawUntil = Math.max(this.drawUntil, this.now + seconds);
  }

  /** Loads models, builds the arena and starts the render loop. */
  static async create(
    host: HTMLElement,
    state: MatchState,
    timeline: MovieTimeline,
    options: {
      readonly manualClock?: boolean;
      readonly theme?: ArenaThemeId;
      readonly robotFamily?: RobotFamily;
      readonly quality?: GraphicsQuality;
    } = {},
  ): Promise<BattleScene3D> {
    const scene = new BattleScene3D(host, state, timeline, options.theme ?? DEFAULT_ARENA_THEME);
    scene.setGraphicsQuality(options.quality ?? preferredGraphicsQuality(scene.gpuName()));
    scene.robotFamily = options.robotFamily ?? DEFAULT_ROBOT_FAMILY;
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
    this.library = await loadModelLibrary(this.theme.id, this.robotFamily);
    if (this.disposed) return;
    this.arena = buildArena(this.state.arena, this.library, this.renderer, this.theme);
    this.scene.add(this.arena.group);
    if (this.theme.floodlights !== null) this.addFloodlightBeams(this.arena.floodlights);
    this.addMotes();
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
      const flood = this.theme.floodlights;
      const material = new THREE.MeshBasicMaterial({
        color: flood?.color ?? 0xfff1d0,
        transparent: true,
        opacity: flood?.beam ?? 0.022,
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
      const spot = new THREE.SpotLight(
        flood?.color ?? 0xfff0d8,
        flood?.intensity ?? 10,
        length * 1.6,
        0.5,
        0.9,
        1.2,
      );
      spot.position.copy(light);
      spot.target.position.copy(center);
      this.scene.add(spot, spot.target);
    }
  }

  /** Slow drifting motes (dust, embers, data sparks) that give the air depth. */
  private addMotes(): void {
    const motes = this.theme.motes;
    if (motes === null) return;
    const { width, height } = this.state.arena;
    const positions = new Float32Array(motes.count * 3);
    for (let i = 0; i < motes.count; i += 1) {
      positions[i * 3] = hash01("mote-x", i) * (width + 8) - 4;
      positions[i * 3 + 1] = 0.2 + hash01("mote-y", i) * 4;
      positions[i * 3 + 2] = hash01("mote-z", i) * (height + 8) - 4;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: motes.color,
      size: motes.additive ? 0.06 : 0.05,
      transparent: true,
      opacity: motes.additive ? 0.8 : 0.55,
      depthWrite: false,
      blending: motes.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.motes = new THREE.Points(geometry, material);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
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
    const distance = THREE.MathUtils.clamp(
      offset.length(),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
    this.requestDraw();
  }

  get mode(): CameraMode {
    return this.cameraMode;
  }

  resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.ao.setSize(width, height);
    this.bloom.resolution.set(width, height);
    this.camera.aspect = width / height;
    const { top, right, bottom, left } = this.viewInsets;
    // Shift the lens centre into the area not covered by overlaid UI.
    if (top + right + bottom + left > 0)
      this.camera.setViewOffset(
        width,
        height,
        (right - left) / 2,
        (bottom - top) / 2,
        width,
        height,
      );
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.requestDraw();
  }

  /** CSS pixels of the canvas hidden behind overlaid UI; framing avoids them. */
  setViewInsets(insets: { top: number; right: number; bottom: number; left: number }): void {
    this.viewInsets = { ...insets };
    this.resize();
  }

  private rigFor(
    id: string,
    robot: Pick<MovieSnapshot["robots"][string], "robotClass" | "teamColor">,
  ): RobotRig | undefined {
    const existing = this.rigs.get(id);
    if (existing !== undefined) return existing;
    const model = this.library?.robots.get(robot.robotClass);
    if (model === undefined) return undefined;
    const rig = new RobotRig(
      id,
      model,
      robot.teamColor,
      {
        onFootfall: (at, heavy) => {
          if (!this.reducedMotion) this.effects.footfall(at, heavy);
        },
        onDetachTurret: (turret, velocity) => this.effects.throwPart(turret, velocity),
      },
      this.theme.robotGlow,
    );
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
    const previous =
      this.renderedIndex === null ? undefined : this.timeline.snapshots[this.renderedIndex];
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
        animate && from !== undefined && from !== "dock"
          ? planMovement(from, robot.position, this.speed)
          : null;
      if (plan !== null) {
        rig.moveTo(
          robot.position,
          plan.durationMs / 1000,
          plan.kind === "double-straight",
          this.now,
        );
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

    // Armed bombs hold their tiles until the snapshot that sees them explode.
    this.effects.syncBombs(
      snapshot.bombs.map((bomb) => ({ id: bomb.id, at: this.worldOf(bomb.at, 0) })),
    );

    if (options.reducedMotion) return;
    this.playEvents(this.timeline.eventsByTick.get(snapshot.tick) ?? [], snapshot, animate, secs);
  }

  /**
   * Plays the opening snapshot's beat when playback starts on it. The first
   * snapshot is shown statically on load, so without this its tick-0 events
   * (every robot deploying, under rules revision 5) would never animate.
   */
  playOpening(speed: number): void {
    if (this.renderedIndex !== 0 || this.reducedMotion) return;
    const snapshot = this.timeline.snapshots[0];
    if (snapshot === undefined) return;
    this.speed = Math.max(0.01, speed);
    const secs = (seconds: number) => seconds / this.speed;
    this.playEvents(this.timeline.eventsByTick.get(snapshot.tick) ?? [], snapshot, true, secs);
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
      // A projectile that lands on a later tick (rules revision 4) flies until
      // then; its impact event plays on arrival with no further delay.
      const seconds =
        projectileFlightSeconds(this.timeline.projectileImpactTicks, event) ??
        (event.weapon === "missile-launcher"
          ? missileFlightSeconds(tiles)
          : event.weapon === "grenade-launcher"
            ? grenadeFlightSeconds(tiles)
            : tracerFlightSeconds(tiles));
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
                const color =
                  event.weapon === "auto-rifle"
                    ? 0xffb060
                    : event.weapon === "burst-gun"
                      ? 0x9fe8ff
                      : 0xffe3a0;
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
          const at = this.worldOf(event.target, 0.05).add(
            new THREE.Vector3(jitter, 0, -jitter * 0.6),
          );
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
            const from =
              source?.groundPosition() ?? rig.groundPosition().add(new THREE.Vector3(0, 0, -1));
            if (event.damageKind === "direct") this.effects.hitSparks(rig.chestWorld(), from);
            if (event.damageKind === "zap") this.effects.zapArc(rig.chestWorld());
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
              delay = Math.max(
                delay,
                flightByShot.get(`${other.sourceId ?? "?"}#${other.shotIndex}`) ?? 0,
              );
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
          if (target !== undefined && animate)
            this.effects.lockOn(target.groundPosition().setY(0.04));
          break;
        }
        case "zapped":
          if (animate) this.effects.zapArc(this.worldOf(event.at, 0.35));
          break;
        case "bomb-placed":
          if (animate) this.effects.footfall(this.worldOf(event.at, 0), false);
          break;
        case "bomb-exploded": {
          const at = this.worldOf(event.at, 0.15);
          if (!animate) break;
          this.effects.explosion(at, 2);
          this.focus(at, 2, secs(2.2));
          break;
        }
        case "self-destructed": {
          // The Time Bomb's blast, a touch larger: the robot is the bomb.
          const at = this.worldOf(event.at, 0.35);
          if (!animate) break;
          this.effects.explosion(at, 2.4);
          this.focus(at, 2.3, secs(2.4));
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
            // Drop-in from the sky through a beacon, with a heavy landing.
            const at = this.worldOf(event.to, 0);
            const color = snapshot.robots[event.robotId]?.teamColor ?? 0x6fe0ff;
            const fall = secs(DEPLOY_DROP_SECONDS);
            rig.dropIn(event.to, fall, this.now);
            this.effects.deployBeam(at, color, fall);
            this.focus(at, 0.6, fall + secs(0.5));
            this.after(fall, () => this.effects.deployLanding(at, color));
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

  /** Faces a live robot's chassis toward a world yaw (planner poses). */
  faceRobot(id: string, yaw: number): void {
    this.rigs.get(id)?.faceYaw(yaw, false);
  }

  /** Host-relative CSS pixel position of a point above a tile (HTML anchoring). */
  screenOf(tile: TileCoord, height = 0.8): { x: number; y: number } {
    const point = this.worldOf(tile, height).project(this.camera);
    const rect = this.host.getBoundingClientRect();
    return { x: ((point.x + 1) / 2) * rect.width, y: ((1 - point.y) / 2) * rect.height };
  }

  /** Adds a hologram of a robot class at a tile: a planned destination. */
  addGhost(
    robotClass: RobotClass,
    color: string,
    tile: TileCoord,
    yaw: number,
    posture: Posture = "upright",
    opacity = 0.32,
  ): void {
    const model = this.library?.robots.get(robotClass);
    if (model === undefined) return;
    const ghost = new RobotRig(`ghost-${this.ghosts.length}`, model, color, {}, 0);
    ghost.place(tile, this.now);
    ghost.faceYaw(yaw, false);
    ghost.setScanYaw(yaw, false);
    ghost.setPosture(posture, false);
    ghost.makeHologram(color, opacity);
    this.ghosts.push(ghost);
    this.scene.add(ghost.root);
  }

  clearGhosts(): void {
    for (const ghost of this.ghosts) this.scene.remove(ghost.root);
    this.ghosts.length = 0;
  }

  /**
   * Planner camera presets. "top" looks straight down through a narrow lens so
   * the grid stays square; "tilt" leans back about 35 degrees to read cover.
   * Both frame the whole arena; `quarter` rotates the board in 90 degree steps
   * (0 = engine North at the top of the screen). Left-drag pans in both.
   */
  planView(view: "top" | "tilt" | "orbit", quarter = 0, animate = true): void {
    this.setCameraMode("free");
    const { width, height } = this.state.arena;
    const controls = this.controls;
    if (view === "orbit") {
      controls.enableRotate = true;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      this.setFov(38);
      const yaw = (quarter * Math.PI) / 2;
      const target = new THREE.Vector3(width / 2, 0, height / 2);
      const offset = new THREE.Vector3(Math.sin(yaw), 0.95, Math.cos(yaw)).multiplyScalar(
        Math.max(width, height),
      );
      this.moveCamera(target.clone().add(offset), target, animate);
      return;
    }
    controls.enableRotate = false;
    controls.zoomToCursor = true;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.screenSpacePanning = true;
    const fov = view === "top" ? 30 : 34;
    this.setFov(fov);
    const rect = this.host.getBoundingClientRect();
    const insets = this.viewInsets;
    const openWidth = Math.max(1, rect.width - insets.left - insets.right);
    const openHeight = Math.max(1, rect.height - insets.top - insets.bottom);
    const aspect = Math.max(0.3, openWidth / openHeight);
    // The lens spans the full canvas height; only the open fraction may hold the arena.
    const half =
      Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (openHeight / Math.max(1, rect.height));
    const rotated = quarter % 2 === 1;
    const spanX = (rotated ? height : width) + 1.5;
    const spanZ = (rotated ? width : height) + 1.5;
    const distance =
      Math.max(spanZ / 2 / half, spanX / 2 / (half * aspect)) * (view === "top" ? 1 : 1.08);
    const polar = view === "top" ? 0.0005 : THREE.MathUtils.degToRad(35);
    const yaw = (quarter * Math.PI) / 2;
    const target = new THREE.Vector3(width / 2, 0, height / 2);
    const position = new THREE.Vector3(
      target.x + Math.sin(yaw) * Math.sin(polar) * distance,
      Math.cos(polar) * distance,
      target.z + Math.cos(yaw) * Math.sin(polar) * distance,
    );
    // Straight down, the tiny polar offset toward `yaw` keeps that edge at the
    // bottom of the screen, so board North stays up for quarter 0.
    this.moveCamera(position, target, animate);
  }

  private moveCamera(position: THREE.Vector3, target: THREE.Vector3, animate: boolean): void {
    if (!animate || this.reducedMotion) {
      this.cameraTween = null;
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      this.requestDraw();
      return;
    }
    this.cameraTween = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: position,
      toTarget: target,
      start: this.now,
      duration: 0.45,
    };
  }

  private stepCameraTween(): void {
    const tween = this.cameraTween;
    if (tween === null) return;
    const t = Math.min(1, (this.now - tween.start) / tween.duration);
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    this.camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
    if (t >= 1) this.cameraTween = null;
  }

  /** Board tile under a client-space point, or null off the board. */
  tileAtClient(clientX: number, clientY: number): TileCoord | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floorPlane, new THREE.Vector3());
    if (hit === null) return null;
    const tile = { x: Math.floor(hit.x), y: Math.floor(hit.z) };
    const { width, height } = this.state.arena;
    return tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height ? null : tile;
  }

  /**
   * Shows exactly these robots, posed directly (planner board, not a movie).
   * Robots absent from the list are hidden.
   */
  syncRobots(robots: readonly PlannedRobotPose[], animate: boolean): void {
    // Robots step, settle their posture and kick up dust for a moment.
    this.requestDraw(1.5);
    this.shadowsUntil = this.now + 1.5;
    const seen = new Set<string>();
    for (const robot of robots) {
      const rig = this.rigFor(robot.id, { robotClass: robot.robotClass, teamColor: robot.color });
      if (rig === undefined) continue;
      seen.add(robot.id);
      rig.visible = robot.position !== "dock";
      rig.root.visible = rig.visible;
      if (robot.position === "dock") {
        this.docked.add(robot.id);
        this.posed.delete(robot.id);
        continue;
      }
      rig.setPosture(robot.posture, animate);
      rig.setScanYaw(headingYaw(robot.scanHeading), animate);
      const previous = this.posed.get(robot.id);
      const moved =
        previous === undefined ||
        previous.x !== robot.position.x ||
        previous.y !== robot.position.y;
      if (moved) {
        if (animate && previous !== undefined) rig.moveTo(robot.position, 0.22, false, this.now);
        else if (animate && this.docked.has(robot.id)) {
          rig.dropIn(robot.position, PLANNER_DROP_SECONDS, this.now, 3);
          this.effects.deployBeam(
            this.worldOf(robot.position, 0),
            robot.color,
            PLANNER_DROP_SECONDS,
          );
        } else rig.place(robot.position, this.now);
        this.docked.delete(robot.id);
        this.posed.set(robot.id, robot.position);
      }
      if (!animate || previous === undefined) rig.faceYaw(headingYaw(robot.scanHeading), false);
    }
    for (const [id, rig] of this.rigs) {
      if (seen.has(id)) continue;
      rig.visible = false;
      rig.root.visible = false;
      this.posed.delete(id);
    }
  }

  /** Planning look: drops the floodlight haze and dust so the floor reads cleanly. */
  setPlanningLook(on: boolean): void {
    this.planning = on;
    // The arena never moves while planning: re-render shadows only as robots change.
    this.renderer.shadowMap.autoUpdate = !on;
    this.renderer.shadowMap.needsUpdate = true;
    this.requestDraw();
    for (const beam of this.beams) beam.visible = !on;
    if (this.motes !== null) this.motes.visible = !on;
    // Floodlight glare is drama for the movie; while planning it hides the board.
    this.bloom.strength = this.theme.bloom.strength * (on ? 0.35 : 1);
    // A narrow top-down lens sits much further out than the movie camera.
    const { width, height } = this.state.arena;
    this.controls.maxDistance = Math.max(width, height) * (on ? 4.5 : 2.2);
    // Keep fog off the board when the camera stands far overhead.
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = Math.max(width, height) * (on ? 4 : 1.1);
      this.scene.fog.far = Math.max(width, height) * (on ? 9 : 3);
    }
  }

  /** Narrows or widens the lens; a narrow lens keeps top-down views nearly flat. */
  setFov(degrees: number): void {
    this.camera.fov = degrees;
    this.camera.updateProjectionMatrix();
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
    for (const ghost of this.ghosts) ghost.update(this.now, dt, this.speed);
    this.overlays.update(this.now);
    this.stepCameraTween();
    this.effects.update(dt * Math.min(2, Math.max(0.5, this.speed)));
    this.updateCamera(dt);
    if (!draw || (fixedDt === undefined && !this.wantsDraw())) return;
    if (this.planning && this.now < this.shadowsUntil) this.renderer.shadowMap.needsUpdate = true;
    this.drawRequested = false;
    this.lastDraw = this.now;
    this.composer.render(dt);
  }

  /** Movie frames always draw; planning frames only when something changed. */
  private wantsDraw(): boolean {
    if (!this.planning) return true;
    if (this.overlays.version !== this.overlayVersion) {
      this.overlayVersion = this.overlays.version;
      return true;
    }
    if (this.drawRequested || this.now < this.drawUntil || this.cameraTween !== null) return true;
    if (this.effects.particleCount > 0) return true;
    return this.overlays.animating && this.now - this.lastDraw >= 1 / PLANNING_AMBIENT_FPS;
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
        for (const focus of this.focuses)
          spread = Math.max(spread, focus.point.distanceTo(centroid));
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
    if (this.motes !== null) {
      const positions = this.motes.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i += 1) {
        const y = positions.getY(i) + dt * (0.05 + (i % 7) * 0.012);
        positions.setY(i, y > 4.2 ? 0.2 : y);
        positions.setX(i, positions.getX(i) + Math.sin(this.now * 0.4 + i) * dt * 0.08);
      }
      positions.needsUpdate = true;
    }
    for (const beam of this.beams) {
      (beam.material as THREE.MeshBasicMaterial).opacity =
        0.02 + Math.sin(this.now * 0.7 + beam.id) * 0.004;
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
