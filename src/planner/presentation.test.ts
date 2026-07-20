import { describe, expect, it } from "vitest";
import { makeRobot } from "../engine/__fixtures__/match";
import {
  commandPresentation,
  headingFromVector,
  removableSegmentIndex,
  robotDisplayNames,
  rotateHeading,
} from "./presentation";

describe("planner presentation", () => {
  it("uses class names and adds ordinals only for duplicate classes", () => {
    const robots = [
      makeRobot("r1", "t1", "rifle", "dock"),
      makeRobot("r2", "t1", "rifle", "dock"),
      makeRobot("b1", "t1", "burst", "dock"),
    ];
    const names = robotDisplayNames(robots);
    expect(names.get("r1")).toBe("Rifle 1");
    expect(names.get("r2")).toBe("Rifle 2");
    expect(names.get("b1")).toBe("Burst");
  });

  it("keeps essential firing and scan parameters in compact command copy", () => {
    expect(
      commandPresentation({
        kind: "aim-and-fire",
        target: { x: 5, y: 7 },
        weapon: "rifle",
        repeat: false,
      }),
    ).toMatchObject({
      label: "Aim & Fire",
      compact: "Rifle · 5,7",
      detail: "Rifle at tile 5,7",
    });
    expect(
      commandPresentation({
        kind: "scan-and-fire",
        weapon: "auto-rifle",
        maxDistance: 12,
        seconds: 4,
      }),
    ).toMatchObject({ label: "Scan & Fire", compact: "Auto · 12t · 4s" });
  });

  it("rotates through all eight headings and exposes only the tail for removal", () => {
    expect(rotateHeading("N", -1)).toBe("NW");
    expect(rotateHeading("NW", 1)).toBe("N");
    expect(removableSegmentIndex(0)).toBeNull();
    expect(removableSegmentIndex(4)).toBe(3);
  });

  it("maps circular pointer vectors to the nearest scan heading", () => {
    expect(headingFromVector(0, -1)).toBe("N");
    expect(headingFromVector(1, -1)).toBe("NE");
    expect(headingFromVector(1, 0)).toBe("E");
    expect(headingFromVector(1, 1)).toBe("SE");
    expect(headingFromVector(0, 1)).toBe("S");
    expect(headingFromVector(-1, 1)).toBe("SW");
    expect(headingFromVector(-1, 0)).toBe("W");
    expect(headingFromVector(-1, -1)).toBe("NW");
  });
});
