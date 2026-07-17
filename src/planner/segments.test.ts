import { describe, expect, it } from "vitest";
import { makeOpenArena, makeRobot } from "../engine/__fixtures__/match";
import type { Arena, TurnOrders } from "../engine/types";
import {
  appendSegment,
  deleteSegment,
  planMovement,
  projectRobotAtTick,
  timelineForRobot,
  timelineTiming,
} from "./segments";

describe("planner segments", () => {
  it("compresses straight and diagonal open routes into exact double selectors", () => {
    const arena = makeOpenArena(6, 6);
    const straight = planMovement(arena, { x: 0, y: 0 }, { x: 4, y: 0 }, "upright");
    const diagonal = planMovement(arena, { x: 0, y: 0 }, { x: 4, y: 4 }, "upright");
    expect(straight.kind).toBe("move");
    expect(diagonal.kind).toBe("move");
    if (straight.kind === "move")
      expect(straight.segment.path).toEqual([
        { via: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
        { via: { x: 3, y: 0 }, to: { x: 4, y: 0 } },
      ]);
    if (diagonal.kind === "move") expect(diagonal.segment.path).toHaveLength(2);
  });

  it("retains slow entered tiles as 30-tick singles", () => {
    const open = makeOpenArena(5, 1);
    const arena: Arena = {
      ...open,
      tiles: [
        [
          { terrain: "open" },
          { terrain: "open" },
          { terrain: "rough" },
          { terrain: "open" },
          { terrain: "open" },
        ],
      ],
    };
    const plan = planMovement(arena, { x: 0, y: 0 }, { x: 4, y: 0 }, "upright");
    expect(plan.kind).toBe("move");
    if (plan.kind !== "move") return;
    const robot = makeRobot("r1", "t1", "rifle", { x: 0, y: 0 });
    expect(timelineTiming(robot, [plan.segment], 900)[0]).toMatchObject({
      startTick: 0,
      endTick: 100,
      durationTicks: 100,
    });
  });

  it("projects deploy/posture/scan only at completion boundaries and supports deletion", () => {
    const robot = makeRobot("r1", "t1", "rifle", "dock");
    let orders: TurnOrders = { turnNumber: 1, timelines: [] };
    orders = appendSegment(orders, robot.id, { kind: "deploy", to: { x: 1, y: 1 } });
    orders = appendSegment(orders, robot.id, { kind: "set-posture", posture: "ducking" });
    orders = appendSegment(orders, robot.id, { kind: "set-scan-direction", heading: "S" });
    const segments = timelineForRobot(orders, robot.id).segments;
    expect(projectRobotAtTick(robot, segments, 119).position).toBe("dock");
    expect(projectRobotAtTick(robot, segments, 120).position).toEqual({ x: 1, y: 1 });
    expect(projectRobotAtTick(robot, segments, 130).posture).toBe("ducking");
    expect(projectRobotAtTick(robot, segments, 135).scanHeading).toBe("S");
    expect(
      timelineTiming(robot, segments, 130).map((entry) => [
        entry.startTick,
        entry.endTick,
        entry.overBudget,
      ]),
    ).toEqual([
      [0, 120, false],
      [120, 130, false],
      [130, 135, true],
    ]);
    expect(
      timelineForRobot(deleteSegment(orders, robot.id, 1), robot.id).segments.map(
        (segment) => segment.kind,
      ),
    ).toEqual(["deploy", "set-scan-direction"]);
  });
});
