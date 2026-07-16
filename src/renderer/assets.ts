/** Phase 6 terrain texture registry. Paths resolve from Next.js `public/`. */

import type { Terrain } from "../engine/types";

export const TERRAIN_ASSETS: Readonly<Record<Terrain, string>> = {
  open: "/assets/terrain/open-ground.svg",
  rough: "/assets/terrain/rough-ground.svg",
  "low-wall": "/assets/terrain/low-wall.svg",
  wall: "/assets/terrain/wall.svg",
  bush: "/assets/terrain/bush.svg",
  crevice: "/assets/terrain/crevice.svg",
  "outer-wall": "/assets/terrain/outer-wall.svg",
};

export const TERRAIN_ASSET_URLS = [...new Set(Object.values(TERRAIN_ASSETS))];
