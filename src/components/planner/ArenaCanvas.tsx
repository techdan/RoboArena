"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { Application, Container } from "pixi.js";
import type { Arena, Heading, Posture, RobotClass, TileCoord } from "../../engine/types";
import { ARENA_ASSET_URLS, TERRAIN_ASSETS } from "../../renderer/assets";

const TILE_SIZE = 24;
const TEAM_COLORS: Readonly<Record<string, number>> = {
  red: 0xef5350,
  blue: 0x4c8dff,
  green: 0x42c77a,
  yellow: 0xf2c94c,
};
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

export interface ArenaCanvasProps {
  readonly arena: Arena;
  readonly robots: readonly PlannerRobotView[];
  readonly route: readonly TileCoord[];
  readonly cursor: TileCoord | null;
  readonly cursorState: "valid" | "blocked" | "out-of-home" | "out-of-bounds";
  readonly onCursor: (tile: TileCoord | null) => void;
  readonly onChooseTile: (tile: TileCoord) => void;
}

export function ArenaCanvas({
  arena,
  robots,
  route,
  cursor,
  cursorState,
  onCursor,
  onChooseTile,
}: ArenaCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const overlayRef = useRef<Container | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [keyboardTile, setKeyboardTile] = useState<TileCoord>({ x: 0, y: 0 });

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
        ARENA_ASSET_URLS.map(async (url) => [url, await Assets.load(url)] as const),
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
  }, [cursor, cursorState, keyboardTile, robots, route, status]);

  const tileFromPointer = (
    event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>,
  ): TileCoord => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(
        arena.width - 1,
        Math.max(0, Math.floor((event.clientX - bounds.left) / TILE_SIZE)),
      ),
      y: Math.min(
        arena.height - 1,
        Math.max(0, Math.floor((event.clientY - bounds.top) / TILE_SIZE)),
      ),
    };
  };

  return (
    <div
      className="planner-canvas"
      style={{ width: arena.width * TILE_SIZE, height: arena.height * TILE_SIZE }}
      role="application"
      aria-label={`${arena.sizeName} planning board. Use arrow keys and Enter to choose a tile.`}
      tabIndex={0}
      onPointerMove={(event) => onCursor(tileFromPointer(event))}
      onPointerLeave={() => onCursor(null)}
      onClick={(event) => onChooseTile(tileFromPointer(event))}
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
          setKeyboardTile((tile) => ({
            x: Math.min(arena.width - 1, Math.max(0, tile.x + delta.x)),
            y: Math.min(arena.height - 1, Math.max(0, tile.y + delta.y)),
          }));
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChooseTile(keyboardTile);
        }
      }}
      data-cursor-state={cursorState}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {status !== "ready" ? (
        <div className="planner-canvas-loading" role="status">
          {status === "error" ? "Renderer unavailable" : "Loading tactical grid…"}
        </div>
      ) : null}
    </div>
  );
}
