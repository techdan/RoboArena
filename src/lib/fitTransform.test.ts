import { describe, expect, it } from "vitest";
import { clampContentOffset, fitTransform, fitWidthZoomFloor } from "./fitTransform";

describe("fitTransform", () => {
  it("fits on the binding axis and centers the other (wide viewport)", () => {
    const fit = fitTransform(1200, 600, 768, 768);
    expect(fit.scale).toBeCloseTo(600 / 768);
    expect(fit.offsetY).toBe(0);
    expect(fit.offsetX).toBeCloseTo((1200 - 768 * (600 / 768)) / 2);
  });

  it("fits on the binding axis and centers the other (tall viewport)", () => {
    const fit = fitTransform(600, 1200, 768, 768);
    expect(fit.scale).toBeCloseTo(600 / 768);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBeCloseTo((1200 - 768 * (600 / 768)) / 2);
  });

  it("is identity when the viewport equals the content", () => {
    expect(fitTransform(768, 768, 768, 768)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it("centers symmetrically: content center maps to viewport center", () => {
    const fit = fitTransform(1443, 901, 576, 576);
    expect(fit.offsetX + (576 / 2) * fit.scale).toBeCloseTo(1443 / 2);
    expect(fit.offsetY + (576 / 2) * fit.scale).toBeCloseTo(901 / 2);
  });

  describe('mode "width"', () => {
    it("fills the full viewport width with no horizontal offset", () => {
      const fit = fitTransform(1280, 720, 768, 768, "width");
      expect(fit.scale).toBeCloseTo(1280 / 768);
      expect(fit.offsetX).toBeCloseTo(0);
      expect(768 * fit.scale).toBeCloseTo(1280);
    });

    it("crops vertically (negative offsetY) when the arena is taller than the viewport", () => {
      const fit = fitTransform(1280, 720, 768, 768, "width");
      // Square arena at width scale is 1280px tall — taller than the 720 viewport.
      expect(768 * fit.scale).toBeGreaterThan(720);
      expect(fit.offsetY).toBeLessThan(0);
      // Symmetric crop: content center still maps to viewport center.
      expect(fit.offsetY + (768 / 2) * fit.scale).toBeCloseTo(720 / 2);
    });
  });
});

describe("fitWidthZoomFloor", () => {
  it("is the contain-to-width ratio, letting zoom-out reveal the whole arena", () => {
    const floor = fitWidthZoomFloor(1280, 720, 768, 768);
    const containScale = Math.min(1280 / 768, 720 / 768);
    const widthScale = 1280 / 768;
    expect(floor).toBeCloseTo(containScale / widthScale);
    // At the floor the fit-width camera shows exactly the contain scale.
    expect(widthScale * floor).toBeCloseTo(containScale);
  });

  it("never exceeds 1 (fit-width already fills the width)", () => {
    expect(fitWidthZoomFloor(1280, 720, 768, 768)).toBeLessThanOrEqual(1);
    expect(fitWidthZoomFloor(1024, 768, 768, 768)).toBeLessThanOrEqual(1);
  });

  it("is 1 when the arena already fits within the viewport height", () => {
    // Tall viewport: width scale binds and the whole arena is visible already.
    expect(fitWidthZoomFloor(600, 1200, 768, 768)).toBeCloseTo(1);
  });
});

describe("clampContentOffset", () => {
  it("leaves an in-bounds pan untouched", () => {
    expect(clampContentOffset(-200, 1600, 800)).toBe(-200);
  });

  it("never lets the leading edge pull inside the viewport", () => {
    // Dragging right past the arena's left edge would open dead space.
    expect(clampContentOffset(120, 1600, 800)).toBe(0);
    expect(clampContentOffset(0, 1600, 800)).toBe(0);
  });

  it("never lets the trailing edge pull inside the viewport", () => {
    // Fully panned: content right edge sits exactly on the viewport right edge.
    expect(clampContentOffset(-5000, 1600, 800)).toBe(-800);
    expect(clampContentOffset(-800, 1600, 800) + 1600).toBe(800);
  });

  it("centers content too small to fill the viewport instead of panning it", () => {
    // Zoomed out past contain: there is no pan that covers the viewport.
    expect(clampContentOffset(-300, 600, 800)).toBe(100);
    expect(clampContentOffset(999, 600, 800)).toBe(100);
  });

  it("pins content that exactly fills the viewport", () => {
    expect(clampContentOffset(-40, 800, 800)).toBe(0);
    expect(clampContentOffset(40, 800, 800)).toBe(0);
  });

  it("keeps the viewport covered across a full drag sweep", () => {
    const content = 1600;
    const viewport = 800;
    for (let offset = -2400; offset <= 2400; offset += 37) {
      const clamped = clampContentOffset(offset, content, viewport);
      expect(clamped).toBeLessThanOrEqual(0);
      expect(clamped + content).toBeGreaterThanOrEqual(viewport);
    }
  });

  it("degrades to no pan rather than NaN on a degenerate viewport", () => {
    expect(clampContentOffset(Number.NaN, 1600, 800)).toBe(0);
    expect(clampContentOffset(10, Number.NaN, 800)).toBe(0);
  });
});
