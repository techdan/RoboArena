/** Art-direction presets for the 3D arena. Each theme pairs a Blender prop set
 *  (public/assets/models/arena/props-<id>.glb) with lighting, sky, floor paint
 *  and post-processing, so one renderer can wear very different looks.
 */

export type ArenaThemeId = "coliseum" | "neon" | "scrapyard";

export interface FloorPalette {
  readonly base: string;
  readonly mottleLight: string;
  readonly mottleDark: string;
  readonly plateTone: number;
  readonly rough: string;
  readonly gravel: readonly [number, number, number];
  readonly seam: string;
  readonly seamHighlight: string;
  readonly rivets: string | null;
  readonly creviceFill: string;
  readonly creviceGlow: string;
  readonly homeStripe: string;
  readonly scorchChance: number;
  /** Lines painted into the emissive map instead of the colour map (neon). */
  readonly glowSeams: string | null;
  readonly glowIntensity: number;
  readonly roughness: number;
  readonly metalness: number;
}

export interface ArenaTheme {
  readonly id: ArenaThemeId;
  readonly name: string;
  readonly tagline: string;
  readonly sky: readonly [string, string, string];
  readonly fog: { readonly color: number; readonly near: number; readonly far: number };
  readonly exposure: number;
  readonly hemi: { readonly sky: number; readonly ground: number; readonly intensity: number };
  readonly sun: {
    readonly color: number;
    readonly intensity: number;
    /** Direction toward the sun: azimuth from +X (radians) and elevation. */
    readonly azimuth: number;
    readonly elevation: number;
  };
  readonly rim: { readonly color: number; readonly intensity: number };
  readonly environment: number;
  readonly floodlights: { readonly color: number; readonly intensity: number; readonly beam: number } | null;
  readonly bloom: { readonly strength: number; readonly radius: number; readonly threshold: number };
  readonly vignette: number;
  readonly apron: number;
  readonly floor: FloorPalette;
  /** Drifting ambient motes: dust, embers or data sparks. */
  readonly motes: { readonly color: number; readonly count: number; readonly additive: boolean } | null;
  readonly robotGlow: number;
}

