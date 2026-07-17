/** Source-lock the Foundry Plate asset registry and generated robot rig contract. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Posture } from "../engine/types";
import {
  ARENA_ASSET_URLS,
  EFFECT_ASSET_URLS,
  MARKER_ASSET_URLS,
  ROBOT_BODY_ASSETS,
  ROBOT_SPRITE_GEOMETRY,
  ROBOT_TURRET_ASSETS,
} from "./assets";

const PAINT_GRADIENT = ["#d8453a", "#a3241f", "#5f1213"] as const;
const PAINT_ACCENT = "#c8362e";
const PAINT_EDGE = "#ff9d8c";
const POSTURES: readonly Posture[] = ["upright", "ducking", "crouching"];

const publicAsset = (url: string) => resolve(process.cwd(), "public", url.replace(/^\//, ""));
const readAsset = (url: string) => readFile(publicAsset(url), "utf8");

describe("Foundry Plate asset registry", () => {
  it("points every registered URL at well-formed XML-safe SVG source", async () => {
    const urls = [
      ...ARENA_ASSET_URLS,
      ...Object.values(ROBOT_BODY_ASSETS).flatMap((bodies) => Object.values(bodies)),
      ...Object.values(ROBOT_TURRET_ASSETS),
      ...EFFECT_ASSET_URLS,
      ...MARKER_ASSET_URLS,
    ];
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      const svg = await readAsset(url);
      expect(svg, url).toMatch(/^<svg\b/);
      expect(svg, url).toContain("</svg>");
      expect(svg, url).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i);
    }
  });

  it("keeps generated body geometry and recolor hooks aligned with the renderer", async () => {
    for (const [robotClass, bodies] of Object.entries(ROBOT_BODY_ASSETS)) {
      for (const posture of POSTURES) {
        const svg = await readAsset(bodies[posture]);
        expect(svg, `${robotClass}:${posture}`).toContain('viewBox="0 0 128 128"');
        expect(svg, `${robotClass}:${posture}`).toContain(
          `data-turret-pivot="64 ${ROBOT_SPRITE_GEOMETRY.turretPivotY[posture]}"`,
        );
        for (const paint of PAINT_GRADIENT)
          expect(svg, `${robotClass}:${posture}`).toContain(paint);
        expect(svg, `${robotClass}:${posture}`).toContain(PAINT_EDGE);
      }
    }
  });

  it("keeps generated turret pivots and baked scale aligned with the renderer", async () => {
    for (const [robotClass, url] of Object.entries(ROBOT_TURRET_ASSETS)) {
      const svg = await readAsset(url);
      expect(svg, robotClass).toContain('viewBox="0 0 96 96"');
      expect(svg, robotClass).toContain('data-pivot="48 48"');
      expect(svg, robotClass).toContain('data-scale-baked="1.18"');
      for (const paint of PAINT_GRADIENT) expect(svg, robotClass).toContain(paint);
      expect(svg, robotClass).toContain(PAINT_ACCENT);
    }
  });
});
