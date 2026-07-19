"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { Application, Container, Graphics as PixiGraphics } from "pixi.js";
import type { Arena, Heading, Posture, RobotClass, TileCoord } from "../../engine/types";
import { ARENA_ASSET_URLS, highResSvg, TERRAIN_ASSETS } from "../../renderer/assets";
import { isTileInScanGate } from "../../planner/firingHelpers";
import { useHelp } from "../help/HelpProvider";
import {
  LONG_PRESS_MS,
  TouchGestureArbitrator,
  pointDistance,
  transformForPinch,
  type Point,
} from "../../lib/input/pointerGestures";

const TILE_SIZE = 24;
const TEAM_COLORS: Readonly<Record<string, number>> = {
  red: 0xef5350,
  blue: 0x4c8dff,
  green: 0x42c77a,
  yellow: 0xf2c94c,
};
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

export interface ArenaCanvasProps {
  readonly arena: Arena;
  readonly robots: readonly PlannerRobotView[];
  readonly homeAreas: readonly HomeAreaOverlay[];
  readonly route: readonly TileCoord[];
  readonly cursor: TileCoord | null;
  readonly cursorState: "valid" | "blocked" | "out-of-home" | "out-of-bounds";
  readonly scanOverlay: {
    readonly origin: TileCoord;
    readonly heading: Heading;
    readonly maxDistance: number;
  } | null;
  readonly onCursor: (tile: TileCoord | null) => void;
  readonly onChooseTile: (
    tile: TileCoord,
    modifiers: { readonly ctrl: boolean; readonly shift: boolean },
  ) => void;
}