export const ARENA_THEMES: Readonly<Record<ArenaThemeId, ArenaTheme>> = {
  coliseum: {
    id: "coliseum",
    name: "Floodlit Coliseum",
    tagline: "Night match under stadium floodlights: ruined brick, wet concrete, long beams.",
    sky: ["#020308", "#0a1426", "#22304a"],
    fog: { color: 0x0b1018, near: 34, far: 90 },
    exposure: 1.0,
    hemi: { sky: 0x8fb4ff, ground: 0x2a2118, intensity: 0.24 },
    sun: { color: 0xfff0dc, intensity: 3.0, azimuth: -2.3, elevation: 0.85 },
    rim: { color: 0x6fa8ff, intensity: 1.15 },
    environment: 0.18,
    floodlights: { color: 0xfff0d8, intensity: 10, beam: 0.022 },
    bloom: { strength: 0.55, radius: 0.45, threshold: 0.82 },
    vignette: 0.34,
    apron: 0x16181a,
    floor: {
      base: "#3a3834",
      mottleLight: "rgba(140,128,104,0.10)",
      mottleDark: "rgba(10,10,12,0.16)",
      plateTone: 14,
      rough: "rgba(48, 38, 28, 0.75)",
      gravel: [60, 0.92, 0.8],
      seam: "rgba(6, 6, 6, 0.6)",
      seamHighlight: "rgba(200, 190, 170, 0.07)",
      rivets: "rgba(190, 180, 160, 0.16)",
      creviceFill: "rgba(20, 16, 12, 0.6)",
      creviceGlow: "rgba(255, 120, 40, 0.35)",
      homeStripe: "rgba(240, 170, 30, 0.08)",
      scorchChance: 0.07,
      glowSeams: null,
      glowIntensity: 0,
      roughness: 0.62,
      metalness: 0.08,
    },
    motes: { color: 0xffe2b0, count: 160, additive: true },
    robotGlow: 1.8,
  },
  neon: {
    id: "neon",
    name: "Neon Grid",
    tagline: "A synthwave holo-arena: obsidian monoliths, glowing grid, purple haze.",
    sky: ["#02010a", "#140630", "#3a0f4a"],
    fog: { color: 0x07021a, near: 30, far: 90 },
    exposure: 0.9,
    hemi: { sky: 0x4a32c8, ground: 0x030108, intensity: 0.22 },
    sun: { color: 0x9db8ff, intensity: 0.9, azimuth: -2.0, elevation: 1.05 },
    rim: { color: 0xff3cc8, intensity: 1.4 },
    environment: 0.12,
    floodlights: null,
    bloom: { strength: 0.6, radius: 0.35, threshold: 0.85 },
    vignette: 0.4,
    apron: 0x040309,
    floor: {
      base: "#06070c",
      mottleLight: "rgba(80,90,160,0.06)",
      mottleDark: "rgba(0,0,0,0.2)",
      plateTone: 6,
      rough: "rgba(20, 24, 40, 0.8)",
      gravel: [40, 1.1, 1.5],
      seam: "rgba(0, 0, 0, 0.0)",
      seamHighlight: "rgba(0,0,0,0)",
      rivets: null,
      creviceFill: "rgba(0, 0, 0, 0.8)",
      creviceGlow: "rgba(255, 60, 200, 0.7)",
      homeStripe: "rgba(255, 60, 200, 0.10)",
      scorchChance: 0,
      glowSeams: "rgba(40, 210, 255, 0.55)",
      glowIntensity: 0.35,
      roughness: 0.32,
      metalness: 0.35,
    },
    motes: { color: 0x6fe0ff, count: 140, additive: true },
    robotGlow: 2.2,
  },
  scrapyard: {
    id: "scrapyard",
    name: "Scrapyard Sunset",
    tagline: "Golden-hour desert junkyard: rusted containers, tyre stacks, dust in the air.",
    sky: ["#2b4f86", "#d9774a", "#ffcf86"],
    fog: { color: 0xd8a27a, near: 30, far: 95 },
    exposure: 0.95,
    hemi: { sky: 0xa8c8ff, ground: 0x6b4a2a, intensity: 0.85 },
    sun: { color: 0xffb27a, intensity: 3.4, azimuth: -2.6, elevation: 0.42 },
    rim: { color: 0x7fa7ff, intensity: 0.6 },
    environment: 0.45,
    floodlights: null,
    bloom: { strength: 0.32, radius: 0.5, threshold: 0.92 },
    vignette: 0.28,
    apron: 0x8a6a48,
    floor: {
      base: "#9a7a52",
      mottleLight: "rgba(255,230,180,0.10)",
      mottleDark: "rgba(70,45,20,0.14)",
      plateTone: 10,
      rough: "rgba(110, 82, 50, 0.7)",
      gravel: [110, 0.86, 0.66],
      seam: "rgba(70, 48, 26, 0.32)",
      seamHighlight: "rgba(255, 235, 200, 0.06)",
      rivets: null,
      creviceFill: "rgba(60, 38, 18, 0.65)",
      creviceGlow: "rgba(0, 0, 0, 0)",
      homeStripe: "rgba(255, 255, 255, 0.10)",
      scorchChance: 0.04,
      glowSeams: null,
      glowIntensity: 0,
      roughness: 0.95,
      metalness: 0,
    },
    motes: { color: 0xf3d2a0, count: 260, additive: false },
    robotGlow: 1.4,
  },
};

export const DEFAULT_ARENA_THEME: ArenaThemeId = "coliseum";

export const isArenaThemeId = (value: unknown): value is ArenaThemeId =>
  value === "coliseum" || value === "neon" || value === "scrapyard";
