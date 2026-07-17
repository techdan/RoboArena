/**
 * Per-team robot texture loading for the Foundry Plate sprite set.
 *
 * Team identity is chassis paint, not tint (locked 2026-07-08 encoding): a
 * Pixi `tint` would multiply the grey steel too, so instead we fetch each
 * generated SVG's source, swap the five known paint-hook hex values for the
 * team palette, rasterize to a canvas, and cache the resulting texture per
 * (file, team). See docs/asset-manifest.md.
 */

import { Assets, Texture } from "pixi.js";
import type { Posture, RobotClass } from "../engine/types";
import {
  EFFECT_ASSETS,
  ROBOT_BODY_ASSETS,
  ROBOT_SPRITE_GEOMETRY,
  ROBOT_TURRET_ASSETS,
} from "./assets";

/** Paint-hook hexes baked into the generated SVGs, in replacement order:
 *  paint-light, paint-mid, paint-dark (fp-paint gradient stops), accent, edge. */
const BASE_PAINT = ["#d8453a", "#a3241f", "#5f1213", "#c8362e", "#ff9d8c"] as const;

type Palette = readonly [string, string, string, string, string];

const TEAM_PAINT: Readonly<Record<string, Palette>> = {
  red: BASE_PAINT,
  blue: ["#3f7fd9", "#2456a8", "#122f5f", "#2e6ac8", "#8cc4ff"],
  green: ["#3fae57", "#1f7a38", "#0f3f1c", "#2e9c4d", "#9df2b1"],
  yellow: ["#e0b73a", "#a8851f", "#5f4a12", "#c8a12e", "#ffe28c"],
};

export interface RobotTextureSet {
  readonly bodies: Readonly<Record<Posture, Texture>>;
  readonly turret: Texture;
  readonly wreck: Texture;
}

export const robotTextureKey = (robotClass: RobotClass, teamColor: string) =>
  `${robotClass}:${teamColor}`;

const textureCache = new Map<string, Promise<Texture>>();

const recolor = (svg: string, teamColor: string): string => {
  const palette = TEAM_PAINT[teamColor];
  if (palette === undefined || palette === BASE_PAINT) return svg;
  return BASE_PAINT.reduce((out, from, index) => out.replaceAll(from, palette[index] ?? from), svg);
};

/** Rasterizes SVG text at an explicit pixel size (width/height injected so
 *  viewBox-only files draw at full size in every browser). */
const rasterize = async (svg: string, px: number): Promise<Texture> => {
  const sized = svg.replace("<svg ", `<svg width="${px}" height="${px}" `);
  const blobUrl = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode a robot sprite SVG."));
      image.src = blobUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas 2D context unavailable.");
    context.drawImage(image, 0, 0, px, px);
    return Texture.from(canvas);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
};

const loadTeamTexture = async (url: string, teamColor: string, px: number): Promise<Texture> => {
  const cacheKey = `${url}#${teamColor}`;
  const cached = textureCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const loading = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch robot sprite ${url}.`);
    return rasterize(recolor(await response.text(), teamColor), px);
  })();
  textureCache.set(cacheKey, loading);
  try {
    return await loading;
  } catch (error) {
    textureCache.delete(cacheKey);
    throw error;
  }
};

/** Loads (and caches) the recolored body/turret/wreck textures for every
 *  distinct (class, team) pair present in a movie. */
export const loadRobotTextures = async (
  robots: readonly { readonly robotClass: RobotClass; readonly teamColor: string }[],
): Promise<Map<string, RobotTextureSet>> => {
  const wreck = await Assets.load<Texture>(EFFECT_ASSETS.wreck);
  const sets = new Map<string, RobotTextureSet>();
  const distinctRobots = [
    ...new Map(
      robots.map((robot) => [robotTextureKey(robot.robotClass, robot.teamColor), robot]),
    ).values(),
  ];
  await Promise.all(
    distinctRobots.map(async ({ robotClass, teamColor }) => {
      const key = robotTextureKey(robotClass, teamColor);
      const bodies = ROBOT_BODY_ASSETS[robotClass];
      const [upright, ducking, crouching, turret] = await Promise.all([
        loadTeamTexture(bodies.upright, teamColor, ROBOT_SPRITE_GEOMETRY.bodyBox),
        loadTeamTexture(bodies.ducking, teamColor, ROBOT_SPRITE_GEOMETRY.bodyBox),
        loadTeamTexture(bodies.crouching, teamColor, ROBOT_SPRITE_GEOMETRY.bodyBox),
        loadTeamTexture(
          ROBOT_TURRET_ASSETS[robotClass],
          teamColor,
          ROBOT_SPRITE_GEOMETRY.turretBox,
        ),
      ] as const);
      sets.set(key, { bodies: { upright, ducking, crouching }, turret, wreck });
    }),
  );
  return sets;
};
