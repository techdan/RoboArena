import { describe, expect, it } from "vitest";

import { makeOpenArena, makeRobot } from "./__fixtures__/match.js";
import { findScanAndFireTarget, scanAlignmentMagnitude } from "./scanAndFire.js";

describe("Scan & Fire acquisition", () => {
  it("selects the nearest eligible enemy", () => {
    const shooter = makeRobot("s1", "team-1", "rifle", { x: 1, y: 3 });
    const farther = makeRobot("e1", "team-2", "rifle", { x: 8, y: 3 });
    const nearer = makeRobot("e2", "team-3", "rifle", { x: 4, y: 3 });
    const result = findScanAndFireTarget({
      arena: makeOpenArena(12, 8),
      shooter: { ...shooter, position: { x: 1, y: 3 } },
      shooterSide: 1,
      candidates: [
        { side: 2, robot: farther },
        { side: 3, robot: nearer },
      ],
      maxDistance: 10,
    });

    expect(result).toMatchObject({ robot: { id: nearer.id }, distance: 3 });
  });

  it("retains canonical candidate order for equal distances", () => {
    const shooter = makeRobot("s1", "team-1", "rifle", { x: 4, y: 4 });
    const first = makeRobot("first", "team-2", "rifle", { x: 7, y: 3 });
    const second = makeRobot("second", "team-3", "rifle", { x: 7, y: 5 });
    const result = findScanAndFireTarget({
      arena: makeOpenArena(10, 10),
      shooter: { ...shooter, position: { x: 4, y: 4 } },
      shooterSide: 1,
      candidates: [
        { side: 2, robot: first },
        { side: 3, robot: second },
      ],
      maxDistance: 10,
    });

    expect(result?.robot.id).toBe(first.id);
  });

  it("adds two to adjusted distance only on the exact cone boundary", () => {
    const shooter = makeRobot("s1", "team-1", "rifle", { x: 4, y: 4 });
    const boundary = makeRobot("boundary", "team-2", "rifle", { x: 4, y: 1 });
    const centered = makeRobot("centered", "team-3", "rifle", { x: 8, y: 4 });
    const result = findScanAndFireTarget({
      arena: makeOpenArena(10, 10),
      shooter: { ...shooter, position: { x: 4, y: 4 } },
      shooterSide: 1,
      candidates: [
        { side: 2, robot: boundary },
        { side: 3, robot: centered },
      ],
      maxDistance: 10,
    });

    expect(result).toMatchObject({
      robot: { id: centered.id },
      distance: 4,
      adjustedDistance: 4,
    });
  });

  it("filters same-Side, out-of-cone, out-of-distance, and bush-hidden robots", () => {
    const arena = makeOpenArena(12, 8);
    const bushArena = {
      ...arena,
      tiles: arena.tiles.map((row, y) =>
        row.map((tile, x) => (x === 4 && y === 3 ? { terrain: "bush" as const } : tile)),
      ),
    };
    const shooter = makeRobot("s1", "team-1", "rifle", { x: 2, y: 3 });
    const candidates = [
      { side: 1, robot: makeRobot("ally", "team-2", "rifle", { x: 3, y: 3 }) },
      { side: 2, robot: makeRobot("behind", "team-3", "rifle", { x: 1, y: 3 }) },
      { side: 2, robot: makeRobot("far", "team-3", "rifle", { x: 10, y: 3 }) },
      { side: 2, robot: makeRobot("hidden", "team-3", "rifle", { x: 6, y: 3 }) },
    ];

    expect(
      findScanAndFireTarget({
        arena: bushArena,
        shooter: { ...shooter, position: { x: 2, y: 3 } },
        shooterSide: 1,
        candidates,
        maxDistance: 6,
      }),
    ).toBeNull();
  });

  it("produces the live-fire alignment bands from geometric centering", () => {
    const from = { x: 5, y: 5 };
    expect(scanAlignmentMagnitude(from, "E", { x: 9, y: 5 })).toBe(16);
    expect(scanAlignmentMagnitude(from, "E", { x: 9, y: 9 })).toBeGreaterThan(8);
    expect(scanAlignmentMagnitude(from, "E", { x: 6, y: 9 })).toBeLessThanOrEqual(4);
    expect(scanAlignmentMagnitude(from, "E", { x: 5, y: 9 })).toBe(0);
  });
});
