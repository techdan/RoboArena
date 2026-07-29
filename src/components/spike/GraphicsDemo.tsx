"use client";

/**
 * ⚠️  THROWAWAY SPIKE — NOT PRODUCTION CODE ⚠️
 *
 * A/B bench for docs/graphics-plan.md. Rev 2: the board is now a single
 * continuously-baked ground image plus autotiled wall structures and bush
 * props, rather than a grid of independently generated tiles. See
 * scripts/spike/generate-demo-terrain.mjs for why.
 *
 * Desktop only. Delete with public/spike/ and scripts/spike/ when done.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Application, Container, Sprite, Texture } from "pixi.js";
import type { Terrain } from "../../engine/types";
import { TERRAIN_ASSETS, highResSvg } from "../../renderer/assets";
import { loadRobotTextures, robotTextureKey } from "../../renderer/robotTextures";

/** Rendering the real 24×24 Rubble Two, so tiles are smaller than the hand
 *  layout used while the wall design was being worked out. */
const TILE = 40;
const ARENA = "rubble-two";

type Channel = "flat" | "lit" | "normal";

interface Placement {
  readonly kind: "structure" | "bush" | "boulder";
  readonly tx: number;
  readonly ty: number;
  /** Autotiled piece: adjacency + relative neighbour height + south drop. */
  readonly piece?: string;
  /** The fully-enclosed flat piece, shown when autotiling is toggled off. */
  readonly plain?: string;
  /** Cap lift above the tile, in tile units — the base sits on the tile. */
  readonly lift?: number;
  readonly variant?: number;
  readonly dx?: number;
  readonly dy?: number;
}

interface Manifest {
  readonly boardW: number;
  readonly boardH: number;
  readonly tilePx: number;
  readonly layout: readonly string[];
  readonly base?: readonly (readonly string[])[];
  readonly placements: readonly Placement[];
}

const TERRAIN_NAME: Record<string, string> = {
  o: "open",
  r: "rough",
  W: "wall",
  l: "low-wall",
  b: "bush",
};

interface Probe {
  readonly tx: number;
  readonly ty: number;
  readonly terrain: string;
  readonly base: string;
  readonly piece: string;
}

/** The shipped SVG set has no floor tile, so the "before" comparison renders
 *  concrete as open ground. Only affects the legacy baseline view. */
const TERRAIN_OF: Record<string, Terrain> = {
  o: "open",
  c: "open",
  r: "rough",
  W: "wall",
  l: "low-wall",
  b: "bush",
};

/** Open tiles picked out of the real Rubble Two grid. */
const ROBOTS = [
  { x: 13, y: 6, robotClass: "rifle", teamColor: "red", heading: 0.4 },
  { x: 8, y: 10, robotClass: "missile", teamColor: "blue", heading: 2.6 },
  { x: 2, y: 13, robotClass: "auto", teamColor: "green", heading: -1.1 },
  { x: 18, y: 20, robotClass: "burst", teamColor: "yellow", heading: 3.4 },
] as const;

const TEAM_HEX: Record<string, number> = {
  red: 0xff5a4a,
  blue: 0x5aa0ff,
  green: 0x5ade7a,
  yellow: 0xffd85a,
};

export interface DemoSettings {
  readonly procedural: boolean;
  readonly autotile: boolean;
  readonly lighting: boolean;
  readonly bloom: boolean;
  readonly rim: boolean;
  readonly normals: boolean;
  readonly zoom: number;
}

const DEFAULTS: DemoSettings = {
  procedural: true,
  autotile: true,
  lighting: true,
  bloom: true,
  rim: true,
  normals: false,
  zoom: 1,
};

interface Scene {
  readonly app: Application;
  readonly root: Container;
  readonly ground: Sprite;
  readonly legacyLayer: Container;
  readonly structures: readonly { sprite: Sprite; piece: string; plain: string }[];
  readonly bushes: readonly Sprite[];
  readonly bloomLayer: Container;
  readonly rimLayer: Container;
  readonly get: (name: string, channel: Channel) => Texture | undefined;
}

const glowTexture = async (size: number): Promise<Texture> => {
  const { Texture } = await import("pixi.js");
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.28, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.14)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
};