export function ArenaCanvas({
  arena,
  robots,
  homeAreas,
  route,
  cursor,
  cursorState,
  scanOverlay,
  onCursor,
  onChooseTile,
}: ArenaCanvasProps) {
  const { openTopic } = useHelp();
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const overlayRef = useRef<Container | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [keyboardTile, setKeyboardTile] = useState<TileCoord>({ x: 0, y: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;
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
      overlayRef.current = overlay;
      app.stage.addChild(overlay);
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
      destroy?.();
    };
  }, [arena]);

  useEffect(() => {
    const app = appRef.current;
    const overlay = overlayRef.current;
    if (app === null || overlay === null || status !== "ready") return;
    void (async () => {
      const { Graphics, Text } = await import("pixi.js");
      overlay.removeChildren().forEach((child) => child.destroy());
      for (const homeArea of homeAreas) {
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
      if (scanOverlay !== null) {
        const gate = new Graphics();
        for (let y = 0; y < arena.height; y += 1) {
          for (let x = 0; x < arena.width; x += 1) {
            const dx = x - scanOverlay.origin.x;
            const dy = y - scanOverlay.origin.y;
            if (Math.floor(Math.sqrt(dx * dx + dy * dy)) > scanOverlay.maxDistance) continue;
            const eligible = isTileInScanGate(scanOverlay.origin, scanOverlay.heading, { x, y });
            gate
              .rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
              .fill({ color: eligible ? 0x86efac : 0xfb7185, alpha: eligible ? 0.09 : 0.075 });
          }
        }
        overlay.addChild(gate);
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
        const body = new Graphics()
          .circle(centerX, centerY, robot.posture === "crouching" ? 7 : 9)
          .fill({ color: TEAM_COLORS[robot.color] ?? 0xffffff, alpha: 0.95 });
        body
          .circle(centerX, centerY, robot.selected ? 11 : 10)
          .stroke({ width: robot.selected ? 3 : 1, color: robot.selected ? 0xd9f99d : 0x111111 });
        const vector = HEADING_VECTOR[robot.scanHeading];
        body
          .moveTo(centerX, centerY)
          .lineTo(centerX + vector.x * 14, centerY + vector.y * 14)
          .stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
        overlay.addChild(body);
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
    })();
  }, [
    arena.height,
    arena.width,
    cursor,
    homeAreas,
    cursorState,
    keyboardTile,
    robots,
    route,
    scanOverlay,
    status,
  ]);

  const tileFromClient = (clientX: number, clientY: number, element: HTMLDivElement): TileCoord => {
    const bounds = element.getBoundingClientRect();
    const current = transformRef.current;
    return {
      x: Math.min(
        arena.width - 1,
        Math.max(0, Math.floor((clientX - bounds.left - current.x) / current.scale / TILE_SIZE)),
      ),
      y: Math.min(
        arena.height - 1,
        Math.max(0, Math.floor((clientY - bounds.top - current.y) / current.scale / TILE_SIZE)),
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

  return (
    <div
      className="planner-canvas"
      role="application"
      aria-label={`${arena.sizeName} planning board. Use arrow keys and Enter to choose a tile.`}
      tabIndex={0}
      style={{
        width: arena.width * TILE_SIZE,
        height: arena.height * TILE_SIZE,
        touchAction: "none",
      }}
      onFocus={() => onCursor(keyboardTile)}
      onPointerMove={(event) => {
        const tile = tileFromPointer(event);
        setKeyboardTile(tile);
        onCursor(tile);
        if (event.pointerType !== "touch") return;
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = [...pointersRef.current.values()];
        if (points.length >= 2) {
          cancelLongPress();
          const [first, second] = points;
          if (first === undefined || second === undefined) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const midpoint = {
            x: (first.x + second.x) / 2 - bounds.left,
            y: (first.y + second.y) / 2 - bounds.top,
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
        if (event.pointerType !== "touch") return;
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
              x: (first.x + second.x) / 2 - bounds.left,
              y: (first.y + second.y) / 2 - bounds.top,
            },
            startTransform: transformRef.current,
          };
          gestureRef.current.beginPinch();
        }
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== "touch") return;
        cancelLongPress();
        const active = touchRef.current;
        if (
          active !== null &&
          active.pointerId === event.pointerId &&
          gestureRef.current.end(event.pointerId)
        ) {
          onChooseTile(active.tile, { ctrl: false, shift: false });
        }
        window.setTimeout(() => gestureRef.current.clearSyntheticClickSuppression(), 0);
        pointersRef.current.delete(event.pointerId);
        if (pointersRef.current.size < 2) pinchRef.current = null;
        if (active?.pointerId === event.pointerId) touchRef.current = null;
      }}
      onPointerCancel={(event) => {
        cancelLongPress();
        pointersRef.current.delete(event.pointerId);
        touchRef.current = null;
        pinchRef.current = null;
        gestureRef.current.cancel();
        window.setTimeout(() => gestureRef.current.clearSyntheticClickSuppression(), 0);
      }}
      onClick={(event) => {
        if (gestureRef.current.consumeSyntheticClick()) return;
        onChooseTile(tileFromPointer(event), { ctrl: event.ctrlKey, shift: event.shiftKey });
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
            x: bounds.left + transform.x + (keyboardTile.x + 1) * TILE_SIZE * transform.scale,
            y: bounds.top + transform.y + keyboardTile.y * TILE_SIZE * transform.scale,
          });
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChooseTile(keyboardTile, { ctrl: event.ctrlKey, shift: event.shiftKey });
        }
      }}
      data-cursor-state={cursorState}
    >
      <div
        className="planner-canvas-content"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        <div ref={hostRef} className="absolute inset-0" />
      </div>
      {scanOverlay === null ? null : (
        <div className="scan-gate-legend" aria-label="Scan gate overlay legend">
          <span>
            <i data-kind="eligible" /> Eligible angle
          </span>
          <span>
            <i data-kind="blocked" /> Angle blocked
          </span>
        </div>
      )}
      {status !== "ready" ? (
        <div className="planner-canvas-loading" role="status">
          {status === "error" ? "Renderer unavailable" : "Loading tactical grid…"}
        </div>
      ) : null}
    </div>
  );
}
