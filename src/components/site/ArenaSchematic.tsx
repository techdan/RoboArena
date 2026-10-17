"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { Arena } from "../../engine/types";
import {
  blockGroup,
  cornerAtTile,
  homeRects,
  outsideCorners,
  showsSouthFace,
  terrainAt,
  tileNoise,
  type BlockGroup,
  type Corner,
} from "../../lib/presentation/arenaSchematic";
import type { PlayerColor } from "../../lib/setup/validate";
import { ARENA_THEMES, type ArenaThemeId } from "../../renderer3d/themes";

export interface SchematicHome {
  /** Team colour of the seat holding this corner; omit for an open corner. */
  readonly color?: PlayerColor;
  readonly label?: string;
  readonly self?: boolean;
}

const TEAM_HEX: Readonly<Record<PlayerColor, string>> = {
  red: "#ef5350",
  blue: "#4c8dff",
  green: "#42c77a",
  yellow: "#f2c94c",
};

/** Block palette: concrete caps over brick (walls) and sandbag (low walls), as in the 3D arena. */
const BLOCKS: Readonly<
  Record<BlockGroup, { cap: string; capEdge: string; face: string; mortar: string; height: number }>
> = {
  wall: { cap: "#77716b", capEdge: "#958e86", face: "#8a3d31", mortar: "#5e281f", height: 0.34 },
  "low-wall": {
    cap: "#a08a6d",
    capEdge: "#bba586",
    face: "#6e5a45",
    mortar: "#55442f",
    height: 0.18,
  },
};

const OUTER_CAP = "#5d5953";

const ORDER: readonly Corner[] = ["NW", "NE", "SE", "SW"];

interface Layout {
  readonly cell: number;
  readonly ox: number;
  readonly oy: number;
}

const roundedTile = (
  path: Path2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  corners: readonly [boolean, boolean, boolean, boolean],
) => {
  path.roundRect(
    x,
    y,
    w,
    h,
    corners.map((round) => (round ? r : 0)),
  );
};