export function GraphicsDemo() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [settings, setSettings] = useState<DemoSettings>(DEFAULTS);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>("");
  const manifestRef = useRef<Manifest | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  /** Tile readout under the cursor, so a defect can be reported by coordinate
   *  instead of by pointing at a region of a screenshot. */
  const onProbe = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const manifest = manifestRef.current;
    const canvas = hostRef.current?.querySelector("canvas");
    if (manifest === null || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / (manifest.boardW * TILE);
    const tx = Math.floor((event.clientX - rect.left) / (TILE * scale));
    const ty = Math.floor((event.clientY - rect.top) / (TILE * scale));
    if (tx < 0 || ty < 0 || tx >= manifest.boardW || ty >= manifest.boardH) {
      setProbe(null);
      return;
    }
    const key = manifest.layout[ty]?.[tx] ?? "?";
    const placed = manifest.placements.find((p) => p.tx === tx && p.ty === ty);
    setProbe({
      tx,
      ty,
      terrain: TERRAIN_NAME[key] ?? key,
      base: manifest.base?.[ty]?.[tx] ?? "?",
      piece: placed?.piece ?? (placed ? `${placed.kind}-${placed.variant ?? 0}` : "—"),
    });
  }, []);

  const set = useCallback(
    <K extends keyof DemoSettings>(key: K, value: DemoSettings[K]) =>
      setSettings((current) => ({ ...current, [key]: value })),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;

    const build = async () => {
      const { Application, Assets, BlurFilter, Container, Sprite } = await import("pixi.js");
      const manifest = (await (
        await fetch(`/spike/terrain/${ARENA}/manifest.json`)
      ).json()) as Manifest;
      if (disposed) return;
      manifestRef.current = manifest;

      const width = manifest.boardW * TILE;
      const height = manifest.boardH * TILE;

      const app = new Application();
      await app.init({
        width,
        height,
        antialias: true,
        autoDensity: true,
        background: "#0b0d0c",
        resolution: Math.min(window.devicePixelRatio, 2),
      });
      if (disposed) {
        app.destroy(true);
        return;
      }
      destroy = () => app.destroy(true);
      hostRef.current?.appendChild(app.canvas as HTMLCanvasElement);

      // ── textures ──────────────────────────────────────────────────────────
      const names = new Set<string>(["ground"]);
      for (const place of manifest.placements) {
        if (place.piece !== undefined) names.add(place.piece);
        if (place.plain !== undefined) names.add(place.plain);
        if (place.kind === "bush" || place.kind === "boulder") {
          names.add(`${place.kind}-${place.variant ?? 0}`);
        }
      }

      const textures = new Map<string, Texture>();
      await Promise.all(
        [...names].flatMap((name) =>
          (["flat", "lit", "normal"] as const).map(async (channel) => {
            const url = `/spike/terrain/${ARENA}/${name}-${channel}.png`;
            textures.set(`${name}:${channel}`, await Assets.load<Texture>(url));
          }),
        ),
      );
      const legacy = new Map<Terrain, Texture>();
      await Promise.all(
        (["open", "rough", "wall", "low-wall", "bush"] as const).map(async (terrain) => {
          legacy.set(terrain, await Assets.load<Texture>(highResSvg(TERRAIN_ASSETS[terrain])));
        }),
      );
      if (disposed) return;

      const robotTextures = await loadRobotTextures(
        ROBOTS.map((r) => ({ robotClass: r.robotClass, teamColor: r.teamColor })),
      );
      const glow = await glowTexture(128);
      if (disposed) return;

      const get = (name: string, channel: Channel) => textures.get(`${name}:${channel}`);

      // ── scene graph ───────────────────────────────────────────────────────
      const root = new Container();
      const legacyLayer = new Container();
      const structureLayer = new Container();
      const rimLayer = new Container();
      const robotLayer = new Container();
      const bloomLayer = new Container();

      const ground = new Sprite(get("ground", "lit"));
      ground.width = width;
      ground.height = height;
      root.addChild(ground, legacyLayer, structureLayer, rimLayer, robotLayer, bloomLayer);
      app.stage.addChild(root);

      bloomLayer.blendMode = "add";
      bloomLayer.filters = [new BlurFilter({ strength: 4, quality: 3 })];
      rimLayer.blendMode = "add";
      rimLayer.filters = [new BlurFilter({ strength: 3, quality: 2 })];

      // The "before" view: one identical SVG stamp per tile.
      manifest.layout.forEach((row, y) => {
        [...row].forEach((char, x) => {
          const sprite = new Sprite(legacy.get(TERRAIN_OF[char] ?? "open"));
          sprite.position.set(x * TILE, y * TILE);
          sprite.width = TILE;
          sprite.height = TILE;
          legacyLayer.addChild(sprite);
        });
      });

      const structures: { sprite: Sprite; piece: string; plain: string }[] = [];
      const bushes: Sprite[] = [];
      // Painter's order for the oblique projection. The cap is displaced up and
      // to the RIGHT, so the viewer sits down-left: south and west are nearer.
      // Draw north→south, and within a row east→west. Sorting by row alone left
      // the within-row order running west→east, so a *farther* eastern piece
      // painted over a nearer western one — which is what made mixed-height
      // junctions read as overlapping rectangles.
      const ordered = [...manifest.placements].sort((a, b) => a.ty - b.ty || b.tx - a.tx);
      for (const place of ordered) {
        if (place.kind === "bush" || place.kind === "boulder") {
          const texture = get(`${place.kind}-${place.variant ?? 0}`, "lit");
          const sprite = new Sprite(texture);
          const size = TILE * (place.kind === "boulder" ? 1.15 : 1.35);
          sprite.anchor.set(0.5);
          sprite.width = size;
          sprite.height = size;
          sprite.position.set(
            (place.tx + 0.5 + (place.dx ?? 0)) * TILE,
            (place.ty + 0.5 + (place.dy ?? 0)) * TILE,
          );
          structureLayer.addChild(sprite);
          bushes.push(sprite);
          continue;
        }
        const piece = place.piece ?? "";
        const plain = place.plain ?? piece;
        const texture = get(piece, "lit");
        const sprite = new Sprite(texture);
        // Offset UP by the cap displacement so the piece's BASE lands on the
        // tile. The canvas is both wider and taller than a tile (the oblique
        // projection pushes the cap up and right), so scale it uniformly by
        // TILE/tilePx rather than forcing it into the square.
        sprite.position.set(place.tx * TILE, (place.ty - (place.lift ?? 0)) * TILE);
        const scale = TILE / manifest.tilePx;
        sprite.width = (texture?.width ?? manifest.tilePx) * scale;
        sprite.height = (texture?.height ?? manifest.tilePx) * scale;
        structureLayer.addChild(sprite);
        structures.push({ sprite, piece, plain });
      }

      for (const robot of ROBOTS) {
        const set_ = robotTextures.get(robotTextureKey(robot.robotClass, robot.teamColor));
        if (set_ === undefined) continue;
        const cx = robot.x * TILE + TILE / 2;
        const cy = robot.y * TILE + TILE / 2;
        const bodySize = TILE * 1.15;

        const rim = new Sprite(set_.bodies.upright);
        rim.anchor.set(0.5);
        rim.width = bodySize * 1.06;
        rim.height = bodySize * 1.06;
        rim.position.set(cx, cy);
        rim.tint = TEAM_HEX[robot.teamColor] ?? 0xffffff;
        rim.alpha = 0.6;
        rimLayer.addChild(rim);

        const body = new Sprite(set_.bodies.upright);
        body.anchor.set(0.5);
        body.width = bodySize;
        body.height = bodySize;
        body.position.set(cx, cy);
        robotLayer.addChild(body);

        const turret = new Sprite(set_.turret);
        turret.anchor.set(0.5);
        turret.width = bodySize * 0.75;
        turret.height = bodySize * 0.75;
        turret.position.set(cx, cy - bodySize * 0.08);
        turret.rotation = robot.heading;
        robotLayer.addChild(turret);

        const lensAt = (distance: number, size: number, tint: number, alpha: number) => {
          const sprite = new Sprite(glow);
          sprite.anchor.set(0.5);
          sprite.width = TILE * size;
          sprite.height = TILE * size;
          sprite.position.set(
            cx + Math.cos(robot.heading - Math.PI / 2) * TILE * distance,
            cy + Math.sin(robot.heading - Math.PI / 2) * TILE * distance - bodySize * 0.06,
          );
          sprite.tint = tint;
          sprite.alpha = alpha;
          bloomLayer.addChild(sprite);
        };
        lensAt(0.06, 0.2, 0x6ff2ff, 0.95);
        lensAt(0.42, 0.15, 0xffb44a, 0.75);
      }

      sceneRef.current = {
        app,
        root,
        ground,
        legacyLayer,
        structures,
        bushes,
        bloomLayer,
        rimLayer,
        get,
      };
      setStatus("ready");
    };

    void build().catch((cause: unknown) => {
      if (disposed) return;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
      console.error("Graphics spike failed to build.", cause);
    });

    return () => {
      disposed = true;
      sceneRef.current = null;
      destroy?.();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null || status !== "ready") return;

    const channel: Channel = settings.normals ? "normal" : settings.lighting ? "lit" : "flat";
    scene.legacyLayer.visible = !settings.procedural;
    scene.ground.visible = settings.procedural;

    const groundTexture = scene.get("ground", channel);
    if (groundTexture !== undefined) scene.ground.texture = groundTexture;

    for (const structure of scene.structures) {
      structure.sprite.visible = settings.procedural;
      // Autotiling off: every piece falls back to the fully-enclosed one, which
      // is the "stamped" look — no orientation, no front face, no broken ends,
      // and no visible step where the building changes height.
      const name = settings.autotile ? structure.piece : structure.plain;
      const texture = scene.get(name, channel);
      if (texture !== undefined) structure.sprite.texture = texture;
    }
    for (const bush of scene.bushes) bush.visible = settings.procedural;

    scene.bloomLayer.visible = settings.bloom;
    scene.rimLayer.visible = settings.rim;
    scene.root.scale.set(settings.zoom);
    scene.app.renderer.resize(
      scene.ground.width * settings.zoom,
      scene.ground.height * settings.zoom,
    );
  }, [settings, status]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <Toggle
          label="Procedural terrain"
          hint="Tier 1"
          checked={settings.procedural}
          onChange={(v) => set("procedural", v)}
        />
        <Toggle
          label="Structure autotiling"
          hint="Tier 1"
          checked={settings.autotile}
          disabled={!settings.procedural}
          onChange={(v) => set("autotile", v)}
        />
        <Toggle
          label="Baked lighting"
          hint="Tier 2"
          checked={settings.lighting}
          disabled={!settings.procedural || settings.normals}
          onChange={(v) => set("lighting", v)}
        />
        <Toggle
          label="Emissive bloom"
          hint="Tier 3/4"
          checked={settings.bloom}
          onChange={(v) => set("bloom", v)}
        />
        <Toggle
          label="Side rim light"
          hint="Tier 4"
          checked={settings.rim}
          onChange={(v) => set("rim", v)}
        />
        <Toggle
          label="Normal map"
          hint="debug"
          checked={settings.normals}
          disabled={!settings.procedural}
          onChange={(v) => set("normals", v)}
        />
        <label className="flex items-center gap-3 text-sm text-white/70">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            Zoom {settings.zoom.toFixed(2)}×
          </span>
          <input
            type="range"
            min={0.3}
            max={2}
            step={0.05}
            value={settings.zoom}
            onChange={(event) => set("zoom", Number(event.currentTarget.value))}
            className="w-44 cursor-pointer accent-emerald-400"
            aria-label="Zoom"
          />
        </label>
        <button
          type="button"
          onClick={() => setSettings(DEFAULTS)}
          className="cursor-pointer rounded-lg border border-white/12 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-white/25 hover:text-white"
        >
          Reset
        </button>
      </div>

      <div className="relative overflow-auto rounded-2xl border border-white/10 bg-[#0b0d0c] p-4">
        <div
          ref={hostRef}
          className="mx-auto w-fit"
          onPointerMove={onProbe}
          onPointerLeave={() => setProbe(null)}
        />
        {probe !== null ? (
          <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-white/15 bg-black/80 px-3 py-2 font-mono text-[11px] leading-5 text-white/85">
            <div className="text-emerald-300">
              tile {probe.tx}, {probe.ty}
            </div>
            <div>terrain {probe.terrain}</div>
            <div>base {probe.base}</div>
            <div>piece {probe.piece}</div>
          </div>
        ) : null}
        {status !== "ready" ? (
          <p className="py-24 text-center font-mono text-xs uppercase tracking-[0.2em] text-white/40">
            {status === "error" ? `Renderer error — ${error}` : "Building scene…"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className={`size-4 accent-emerald-400 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      />
      <span className="text-white/80">{label}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">
        {hint}
      </span>
    </label>
  );
}
