import { describe, expect, it } from "vitest";
import { makeOpenArena, makeRobot } from "../engine/__fixtures__/match";
import type { Arena, TurnOrders } from "../engine/types";
import {
  appendSegment,
  deleteSegment,
  planMovement,
  projectRobotAtTick,
  rebaseTurnOrders,
  replaceSegmentAt,
  timelineForRobot,
  timelineTiming,
  validatedTimelinePrefix,
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

  it("projects each movement selector at its own completion boundary", () => {
    const robot = makeRobot("r1", "t1", "rifle", { x: 0, y: 0 });
    const segment = {
      kind: "move",
      posture: "upright",
      path: [
        { via: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
        { via: { x: 3, y: 0 }, to: { x: 4, y: 0 } },
      ],
    } as const;
    expect(projectRobotAtTick(robot, [segment], 39).position).toEqual({ x: 0, y: 0 });
    expect(projectRobotAtTick(robot, [segment], 40).position).toEqual({ x: 2, y: 0 });
    expect(projectRobotAtTick(robot, [segment], 79).position).toEqual({ x: 2, y: 0 });
    expect(projectRobotAtTick(robot, [segment], 80).position).toEqual({ x: 4, y: 0 });
  });

  it("truncates commands made illegal by direct replacement or deletion", () => {
    const arena = makeOpenArena(6, 6);
    const robot = makeRobot("r1", "t1", "rifle", "dock");
    const segments = [
      { kind: "deploy", to: { x: 0, y: 0 } },
      {
        kind: "move",
        posture: "upright",
        path: [{ via: { x: 1, y: 0 }, to: { x: 2, y: 0 } }],
      },
      { kind: "set-scan-direction", heading: "S" },
    ] as const;
    expect(validatedTimelinePrefix(arena, robot, 0, segments).droppedCount).toBe(0);
    expect(validatedTimelinePrefix(arena, robot, 0, segments.slice(1))).toEqual({
      segments: [],
      droppedCount: 2,
    });

    const orders: TurnOrders = { turnNumber: 1, timelines: [{ robotId: robot.id, segments }] };
    const replaced = replaceSegmentAt(orders, robot.id, 1, {
      kind: "set-posture",
      posture: "ducking",
    });
    expect(timelineForRobot(replaced, robot.id).segments[1]?.kind).toBe("set-posture");
    expect(rebaseTurnOrders(arena, [robot], 0, orders, 2).turnNumber).toBe(2);
  });
});
