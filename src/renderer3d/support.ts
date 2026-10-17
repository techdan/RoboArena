/** Chooses between the cinematic 3D movie and the 2D tactical board. */

export type MovieRendererKind = "3d" | "2d";

const STORAGE_KEY = "roboarena.movieRenderer";
const webGl2Support = new WeakMap<Document, boolean>();

/** WebGL2 is the floor for the 3D movie (MSAA render targets, instancing). */
export const supportsWebGl2 = (): boolean => {
  try {
    const cached = webGl2Support.get(document);
    if (cached !== undefined) return cached;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    const supported = context !== null;
    webGl2Support.set(document, supported);
    // A capability probe must not retain an otherwise unused GPU context.
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return supported;
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
