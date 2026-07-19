import { describe, expect, it } from "vitest";
import { fitTransform } from "./fitTransform";

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
});
