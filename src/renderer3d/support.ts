/** Chooses between the cinematic 3D movie and the 2D tactical board. */

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

export type PlannerView = "top" | "tilt" | "orbit";

const PLANNER_BOARD_KEY = "roboarena.plannerBoard";
const PLANNER_VIEW_KEY = "roboarena.plannerView";

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice simply isn't remembered.
  }
};

/**
 * Whether players may pick the 2D planner board. Hidden for now: the 2D board
 * stays in the codebase and still serves browsers without WebGL2 and the 3D
 * error fallback, but the camera bar offers no 2D switch and an earlier
 * remembered "2d" choice is ignored so nobody is stranded without a way back.
 */
export const PLANNER_2D_CHOICE_ENABLED = false;

/** The planner board follows the same rule as the movie: 3D where it can run. */
export const preferredPlannerBoard = (): MovieRendererKind => {
  const stored = read(PLANNER_BOARD_KEY);
  if (PLANNER_2D_CHOICE_ENABLED && stored === "2d") return "2d";
  return supportsWebGl2() ? "3d" : "2d";
};

export const rememberPlannerBoard = (kind: MovieRendererKind): void =>
  write(PLANNER_BOARD_KEY, kind);

/** Top-down is the planning default; tilted and orbit are opt-in. */
export const preferredPlannerView = (): PlannerView => {
  const stored = read(PLANNER_VIEW_KEY);
  return stored === "tilt" || stored === "orbit" ? stored : "top";
};

export const rememberPlannerView = (view: PlannerView): void => write(PLANNER_VIEW_KEY, view);

/**
 * Full adds ambient occlusion, bloom, MSAA, sharp shadows and a high-DPI
 * canvas; Light drops them so integrated GPUs keep the board responsive.
 */
export type GraphicsQuality = "full" | "light";

const GRAPHICS_QUALITY_KEY = "roboarena.graphicsQuality";

/** Integrated and software GPUs that struggle with the full post-processing stack. */
const LIGHT_GPU = /intel|swiftshader|llvmpipe|software|basic render|mali|adreno|powervr/i;

/** Default for a GPU with no remembered choice: Light on integrated or software GPUs. */
export const graphicsQualityFor = (gpu: string | null): GraphicsQuality =>
  gpu !== null && LIGHT_GPU.test(gpu) ? "light" : "full";

/** A remembered choice wins; otherwise the default for this GPU. */
export const preferredGraphicsQuality = (gpu: string | null): GraphicsQuality => {
  const stored = read(GRAPHICS_QUALITY_KEY);
  return stored === "full" || stored === "light" ? stored : graphicsQualityFor(gpu);
};

export const rememberGraphicsQuality = (quality: GraphicsQuality): void =>
  write(GRAPHICS_QUALITY_KEY, quality);