function paint(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  themeId: ArenaThemeId,
  homes: Partial<Record<Corner, SchematicHome>> | undefined,
  hovered: Corner | null,
  layout: Layout,
  size: { readonly width: number; readonly height: number },
  monoFont: string,
) {
  const { cell, ox, oy } = layout;
  const floor = ARENA_THEMES[themeId].floor;
  const W = arena.width * cell;
  const H = arena.height * cell;
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, Math.max(4, cell * 0.4));
  ctx.clip();

  // Floor: theme concrete with per-tile mottling and faint seams.
  ctx.fillStyle = floor.base;
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < arena.height; y += 1) {
    for (let x = 0; x < arena.width; x += 1) {
      const n = tileNoise(x, y);
      ctx.fillStyle = n > 0.5 ? `rgba(255,255,255,${(n - 0.5) * 0.07})` : `rgba(0,0,0,${n * 0.14})`;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  if (cell >= 7) {
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < arena.width; x += 1) {
      ctx.moveTo(Math.round(x * cell) + 0.5, 0);
      ctx.lineTo(Math.round(x * cell) + 0.5, H);
    }
    for (let y = 1; y < arena.height; y += 1) {
      ctx.moveTo(0, Math.round(y * cell) + 0.5);
      ctx.lineTo(W, Math.round(y * cell) + 0.5);
    }
    ctx.stroke();
  }

  // Home corners sit under the terrain, like painted floor zones.
  const rects = homeRects(arena.width, arena.height);
  if (homes !== undefined) {
    for (const corner of ORDER) {
      const rect = rects[corner];
      const home = homes[corner];
      const hex = home?.color === undefined ? null : TEAM_HEX[home.color];
      ctx.fillStyle =
        hex === null
          ? hovered === corner
            ? "rgba(255,255,255,0.10)"
            : "rgba(255,255,255,0.035)"
          : `${hex}${hovered === corner ? "3a" : "26"}`;
      ctx.fillRect(rect.x * cell, rect.y * cell, rect.width * cell, rect.height * cell);
    }
  }

  // Rough ground: darker patch scattered with pebbles.
  for (let y = 0; y < arena.height; y += 1) {
    for (let x = 0; x < arena.width; x += 1) {
      if (terrainAt(arena, x, y) !== "rough") continue;
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = floor.rough;
      ctx.beginPath();
      ctx.roundRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4, cell * 0.45);
      ctx.fill();
      ctx.restore();
      const pebbles = 3 + Math.floor(tileNoise(x, y, 7) * 3);
      for (let i = 0; i < pebbles; i += 1) {
        const px = (x + 0.2 + tileNoise(x, y, 11 + i) * 0.6) * cell;
        const py = (y + 0.2 + tileNoise(x, y, 23 + i) * 0.6) * cell;
        const r = cell * (0.06 + tileNoise(x, y, 37 + i) * 0.07);
        ctx.fillStyle = i % 2 === 0 ? "#7a736a" : "#5b554e";
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Crevices: dark trenches with a faint ember glow along the edge.
  for (let y = 0; y < arena.height; y += 1) {
    for (let x = 0; x < arena.width; x += 1) {
      if (terrainAt(arena, x, y) !== "crevice") continue;
      ctx.fillStyle = "#0b0907";
      ctx.beginPath();
      ctx.roundRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2, cell * 0.25);
      ctx.fill();
      ctx.strokeStyle = floor.creviceGlow;
      ctx.lineWidth = Math.max(1, cell * 0.08);
      ctx.stroke();
    }
  }

  // Bushes: soft shadow, then three overlapping leaf clumps per tile.
  for (let y = 0; y < arena.height; y += 1) {
    for (let x = 0; x < arena.width; x += 1) {
      if (terrainAt(arena, x, y) !== "bush") continue;
      const cx = (x + 0.5) * cell;
      const cy = (y + 0.5) * cell;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(cx + cell * 0.08, cy + cell * 0.18, cell * 0.42, cell * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 3; i += 1) {
        const angle = tileNoise(x, y, 51) * Math.PI * 2 + (i * Math.PI * 2) / 3;
        const bx = cx + Math.cos(angle) * cell * 0.16;
        const by = cy + Math.sin(angle) * cell * 0.14 - cell * 0.04;
        const r = cell * (0.22 + tileNoise(x, y, 61 + i) * 0.06);
        ctx.fillStyle = "#3d8a4c";
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#66b96f";
        ctx.beginPath();
        ctx.arc(bx - r * 0.25, by - r * 0.3, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Raised blocks: one merged shadow, then brick faces, then concrete caps.
  for (const group of ["low-wall", "wall"] as const) {
    const style = BLOCKS[group];
    const face = cell * style.height;
    const radius = cell * 0.22;
    const shadow = new Path2D();
    const faces = new Path2D();
    const caps = new Path2D();
    const outerCaps = new Path2D();
    for (let y = 0; y < arena.height; y += 1) {
      for (let x = 0; x < arena.width; x += 1) {
        const terrain = terrainAt(arena, x, y);
        if (blockGroup(terrain) !== group) continue;
        const corners = outsideCorners(arena, x, y);
        const px = x * cell;
        const py = y * cell;
        roundedTile(shadow, px, py, cell, cell, radius, corners);
        if (showsSouthFace(arena, x, y)) {
          roundedTile(faces, px, py + cell - face - 1, cell, face + 1, radius, [
            false,
            false,
            corners[2],
            corners[3],
          ]);
          roundedTile(
            terrain === "outer-wall" ? outerCaps : caps,
            px,
            py,
            cell,
            cell - face,
            radius,
            [corners[0], corners[1], false, false],
          );
        } else {
          roundedTile(
            terrain === "outer-wall" ? outerCaps : caps,
            px,
            py,
            cell,
            cell,
            radius,
            corners,
          );
        }
      }
    }
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = cell * (group === "wall" ? 0.7 : 0.4);
    ctx.shadowOffsetX = cell * 0.12;
    ctx.shadowOffsetY = cell * (group === "wall" ? 0.32 : 0.18);
    ctx.fillStyle = style.face;
    ctx.fill(shadow);
    ctx.restore();
    ctx.fillStyle = style.face;
    ctx.fill(faces);
    if (cell >= 10) {
      // Brick coursing on visible faces.
      ctx.save();
      ctx.clip(faces);
      ctx.strokeStyle = style.mortar;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 0; y < arena.height; y += 1) {
        const lineY = Math.round((y + 1) * cell - face / 2) + 0.5;
        ctx.moveTo(0, lineY);
        ctx.lineTo(W, lineY);
      }
      ctx.stroke();
      ctx.restore();
    }
    const capGradient = ctx.createLinearGradient(0, 0, 0, H);
    capGradient.addColorStop(0, style.capEdge);
    capGradient.addColorStop(1, style.cap);
    ctx.fillStyle = capGradient;
    ctx.fill(caps);
    ctx.fillStyle = OUTER_CAP;
    ctx.fill(outerCaps);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.stroke(caps);
  }

  // Floodlight pools and a vignette tie the board to the Coliseum lighting.
  const pool = (x: number, y: number, r: number, alpha: number) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(255,236,205,${alpha})`);
    gradient.addColorStop(1, "rgba(255,236,205,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
  };
  pool(W * 0.3, H * 0.28, Math.max(W, H) * 0.55, 0.09);
  pool(W * 0.78, H * 0.7, Math.max(W, H) * 0.45, 0.06);
  const vignette = ctx.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.35,
    W / 2,
    H / 2,
    Math.max(W, H) * 0.75,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // Home outlines and labels sit on top so they stay readable over walls.
  if (homes !== undefined) {
    const fontSize = Math.max(10, Math.min(15, cell * 0.85));
    ctx.font = `700 ${fontSize}px ${monoFont}`;
    ctx.textBaseline = "middle";
    for (const corner of ORDER) {
      const rect = rects[corner];
      const home = homes[corner];
      const hex = home?.color === undefined ? null : TEAM_HEX[home.color];
      const x = rect.x * cell;
      const y = rect.y * cell;
      const w = rect.width * cell;
      const h = rect.height * cell;
      ctx.save();
      if (hex === null) {
        ctx.strokeStyle = hovered === corner ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.32)";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = hex;
        ctx.lineWidth = home?.self === true ? 3 : 2;
        ctx.shadowColor = hex;
        ctx.shadowBlur = home?.self === true ? 14 : 8;
      }
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, w - 4, h - 4, Math.max(3, cell * 0.3));
      ctx.stroke();
      ctx.restore();

      const text = home?.label === undefined ? corner : `${corner} · ${home.label}`;
      const padding = fontSize * 0.5;
      const textWidth = Math.min(ctx.measureText(text).width, w - padding * 4);
      const chipW = textWidth + padding * 2;
      const chipH = fontSize * 1.7;
      const west = corner.endsWith("W");
      const north = corner.startsWith("N");
      const chipX = west ? x + 6 : x + w - 6 - chipW;
      const chipY = north ? y + 6 : y + h - 6 - chipH;
      ctx.fillStyle = "rgba(5,7,13,0.82)";
      ctx.beginPath();
      ctx.roundRect(chipX, chipY, chipW, chipH, chipH / 2);
      ctx.fill();
      ctx.fillStyle = hex ?? "rgba(238,242,248,0.75)";
      ctx.fillText(text, chipX + padding, chipY + chipH / 2, textWidth);
    }
  }
  ctx.restore();
}

/**
 * Illustrated top-down map drawn from the original tile data: raised walls
 * with brick faces, bushes, rough ground, crevices and home corners. Painted
 * once per change on a 2D canvas (no animation loop, no WebGL), so it is safe
 * on integrated graphics. Corner clicks are an enhancement; pages must also
 * offer corner buttons for keyboard users.
 */
export function ArenaSchematic({
  arena,
  theme = "coliseum",
  homes,
  onCornerSelect,
  label,
  className,
}: {
  readonly arena: Arena;
  readonly theme?: ArenaThemeId;
  readonly homes?: Partial<Record<Corner, SchematicHome>>;
  readonly onCornerSelect?: (corner: Corner) => void;
  readonly label: string;
  readonly className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const [hovered, setHovered] = useState<Corner | null>(null);
  const [box, setBox] = useState<{ readonly width: number; readonly height: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setBox((current) =>
        current !== null && current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || box === null || box.width === 0 || box.height === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(box.width * ratio);
    const height = Math.round(box.height * ratio);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const cell = Math.min(width / arena.width, height / arena.height);
    const layout = {
      cell,
      ox: (width - cell * arena.width) / 2,
      oy: (height - cell * arena.height) / 2,
    };
    layoutRef.current = { cell: cell / ratio, ox: layout.ox / ratio, oy: layout.oy / ratio };
    const mono =
      getComputedStyle(document.documentElement).getPropertyValue("--font-site-mono").trim() ||
      "ui-monospace, monospace";
    paint(ctx, arena, theme, homes, hovered, layout, { width, height }, mono);
  }, [arena, theme, homes, hovered, box]);

  const cornerFromPointer = useCallback(
    (event: MouseEvent<HTMLCanvasElement>): Corner | null => {
      const layout = layoutRef.current;
      if (layout === null) return null;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left - layout.ox) / layout.cell);
      const y = Math.floor((event.clientY - rect.top - layout.oy) / layout.cell);
      if (x < 0 || y < 0 || x >= arena.width || y >= arena.height) return null;
      return cornerAtTile(arena.width, arena.height, x, y);
    },
    [arena.width, arena.height],
  );

  const interactive = onCornerSelect !== undefined;
  return (
    <div
      ref={wrapRef}
      className={["site-schematic", className].filter(Boolean).join(" ")}
      style={{ aspectRatio: `${arena.width} / ${arena.height}` }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        style={{ cursor: interactive && hovered !== null ? "pointer" : "default" }}
        onPointerMove={interactive ? (event) => setHovered(cornerFromPointer(event)) : undefined}
        onPointerLeave={interactive ? () => setHovered(null) : undefined}
        onClick={
          interactive
            ? (event) => {
                const corner = cornerFromPointer(event);
                if (corner !== null) onCornerSelect(corner);
              }
            : undefined
        }
      />
    </div>
  );
}
