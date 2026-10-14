/** Chooses between the cinematic 3D movie and the 2D tactical board, and
 *  remembers which arena look the player prefers. */

import { DEFAULT_ARENA_THEME, isArenaThemeId, type ArenaThemeId } from "./themes";

export type MovieRendererKind = "3d" | "2d";

const STORAGE_KEY = "roboarena.movieRenderer";

/** WebGL2 is the floor for the 3D movie (MSAA render targets, instancing). */
export const supportsWebGl2 = (): boolean => {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null;
  } catch {
    return false;
  }
};

/** A remembered choice wins; otherwise 3D wherever the browser can run it. */
export const preferredMovieRenderer = (): MovieRendererKind => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "2d" || stored === "3d")
      return stored === "3d" && !supportsWebGl2() ? "2d" : stored;
  } catch {
    // Storage blocked: fall through to detection.
  }
  return supportsWebGl2() ? "3d" : "2d";
};

const THEME_STORAGE_KEY = "roboarena.arenaTheme";

/** The player's remembered arena look, or the default Coliseum. */
export const preferredArenaTheme = (): ArenaThemeId => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isArenaThemeId(stored)) return stored;
  } catch {
    // Storage blocked: use the default look.
  }
  return DEFAULT_ARENA_THEME;
};

export const rememberArenaTheme = (theme: ArenaThemeId): void => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the choice just isn't remembered.
  }
};
