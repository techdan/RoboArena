import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOVIE_2D_CHOICE_ENABLED,
  PLANNER_2D_CHOICE_ENABLED,
  preferredMovieRenderer,
  preferredPlannerBoard,
} from "./support";

const stubBrowser = (stored: Record<string, string>, webgl2: boolean) => {
  const loseContext = vi.fn();
  const getContext = vi.fn((kind: string) =>
    kind === "webgl2" && webgl2 ? { getExtension: () => ({ loseContext }) } : null,
  );
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => stored[key] ?? null } });
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext,
    }),
  });
  return { getContext, loseContext };
};

describe("preferredPlannerBoard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the 2D board choice hidden", () => {
    expect(PLANNER_2D_CHOICE_ENABLED).toBe(false);
  });

  it("ignores an earlier remembered 2D choice while that choice is hidden", () => {
    stubBrowser({ "roboarena.plannerBoard": "2d" }, true);
    expect(preferredPlannerBoard()).toBe("3d");
  });

  it("still falls back to the 2D board where WebGL2 is unavailable", () => {
    stubBrowser({}, false);
    expect(preferredPlannerBoard()).toBe("2d");
  });

  it("releases the probe context and reuses the result within the document", () => {
    const probe = stubBrowser({}, true);
    expect(preferredPlannerBoard()).toBe("3d");
    expect(preferredPlannerBoard()).toBe("3d");
    expect(probe.getContext).toHaveBeenCalledTimes(1);
    expect(probe.loseContext).toHaveBeenCalledTimes(1);
  });
});

describe("preferredMovieRenderer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the 2D movie choice hidden", () => {
    expect(MOVIE_2D_CHOICE_ENABLED).toBe(false);
  });

  it("ignores an earlier remembered 2D movie choice while that choice is hidden", () => {
    stubBrowser({ "roboarena.movieRenderer": "2d" }, true);
    expect(preferredMovieRenderer()).toBe("3d");
  });
});
