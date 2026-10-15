/** Armed Time Bomb glyph shared by the 2D movie and the planner board. */

import type { Graphics } from "pixi.js";

export const BOMB_MARKER_COLORS = {
  body: 0x1d1f22,
  rim: 0xffb347,
  fuse: 0xff4d3d,
} as const;

/** Draws a round bomb with a lit fuse centered at (x, y); `size` is the tile size in pixels. */
export const drawBombMarker = (
  graphics: Graphics,
  x: number,
  y: number,
  size: number,
): Graphics => {
  const radius = size * 0.26;
  return graphics
    .circle(x, y + radius * 0.15, radius)
    .fill({ color: BOMB_MARKER_COLORS.body, alpha: 0.95 })
    .stroke({ color: BOMB_MARKER_COLORS.rim, width: Math.max(1.5, size * 0.05), alpha: 0.95 })
    .moveTo(x + radius * 0.55, y - radius * 0.6)
    .lineTo(x + radius * 0.95, y - radius * 1.15)
    .stroke({ color: BOMB_MARKER_COLORS.rim, width: Math.max(1, size * 0.04) })
    .circle(x + radius * 1.0, y - radius * 1.25, Math.max(1.5, size * 0.06))
    .fill({ color: BOMB_MARKER_COLORS.fuse });
};
