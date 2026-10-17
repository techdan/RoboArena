import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLANNER_2D_CHOICE_ENABLED,
  graphicsQualityFor,
  preferredGraphicsQuality,
  preferredPlannerBoard,
} from "./support";

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

describe("preferredGraphicsQuality", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults integrated and software GPUs to Light", () => {
    expect(graphicsQualityFor("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)")).toBe("light");
    expect(graphicsQualityFor("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))")).toBe("light");
  });

  it("defaults discrete or unknown GPUs to Full", () => {
    expect(graphicsQualityFor("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)")).toBe("full");
    expect(graphicsQualityFor(null)).toBe("full");
  });

  it("lets a remembered choice override the GPU default", () => {
    stubBrowser({ "roboarena.graphicsQuality": "full" }, true);
    expect(preferredGraphicsQuality("Intel(R) Iris(R) Xe Graphics")).toBe("full");
  });
});
