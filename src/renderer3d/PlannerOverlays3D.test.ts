import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PlannerOverlays3D } from "./PlannerOverlays3D";

const shaderMaterials = (root: THREE.Object3D): THREE.ShaderMaterial[] => {
  const found: THREE.ShaderMaterial[] = [];
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    for (const entry of material === undefined ? [] : [material].flat())
      if (entry instanceof THREE.ShaderMaterial) found.push(entry);
  });
  return found;
};

/** Every `pow(` call's base argument, up to its first top-level comma. */
const powBases = (source: string): string[] => {
  const bases: string[] = [];
  for (let at = source.indexOf("pow("); at !== -1; at = source.indexOf("pow(", at + 4)) {
    let depth = 0;
    let end = at + 4;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) break;
    }
    bases.push(source.slice(at + 4, end).trim());
  }
  return bases;
};

describe("PlannerOverlays3D", () => {
  it("clamps the selection column's pow base so the bloom pass never sees NaN", () => {
    // GLSL pow(x, y) is undefined for x < 0. On ANGLE/Direct3D, 1.0 - vH can
    // interpolate a hair below zero at the column top; the NaN that pow then
    // returns lands in the HDR target and UnrealBloom smears it over the
    // whole board, which turned the planner black on selecting a robot.
    const overlays = new PlannerOverlays3D();
    overlays.selection({ x: 4, y: 4 }, "#ff1a14");

    const sources = shaderMaterials(overlays.group).map((material) => material.fragmentShader);
    const bases = sources.flatMap(powBases);

    expect(bases.length).toBeGreaterThan(0);
    for (const base of bases) expect(base).toMatch(/^(clamp|max)\(/);
  });
});
