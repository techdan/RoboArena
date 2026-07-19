"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { Application, Container, Graphics as PixiGraphics } from "pixi.js";
import type { Arena, Heading, Posture, RobotClass, TileCoord, WeaponId } from "../../engine/types";
import { ARENA_ASSET_URLS, highResSvg, TERRAIN_ASSETS } from "../../renderer/assets";
import type { TargetingTilePreview } from "../../planner/firingHelpers";
import {
  coneWedge,
  damageRings,
  ringLabelPosition,
  ringRadiusPx,
} from "../../planner/overlayGeometry";
import { tooltipLines } from "../../planner/overlayLabels";
import { targetingTileVisual } from "../../planner/targetingVisuals";
import { createRobotSprite } from "../../renderer/RobotSprite";
import { loadRobotTextures, robotTextureKey } from "../../renderer/robotTextures";
import { useHelp } from "../help/HelpProvider";
import { CameraControls } from "../CameraControls";
import { TargetingLegend } from "./TargetingLegend";
import { fitTransform } from "../../lib/fitTransform";
import {
  LONG_PRESS_MS,
  TouchGestureArbitrator,
  movedBeyondGestureThreshold,
  pointDistance,
  transformForPinch,
  type Point,
} from "../../lib/input/pointerGestures";

const TILE_SIZE = 24;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;
const clampZoom = (scale: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
// Brighter than the robot-body hues so a thin outline reads over both dark grass
// and red brick. The home overlay leans on these plus a dark halo, not opacity.
const HOME_OVERLAY_COLORS: Readonly<Record<string, number>> = {
  red: 0xff6b6b,
  blue: 0x6aa8ff,
  green: 0x5ddb8f,
  yellow: 0xffd45e,
};
// The arena container is `border-radius: 0.7rem` with a 1px border, so its inner
// corner curves at ~10px. The home outline is inset a touch and its outer corner
// rounded to match, nesting cleanly inside that same curve.
const ARENA_CORNER_RADIUS = 10;
const HOME_OUTLINE_INSET = 2;
const HEADING_VECTOR: Readonly<Record<Heading, TileCoord>> = {
  N: { x: 0, y: -1 },
  NE: { x: 1, y: -1 },
  E: { x: 1, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 },
  SW: { x: -1, y: 1 },
  W: { x: -1, y: 0 },
  NW: { x: -1, y: -1 },
};

export interface PlannerRobotView {
  readonly id: string;
  readonly label: string;
  readonly robotClass: RobotClass;
  readonly color: string;
  readonly position: TileCoord | "dock";
  readonly posture: Posture;
  readonly scanHeading: Heading;
  readonly selected: boolean;
}

export interface HomeAreaOverlay {
  readonly tiles: readonly TileCoord[];
  readonly color: string;
  readonly corner: "NW" | "NE" | "SE" | "SW";
}

export interface PlannerTargetingOverlay {
  readonly mode: "aim" | "scan";
  readonly origin: TileCoord;
  readonly heading: Heading;
  readonly maxDistance: number;
  readonly weapon: WeaponId;
  readonly target: TileCoord | null;
  readonly seconds: number | null;
  readonly opportunityTicks: number;
  readonly assumedPosture: Posture;
  readonly resolution: "direct-hit-roll" | "blast";
  readonly tiles: readonly TargetingTilePreview[];
}

export interface ArenaCanvasProps {
  readonly arena: Arena;
  readonly robots: readonly PlannerRobotView[];
  readonly homeAreas: readonly HomeAreaOverlay[];
  readonly route: readonly TileCoord[];
  readonly cursor: TileCoord | null;
  readonly cursorState: "valid" | "blocked" | "out-of-home" | "out-of-bounds";
  readonly targetingOverlay: PlannerTargetingOverlay | null;
  readonly firingInteractionActive: boolean;
  readonly onAssumedPosture: (posture: Posture) => void;
  readonly onCursor: (tile: TileCoord | null) => void;
  readonly onChooseTile: (
    tile: TileCoord,
    modifiers: { readonly ctrl: boolean; readonly shift: boolean },
  ) => void;
  readonly onChooseRobot: (robotId: string) => void;
}

export function ArenaCanvas({
  arena,
  robots,
  homeAreas,
  route,
  cursor,
  cursorState,
  targetingOverlay,
  firingInteractionActive,
  onAssumedPosture,
  onCursor,
  onChooseTile,
  onChooseRobot,
}: ArenaCanvasProps) {
  const { openTopic } = useHelp();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const overlayRef = useRef<Container | null>(null);
  const targetOverlayRef = useRef<Container | null>(null);
  const cursorOverlayRef = useRef<Container | null>(null);
  const overlayGenerationRef = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [keyboardTile, setKeyboardTile] = useState<TileCoord>({ x: 0, y: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [viewportSize, setViewportSize] = useState({
    width: arena.width * TILE_SIZE,
    height: arena.height * TILE_SIZE,
  });
  const [grabbing, setGrabbing] = useState(false);
  // Letterbox base transform: the viewport fills whatever space the layout
  // grants, and the fixed-resolution stage is fit-scaled and centered inside.
  const fit = fitTransform(
    viewportSize.width,
    viewportSize.height,
    arena.width * TILE_SIZE,
    arena.height * TILE_SIZE,
  );
  const fitScale = fit.scale;
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const pointersRef = useRef(new Map<number, Point>());
  const touchRef = useRef<{
    readonly pointerId: number;
    readonly start: Point;
    readonly tile: TileCoord;
    readonly startTransform: typeof transform;
    readonly canPan: boolean;
    timer: number | null;
  } | null>(null);
  const pinchRef = useRef<{
    readonly distance: number;
    readonly midpoint: Point;
    readonly startTransform: typeof transform;
  } | null>(null);
  const gestureRef = useRef(new TouchGestureArbitrator());
  const mousePanRef = useRef<{
    readonly pointerId: number;
    readonly start: Point;
    readonly startTransform: typeof transform;
    moved: boolean;
  } | null>(null);
  const suppressMouseClickRef = useRef(false);

  const zoomAbout = useCallback((focal: Point, nextScale: number) => {
    // Focal points arrive in viewport coordinates; the user transform lives in
    // the letterboxed frame, so shift by the fit offset before zooming about.
    const { offsetX, offsetY } = fitRef.current;
    setTransform((current) => {
      const scale = clampZoom(nextScale);
      if (scale === current.scale) return current;
      const focalX = focal.x - offsetX;
      const focalY = focal.y - offsetY;
      const contentX = (focalX - current.x) / current.scale;
      const contentY = (focalY - current.y) / current.scale;
      return { scale, x: focalX - contentX * scale, y: focalY - contentY * scale };
    });
  }, []);

  const zoomByStep = useCallback(
    (factor: number) => {
      const bounds = viewportRef.current?.getBoundingClientRect();
      zoomAbout(
        bounds === undefined ? { x: 0, y: 0 } : { x: bounds.width / 2, y: bounds.height / 2 },
        transformRef.current.scale * factor,
      );
    },
    [zoomAbout],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const updateViewportSize = () => {
      const bounds = viewport.getBoundingClientRect();
      const next = { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
      setViewportSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };
    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [arena.height, arena.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      zoomAbout(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        transformRef.current.scale * Math.pow(1.0015, -event.deltaY),
      );
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAbout]);

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;
    void (async () => {
      const {
        Application: PixiApplication,
        Assets,
        Container: PixiContainer,
        Sprite,
      } = await import("pixi.js");
      const app = new PixiApplication();
      await app.init({
        width: arena.width * TILE_SIZE,
        height: arena.height * TILE_SIZE,
        antialias: true,
        autoDensity: true,
        autoStart: false,
        background: "#111512",
        preference: "webgl",
        resolution: Math.min(window.devicePixelRatio, 2),
      });
      if (disposed) return app.destroy(true);
      destroy = () => app.destroy(true);
      appRef.current = app;
      const canvas = app.canvas as HTMLCanvasElement;
      canvas.dataset.plannerCanvas = arena.sizeName;
      hostRef.current?.appendChild(canvas);
      const textureEntries = await Promise.all(
        ARENA_ASSET_URLS.map(async (url) => [url, await Assets.load(highResSvg(url))] as const),
      );
      if (disposed) return;
      const textures = new Map(textureEntries);
      for (let y = 0; y < arena.height; y += 1) {
        for (let x = 0; x < arena.width; x += 1) {
          const terrain = arena.tiles[y]?.[x]?.terrain;
          const texture = terrain === undefined ? undefined : textures.get(TERRAIN_ASSETS[terrain]);
          if (texture === undefined) continue;
          const sprite = new Sprite(texture);
          sprite.position.set(x * TILE_SIZE, y * TILE_SIZE);
          sprite.width = TILE_SIZE;
          sprite.height = TILE_SIZE;
          app.stage.addChild(sprite);
        }
      }
      const overlay = new PixiContainer();
      const targetOverlay = new PixiContainer();
      const cursorOverlay = new PixiContainer();
      overlayRef.current = overlay;
      targetOverlayRef.current = targetOverlay;
      cursorOverlayRef.current = cursorOverlay;
      app.stage.addChild(overlay, targetOverlay, cursorOverlay);
      app.render();
      setStatus("ready");
    })().catch((error: unknown) => {
      console.error("Planner arena could not start.", error);
      if (!disposed) setStatus("error");
    });
    return () => {
      disposed = true;
      appRef.current = null;
      overlayRef.current = null;
      targetOverlayRef.current = null;
      cursorOverlayRef.current = null;
      destroy?.();
    };
  }, [arena]);

  useEffect(() => {
    const app = appRef.current;
    if (status !== "ready" || app === null) return;
    const density = Math.min(window.devicePixelRatio, 2) * fitScale * transform.scale;
    const resolution = Math.min(4, Math.max(1, Math.ceil(density * 2) / 2));
    if (app.renderer.resolution === resolution) return;
    app.renderer.resize(arena.width * TILE_SIZE, arena.height * TILE_SIZE, resolution);
  }, [arena.height, arena.width, fitScale, status, transform.scale]);

  useEffect(() => {
    const app = appRef.current;
    const overlay = overlayRef.current;
    if (app === null || overlay === null || status !== "ready") return;
    const generation = ++overlayGenerationRef.current;
    void (async () => {
      const { Graphics, Text } = await import("pixi.js");
      const robotTextures = await loadRobotTextures(
        robots.map((robot) => ({ robotClass: robot.robotClass, teamColor: robot.color })),
      );
      if (
        generation !== overlayGenerationRef.current ||
        appRef.current !== app ||
        overlayRef.current !== overlay
      )
        return;
      overlay.removeChildren().forEach((child) => child.destroy());
      for (const homeArea of targetingOverlay === null ? homeAreas : []) {
        if (homeArea.tiles.length === 0) continue;
        const color = HOME_OVERLAY_COLORS[homeArea.color] ?? 0xffffff;
        // Barely-there fill: a quiet hint of ownership, not a wash over terrain.
        // Drawn per tile to the wall edge; the arena's rounded clip curves it.
        const fill = new Graphics();
        for (const tile of homeArea.tiles) {
          fill.rect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
        fill.fill({ color, alpha: 0.08 });
        overlay.addChild(fill);
        // Home areas are rectangles hugging one arena corner. Inset the outline
        // and round only the corner that meets the arena corner, so it follows
        // the same curve; the three interior corners stay square.
        const xs = homeArea.tiles.map((tile) => tile.x);
        const ys = homeArea.tiles.map((tile) => tile.y);
        const x0 = Math.min(...xs) * TILE_SIZE + HOME_OUTLINE_INSET;
        const y0 = Math.min(...ys) * TILE_SIZE + HOME_OUTLINE_INSET;
        const x1 = (Math.max(...xs) + 1) * TILE_SIZE - HOME_OUTLINE_INSET;
        const y1 = (Math.max(...ys) + 1) * TILE_SIZE - HOME_OUTLINE_INSET;
        const r = ARENA_CORNER_RADIUS - HOME_OUTLINE_INSET;
        // Per-corner radius [top-left, top-right, bottom-right, bottom-left].
        const radiiByCorner: Readonly<
          Record<HomeAreaOverlay["corner"], readonly [number, number, number, number]>
        > = {
          NW: [r, 0, 0, 0],
          NE: [0, r, 0, 0],
          SE: [0, 0, r, 0],
          SW: [0, 0, 0, r],
        };
        const [rTL, rTR, rBR, rBL] = radiiByCorner[homeArea.corner];
        const traceOutline = (graphics: PixiGraphics) => {
          graphics.moveTo(x0 + rTL, y0);
          graphics.lineTo(x1 - rTR, y0);
          graphics.arcTo(x1, y0, x1, y0 + rTR, rTR);
          graphics.lineTo(x1, y1 - rBR);
          graphics.arcTo(x1, y1, x1 - rBR, y1, rBR);
          graphics.lineTo(x0 + rBL, y1);
          graphics.arcTo(x0, y1, x0, y1 - rBL, rBL);
          graphics.lineTo(x0, y0 + rTL);
          graphics.arcTo(x0, y0, x0 + rTL, y0, rTL);
          graphics.closePath();
        };
        // Dark halo underneath carries the contrast so the colored line can stay
        // thin and recede; the bright team line sits on top.
        const halo = new Graphics();
        traceOutline(halo);
        halo.stroke({ width: 3, color: 0x000000, alpha: 0.32 });
        overlay.addChild(halo);
        const outline = new Graphics();
        traceOutline(outline);
        outline.stroke({ width: 1.5, color, alpha: 0.7 });
        overlay.addChild(outline);
      }
      if (targetingOverlay !== null) {
        const heat = new Graphics();
        for (const tile of targetingOverlay.tiles) {
          const visual = targetingTileVisual(tile);
          const x = tile.tile.x * TILE_SIZE;
          const y = tile.tile.y * TILE_SIZE;
          heat.rect(x, y, TILE_SIZE, TILE_SIZE).fill({ color: visual.color, alpha: visual.alpha });
          if (visual.pattern === "hatch") {
            heat
              .moveTo(x + 2, y + TILE_SIZE - 2)
              .lineTo(x + TILE_SIZE - 2, y + 2)
              .moveTo(x - 4, y + TILE_SIZE - 2)
              .lineTo(x + TILE_SIZE - 2, y - 4)
              .stroke({ width: 1, color: 0xf8fafc, alpha: 0.34 });
          } else if (visual.pattern === "reverse-hatch") {
            // Opposite diagonal, sparser and quieter: angle-blocked covers half
            // the board, so its texture must recede rather than shout.
            heat
              .moveTo(x + 2, y + 2)
              .lineTo(x + TILE_SIZE - 2, y + TILE_SIZE - 2)
              .stroke({ width: 1, color: 0xf8fafc, alpha: 0.16 });
          }
        }
        overlay.addChild(heat);
        // Structural guides above the heat fill: the two boundary rays + arc
        // mark the exact ±90° firing half-plane (the arc doubles as the
        // max-range limit on the allowed side), and inner arcs mark the real
        // damage breakpoints. All radii are (r + 1) tile units — the exact
        // floored-Euclidean threshold the per-tile fills obey.
        const guides = new Graphics();
        const maxRadiusPx = ringRadiusPx(targetingOverlay.maxDistance, TILE_SIZE);
        const wedge = coneWedge(
          targetingOverlay.origin,
          targetingOverlay.heading,
          maxRadiusPx,
          TILE_SIZE,
        );
        guides
          .moveTo(wedge.center.x, wedge.center.y)
          .lineTo(wedge.rayA.x, wedge.rayA.y)
          .moveTo(wedge.center.x, wedge.center.y)
          .lineTo(wedge.rayB.x, wedge.rayB.y)
          .arc(wedge.center.x, wedge.center.y, maxRadiusPx, wedge.startAngle, wedge.endAngle)
          .stroke({ width: 1.5, color: 0x67e8f9, alpha: 0.75 });
        const rings = damageRings(targetingOverlay.maxDistance, targetingOverlay.resolution);
        for (const ring of rings) {
          if (ring.kind === "max-range") continue;
          guides
            .arc(
              wedge.center.x,
              wedge.center.y,
              ringRadiusPx(ring.radius, TILE_SIZE),
              wedge.startAngle,
              wedge.endAngle,
            )
            .stroke({
              width: 1,
              color: ring.kind === "near-bonus" ? 0xfacc15 : 0x94a3b8,
              alpha: 0.6,
            });
        }
        overlay.addChild(guides);
        for (const ring of rings) {
          const color =
            ring.kind === "near-bonus"
              ? 0xfacc15
              : ring.kind === "far-penalty"
                ? 0xcbd5e1
                : 0x67e8f9;
          const tag = new Text({
            text: ring.label,
            style: {
              fill: color,
              fontSize: 8,
              fontWeight: "700",
              stroke: { color: 0x000000, width: 3 },
            },
          });
          const radiusPx = ringRadiusPx(ring.radius, TILE_SIZE);
          const labelPosition = ringLabelPosition(
            wedge,
            radiusPx,
            arena.width * TILE_SIZE,
            arena.height * TILE_SIZE,
          );
          tag.anchor.set(0.5);
          tag.position.set(
            Math.min(
              arena.width * TILE_SIZE - tag.width / 2 - 4,
              Math.max(tag.width / 2 + 4, labelPosition.x),
            ),
            Math.min(
              arena.height * TILE_SIZE - tag.height / 2 - 4,
              Math.max(tag.height / 2 + 4, labelPosition.y),
            ),
          );
          overlay.addChild(tag);
        }
      }
      if (route.length > 0) {
        const line = new Graphics();
        const first = route[0];
        if (first !== undefined) {
          line.moveTo(first.x * TILE_SIZE + TILE_SIZE / 2, first.y * TILE_SIZE + TILE_SIZE / 2);
          for (const tile of route.slice(1))
            line.lineTo(tile.x * TILE_SIZE + TILE_SIZE / 2, tile.y * TILE_SIZE + TILE_SIZE / 2);
          line.stroke({ width: 3, color: 0xbef264, alpha: 0.75 });
          overlay.addChild(line);
        }
      }
      for (const robot of robots) {
        if (robot.position === "dock") continue;
        const centerX = robot.position.x * TILE_SIZE + TILE_SIZE / 2;
        const centerY = robot.position.y * TILE_SIZE + TILE_SIZE / 2;
        if (robot.selected) {
          const vector = HEADING_VECTOR[robot.scanHeading];
          overlay.addChild(
            new Graphics()
              .circle(centerX, centerY, 13)
              .stroke({ width: 2, color: 0xd9f99d, alpha: 0.9 })
              .moveTo(centerX, centerY)
              .lineTo(centerX + vector.x * 17, centerY + vector.y * 17)
              .stroke({ width: 2, color: 0xd9f99d, alpha: 0.55 }),
          );
        }
        const textureSet = robotTextures.get(robotTextureKey(robot.robotClass, robot.color));
        if (textureSet !== undefined) {
          const visual = createRobotSprite(
            {
              id: robot.id,
              teamId: "planner",
              teamColor: robot.color,
              robotClass: robot.robotClass,
              position: robot.position,
              hp: 1,
              armor: 1,
              posture: robot.posture,
              scanHeading: robot.scanHeading,
              destroyed: false,
            },
            textureSet,
            TILE_SIZE,
          );
          overlay.addChild(visual.container);
        }
        const label = new Text({
          text: robot.label,
          style: {
            fill: 0xffffff,
            fontSize: 8,
            fontWeight: "700",
            stroke: { color: 0x000000, width: 2 },
          },
        });
        label.anchor.set(0.5, 0);
        label.position.set(centerX, centerY + 10);
        overlay.addChild(label);
      }
      app.render();
    })().catch((error: unknown) => {
      console.error("Planner overlays could not render.", error);
    });
    return () => {
      overlayGenerationRef.current += 1;
    };
  }, [
    arena.height,
    arena.width,
    homeAreas,
    robots,
    route,
    targetingOverlay?.mode,
    targetingOverlay?.tiles,
    status,
  ]);

  useEffect(() => {
    const app = appRef.current;
    const overlay = targetOverlayRef.current;
    if (app === null || overlay === null || status !== "ready") return;
    void import("pixi.js").then(({ Graphics }) => {
      if (appRef.current !== app || targetOverlayRef.current !== overlay) return;
      overlay.removeChildren().forEach((child) => child.destroy());
      if (targetingOverlay?.target === null || targetingOverlay?.target === undefined) {
        app.render();
        return;
      }
      const target = targetingOverlay.target;
      const originX = targetingOverlay.origin.x * TILE_SIZE + TILE_SIZE / 2;
      const originY = targetingOverlay.origin.y * TILE_SIZE + TILE_SIZE / 2;
      const targetX = target.x * TILE_SIZE + TILE_SIZE / 2;
      const targetY = target.y * TILE_SIZE + TILE_SIZE / 2;
      const aim = new Graphics()
        .moveTo(originX, originY)
        .lineTo(targetX, targetY)
        .stroke({ width: 2, color: 0xfef08a, alpha: 0.85 })
        .rect(target.x * TILE_SIZE + 2, target.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4)
        .stroke({ width: 2, color: 0xfef08a, alpha: 0.95 });
      if (targetingOverlay.resolution === "blast") {
        aim
          .circle(targetX, targetY, TILE_SIZE * 2)
          .stroke({ width: 1.5, color: 0x60a5fa, alpha: 0.7 });
      }
      overlay.addChild(aim);
      app.render();
    });
  }, [status, targetingOverlay?.origin, targetingOverlay?.resolution, targetingOverlay?.target]);

  useEffect(() => {
    const app = appRef.current;
    const overlay = cursorOverlayRef.current;
    if (app === null || overlay === null || status !== "ready") return;
    void import("pixi.js").then(({ Graphics }) => {
      if (appRef.current !== app || cursorOverlayRef.current !== overlay) return;
      overlay.removeChildren().forEach((child) => child.destroy());
      const activeCursor = cursor ?? keyboardTile;
      const cursorColor =
        cursorState === "valid" ? 0xbef264 : cursorState === "out-of-home" ? 0xfbbf24 : 0xfb7185;
      overlay.addChild(
        new Graphics()
          .rect(
            activeCursor.x * TILE_SIZE + 1,
            activeCursor.y * TILE_SIZE + 1,
            TILE_SIZE - 2,
            TILE_SIZE - 2,
          )
          .stroke({ width: 2, color: cursorColor, alpha: 0.95 }),
      );
      app.render();
    });
  }, [cursor, cursorState, keyboardTile, status]);

  const tileFromClient = (clientX: number, clientY: number, element: HTMLDivElement): TileCoord => {
    const bounds = element.getBoundingClientRect();
    const current = transformRef.current;
    const { scale: baseScale, offsetX, offsetY } = fitRef.current;
    return {
      x: Math.min(
        arena.width - 1,
        Math.max(
          0,
          Math.floor(
            (clientX - bounds.left - offsetX - current.x) / current.scale / baseScale / TILE_SIZE,
          ),
        ),
      ),
      y: Math.min(
        arena.height - 1,
        Math.max(
          0,
          Math.floor(
            (clientY - bounds.top - offsetY - current.y) / current.scale / baseScale / TILE_SIZE,
          ),
        ),
      ),
    };
  };
  const tileFromPointer = (
    event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>,
  ): TileCoord => tileFromClient(event.clientX, event.clientY, event.currentTarget);
  const robotAt = (tile: TileCoord) =>
    robots.find(
      (robot) =>
        robot.position !== "dock" && robot.position.x === tile.x && robot.position.y === tile.y,
    );
  const chooseAt = (
    tile: TileCoord,
    modifiers: { readonly ctrl: boolean; readonly shift: boolean },
  ) => {
    if (firingInteractionActive) {
      onChooseTile(tile, modifiers);
      return;
    }
    const robot = robotAt(tile);
    if (robot !== undefined) {
      onChooseRobot(robot.id);
      return;
    }
    onChooseTile(tile, modifiers);
  };
  const inspect = (tile: TileCoord, anchor: Point) => {
    const robot = robotAt(tile);
    if (robot !== undefined && robot.robotClass !== "stealth") {
      openTopic(`robot:${robot.robotClass}`, anchor);
      return;
    }
    const terrain = arena.tiles[tile.y]?.[tile.x]?.terrain;
    if (terrain !== undefined) openTopic(`terrain:${terrain}`, anchor);
  };
  const cancelLongPress = () => {
    const active = touchRef.current;
    if (active?.timer !== null && active?.timer !== undefined) window.clearTimeout(active.timer);
    if (active !== null) active.timer = null;
  };

  // Cursor tooltip: the precision readout that survives when the per-tile
  // labels fade at small tile sizes. Pointer-events: none, so it never steals
  // hover from the board.
  const hoverPreview =
    targetingOverlay === null || cursor === null || grabbing
      ? null
      : (targetingOverlay.tiles[cursor.y * arena.width + cursor.x] ?? null);
  const tooltip =
    hoverPreview === null || targetingOverlay === null
      ? null
      : tooltipLines(hoverPreview, targetingOverlay.maxDistance);
  const tooltipScale = fitScale * transform.scale;
  const tooltipFlip = cursor !== null && cursor.x > arena.width / 2;
  const tooltipLeft =
    cursor === null
      ? 0
      : fit.offsetX +
        transform.x +
        (cursor.x + (tooltipFlip ? 0 : 1)) * TILE_SIZE * tooltipScale +
        (tooltipFlip ? -10 : 10);
  const tooltipTop =
    cursor === null
      ? 0
      : Math.min(
          viewportSize.height - 64,
          Math.max(4, fit.offsetY + transform.y + cursor.y * TILE_SIZE * tooltipScale - 4),
        );

  return (
    <div className="planner-canvas-shell">
      <div
        ref={viewportRef}
        className="planner-canvas"
        role="application"
        aria-label={`${arena.sizeName} planning board. Use arrow keys and Enter to choose a tile.`}
        tabIndex={0}
        style={{
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor: grabbing ? "grabbing" : undefined,
        }}
        onFocus={() => onCursor(keyboardTile)}
        onPointerMove={(event) => {
          const tile = tileFromPointer(event);
          setKeyboardTile(tile);
          onCursor(tile);
          if (event.pointerType !== "touch") {
            const pan = mousePanRef.current;
            if (pan === null || pan.pointerId !== event.pointerId) return;
            const point = { x: event.clientX, y: event.clientY };
            if (!movedBeyondGestureThreshold(pan.start, point)) return;
            pan.moved = true;
            suppressMouseClickRef.current = true;
            setGrabbing(true);
            setTransform({
              ...pan.startTransform,
              x: pan.startTransform.x + point.x - pan.start.x,
              y: pan.startTransform.y + point.y - pan.start.y,
            });
            return;
          }
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const points = [...pointersRef.current.values()];
          if (points.length >= 2) {
            cancelLongPress();
            const [first, second] = points;
            if (first === undefined || second === undefined) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const midpoint = {
              x: (first.x + second.x) / 2 - bounds.left - fitRef.current.offsetX,
              y: (first.y + second.y) / 2 - bounds.top - fitRef.current.offsetY,
            };
            const pinch = pinchRef.current;
            if (pinch === null) return;
            setTransform(
              transformForPinch({
                initialTransform: pinch.startTransform,
                initialMidpoint: pinch.midpoint,
                currentMidpoint: midpoint,
                initialDistance: pinch.distance,
                currentDistance: pointDistance(first, second),
                clampScale: clampZoom,
              }),
            );
            return;
          }
          const active = touchRef.current;
          if (active === null || active.pointerId !== event.pointerId) return;
          const current = { x: event.clientX, y: event.clientY };
          if (!gestureRef.current.markMoved(event.pointerId, active.start, current)) return;
          cancelLongPress();
          if (active.canPan) {
            setTransform({
              ...active.startTransform,
              x: active.startTransform.x + current.x - active.start.x,
              y: active.startTransform.y + current.y - active.start.y,
            });
          }
        }}
        onPointerLeave={(event) => {
          // pointerleave is a hover concept. Touch fires it when the finger lifts
          // (and again as re-renders shuffle the hit-test target), so honoring it
          // would clear the cursor and clobber the tap's own notice. Only mouse or
          // pen hover should clear the board cursor.
          if (event.pointerType === "touch") return;
          if (document.activeElement !== event.currentTarget) onCursor(null);
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") {
            if (event.button !== 0) return;
            const tile = tileFromPointer(event);
            if (robotAt(tile) !== undefined) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            mousePanRef.current = {
              pointerId: event.pointerId,
              start: { x: event.clientX, y: event.clientY },
              startTransform: transformRef.current,
              moved: false,
            };
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = { x: event.clientX, y: event.clientY };
          pointersRef.current.set(event.pointerId, point);
          const points = [...pointersRef.current.values()];
          if (points.length === 1) {
            const tile = tileFromPointer(event);
            const active = {
              pointerId: event.pointerId,
              start: point,
              tile,
              startTransform: transformRef.current,
              canPan: robotAt(tile) === undefined,
              timer: null as number | null,
            };
            gestureRef.current.beginPrimary(event.pointerId);
            active.timer = window.setTimeout(() => {
              if (
                pointersRef.current.size !== 1 ||
                !gestureRef.current.markLongPressed(event.pointerId)
              )
                return;
              inspect(active.tile, { x: point.x + 10, y: point.y + 10 });
            }, LONG_PRESS_MS);
            touchRef.current = active;
          } else if (points.length === 2) {
            cancelLongPress();
            const [first, second] = points;
            if (first === undefined || second === undefined) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            pinchRef.current = {
              distance: pointDistance(first, second),
              midpoint: {
                x: (first.x + second.x) / 2 - bounds.left - fitRef.current.offsetX,
                y: (first.y + second.y) / 2 - bounds.top - fitRef.current.offsetY,
              },
              startTransform: transformRef.current,
            };
            gestureRef.current.beginPinch();
          }
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== "touch") {
            if (mousePanRef.current?.pointerId === event.pointerId) mousePanRef.current = null;
            setGrabbing(false);
            return;
          }
          cancelLongPress();
          const active = touchRef.current;
          if (
            active !== null &&
            active.pointerId === event.pointerId &&
            gestureRef.current.end(event.pointerId)
          ) {
            onCursor(active.tile);
            chooseAt(active.tile, { ctrl: false, shift: false });
          }
          window.setTimeout(() => gestureRef.current.clearSyntheticClickSuppression(), 0);
          pointersRef.current.delete(event.pointerId);
          if (pointersRef.current.size < 2) pinchRef.current = null;
          if (active?.pointerId === event.pointerId) touchRef.current = null;
        }}
        onPointerCancel={(event) => {
          if (event.pointerType !== "touch") {
            mousePanRef.current = null;
            setGrabbing(false);
            return;
          }
          cancelLongPress();
          pointersRef.current.delete(event.pointerId);
          touchRef.current = null;
          pinchRef.current = null;
          gestureRef.current.cancel();
          window.setTimeout(() => gestureRef.current.clearSyntheticClickSuppression(), 0);
        }}
        onClick={(event) => {
          if (suppressMouseClickRef.current) {
            suppressMouseClickRef.current = false;
            return;
          }
          if (gestureRef.current.consumeSyntheticClick()) return;
          chooseAt(tileFromPointer(event), { ctrl: event.ctrlKey, shift: event.shiftKey });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          inspect(tileFromPointer(event), { x: event.clientX + 8, y: event.clientY + 8 });
        }}
        onKeyDown={(event) => {
          const delta =
            event.key === "ArrowUp"
              ? { x: 0, y: -1 }
              : event.key === "ArrowDown"
                ? { x: 0, y: 1 }
                : event.key === "ArrowLeft"
                  ? { x: -1, y: 0 }
                  : event.key === "ArrowRight"
                    ? { x: 1, y: 0 }
                    : null;
          if (delta !== null) {
            event.preventDefault();
            const next = {
              x: Math.min(arena.width - 1, Math.max(0, keyboardTile.x + delta.x)),
              y: Math.min(arena.height - 1, Math.max(0, keyboardTile.y + delta.y)),
            };
            setKeyboardTile(next);
            onCursor(next);
          } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            inspect(keyboardTile, {
              x:
                bounds.left +
                fit.offsetX +
                transform.x +
                (keyboardTile.x + 1) * TILE_SIZE * fitScale * transform.scale,
              y:
                bounds.top +
                fit.offsetY +
                transform.y +
                keyboardTile.y * TILE_SIZE * fitScale * transform.scale,
            });
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            chooseAt(keyboardTile, { ctrl: event.ctrlKey, shift: event.shiftKey });
          }
        }}
        data-cursor-state={cursorState}
        data-targeting-active={firingInteractionActive ? "true" : "false"}
        data-zoomed={transform.scale > 1 ? "true" : "false"}
      >
        <div
          className="planner-canvas-content"
          style={{
            transform: `translate(${fit.offsetX + transform.x}px, ${fit.offsetY + transform.y}px) scale(${fitScale * transform.scale})`,
          }}
        >
          <div ref={hostRef} className="absolute inset-0" />
        </div>
        {tooltip === null ? null : (
          <div
            className="planner-tile-tooltip"
            data-flip={tooltipFlip ? "true" : "false"}
            style={{ left: tooltipLeft, top: tooltipTop }}
            aria-hidden="true"
          >
            {tooltip.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        )}
        {targetingOverlay === null ? null : (
          <TargetingLegend
            overlay={targetingOverlay}
            onAssumedPosture={onAssumedPosture}
            onBlockBoardHover={() => onCursor(null)}
          />
        )}
        {status !== "ready" ? (
          <div className="planner-canvas-loading" role="status">
            {status === "error" ? "Renderer unavailable" : "Loading tactical grid…"}
          </div>
        ) : null}
      </div>
      <div className="planner-camera-controls">
        <span>Drag to pan · wheel or pinch to zoom</span>
        <CameraControls
          label="Planning board zoom"
          zoom={transform.scale}
          canZoomIn={transform.scale < MAX_ZOOM}
          canZoomOut={transform.scale > MIN_ZOOM}
          disabled={status !== "ready"}
          dataAttribute="planner"
          onZoomIn={() => zoomByStep(ZOOM_STEP)}
          onZoomOut={() => zoomByStep(1 / ZOOM_STEP)}
          onZoomReset={() => setTransform({ x: 0, y: 0, scale: 1 })}
        />
      </div>
    </div>
  );
}
