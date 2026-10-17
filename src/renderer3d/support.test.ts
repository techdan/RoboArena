import { afterEach, describe, expect, it, vi } from "vitest";
import { PLANNER_2D_CHOICE_ENABLED, preferredPlannerBoard } from "./support";

const stubBrowser = (stored: Record<string, string>, webgl2: boolean) => {
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => stored[key] ?? null } });
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: (kind: string) => (kind === "webgl2" && webgl2 ? {} : null),
    }),
  });
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
});
