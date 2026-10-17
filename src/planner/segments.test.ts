import { describe, expect, it } from "vitest";
import { makeOpenArena, makeRobot } from "../engine/__fixtures__/match";
import type { Arena, TurnOrders } from "../engine/types";
import {
  appendSegment,
  canProgramPlaceBomb,
  canProgramSelfDestruct,
  canProgramZap,
  deleteSegment,
  planMovement,
  projectRobotAtTick,
  rebaseTurnOrders,
  replaceSegmentAt,
  timelineForRobot,
  timelineTiming,
  previewParkingTick,
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
    // Deploy lands the robot as it starts; the next command still waits 120 ticks.
    expect(projectRobotAtTick(robot, segments, 0).position).toEqual({ x: 1, y: 1 });
    expect(projectRobotAtTick(robot, segments, 119).position).toEqual({ x: 1, y: 1 });
    expect(projectRobotAtTick(robot, segments, 119).tick).toBe(0);
    expect(projectRobotAtTick(robot, segments, 120).position).toEqual({ x: 1, y: 1 });
    expect(projectRobotAtTick(robot, segments, 130).posture).toBe("ducking");
    expect(projectRobotAtTick(robot, segments, 135).scanHeading).not.toBe("S");
    // E→S is two octants, so 10 ticks (seg80:0x0422).
    expect(projectRobotAtTick(robot, segments, 140).scanHeading).toBe("S");
    expect(
      timelineTiming(robot, segments, 130).map((entry) => [
        entry.startTick,
        entry.endTick,
        entry.overBudget,
      ]),
    ).toEqual([
      [0, 120, false],
      [120, 130, false],
      [130, 140, true],
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

  it("shows firing durations and treats repeat fire as terminal through the horizon", () => {
    const arena = makeOpenArena();
    const robot = makeRobot("r1", "t1", "rifle", { x: 1, y: 1 });
    const aim = {
      kind: "aim-and-fire",
      target: { x: 3, y: 1 },
      weapon: "rifle",
      repeat: false,
    } as const;
    const scan = { kind: "scan-and-fire", weapon: "rifle", maxDistance: 18, seconds: 3 } as const;
    expect(timelineTiming(robot, [aim, scan], 900).map((entry) => entry.durationTicks)).toEqual([
      30, 180,
    ]);
    const repeat = { ...aim, repeat: true } as const;
    expect(timelineTiming(robot, [repeat], 900)[0]).toMatchObject({
      startTick: 0,
      endTick: 900,
      durationTicks: 900,
    });
    expect(
      validatedTimelinePrefix(arena, robot, 0, [
        repeat,
        { kind: "set-posture", posture: "ducking" },
      ]),
    ).toEqual({ segments: [repeat], droppedCount: 1 });
  });

  it("parks planner previews at the plan end or the edited command boundary", () => {
    const robot = makeRobot("r1", "t1", "rifle", { x: 1, y: 1 });
    const segments = [
      { kind: "set-posture", posture: "ducking" },
      { kind: "set-scan-direction", heading: "S" },
      { kind: "scan-and-fire", weapon: "rifle", maxDistance: 12, seconds: 2 },
    ] as const;
    expect(previewParkingTick(robot, [], 900)).toBe(0);
    expect(previewParkingTick(robot, segments, 900)).toBe(140);
    expect(previewParkingTick(robot, segments, 900, 1)).toBe(20);
    expect(
      previewParkingTick(
        robot,
        [
          {
            kind: "aim-and-fire",
            target: { x: 2, y: 1 },
            weapon: "rifle",
            repeat: true,
          },
        ],
        900,
      ),
    ).toBe(900);
  });

  it("rejects deterministic finite-ammo overcommit and reserves finite scan ammo", () => {
    const arena = makeOpenArena();
    const robot = makeRobot("r1", "t1", "missile", { x: 1, y: 1 });
    const missile = {
      kind: "aim-and-fire",
      target: { x: 3, y: 1 },
      weapon: "missile-launcher",
      repeat: false,
    } as const;
    expect(validatedTimelinePrefix(arena, robot, 0, [missile, missile, missile, missile])).toEqual({
      segments: [missile, missile, missile],
      droppedCount: 1,
    });

    const scan = {
      kind: "scan-and-fire",
      weapon: "missile-launcher",
      maxDistance: 18,
      seconds: 1,
    } as const;
    expect(validatedTimelinePrefix(arena, robot, 0, [scan, missile])).toEqual({
      segments: [scan],
      droppedCount: 1,
    });
  });

  it("times Zap by its seconds and Place Bomb at 60 ticks", () => {
    const robot = { ...makeRobot("r1", "t1", "rifle", { x: 1, y: 1 }), timeBombs: 1 };
    expect(
      timelineTiming(
        robot,
        [
          { kind: "zap", seconds: 5 },
          { kind: "place-bomb", fuseSeconds: 3 },
        ],
        900,
      ).map((entry) => [entry.startTick, entry.endTick, entry.createsScanOpportunity]),
    ).toEqual([
      [0, 300, false],
      [300, 360, false],
    ]);
  });

  it("spends carried Time Bombs in the projection", () => {
    const robot = { ...makeRobot("r1", "t1", "rifle", { x: 1, y: 1 }), timeBombs: 1 };
    const bomb = { kind: "place-bomb" as const, fuseSeconds: 5 };
    expect(projectRobotAtTick(robot, []).timeBombs).toBe(1);
    expect(projectRobotAtTick(robot, [bomb], 59).timeBombs).toBe(1);
    expect(projectRobotAtTick(robot, [bomb], 60).timeBombs).toBe(0);
    expect(canProgramPlaceBomb(projectRobotAtTick(robot, []))).toBe(true);
    expect(canProgramPlaceBomb(projectRobotAtTick(robot, [bomb]))).toBe(false);
    expect(projectRobotAtTick(makeRobot("r2", "t1", "rifle", { x: 1, y: 1 }), []).timeBombs).toBe(
      0,
    );
    const docked = { ...makeRobot("r3", "t1", "rifle", "dock"), timeBombs: 1 };
    expect(canProgramPlaceBomb(projectRobotAtTick(docked, []))).toBe(false);
    expect(canProgramZap({ zapArmed: true }, projectRobotAtTick(docked, []))).toBe(false);
    expect(canProgramZap({ zapArmed: true }, projectRobotAtTick(robot, []))).toBe(true);
    expect(canProgramZap({}, projectRobotAtTick(robot, []))).toBe(false);
  });

  it("keeps Zap only when armed and drops a second bomb placement", () => {
    const arena = makeOpenArena(6, 6);
    const robot = { ...makeRobot("r1", "t1", "rifle", { x: 1, y: 1 }), timeBombs: 1 };
    const zap = { kind: "zap" as const, seconds: 4 };
    const bomb = { kind: "place-bomb" as const, fuseSeconds: 2 };
    expect(validatedTimelinePrefix(arena, robot, 0, [zap, bomb], { zapArmed: true })).toEqual({
      segments: [zap, bomb],
      droppedCount: 0,
    });
    expect(validatedTimelinePrefix(arena, robot, 0, [zap, bomb])).toEqual({
      segments: [],
      droppedCount: 2,
    });
    expect(validatedTimelinePrefix(arena, robot, 0, [bomb, bomb, zap], { zapArmed: true })).toEqual(
      { segments: [bomb], droppedCount: 2 },
    );
    expect(
      validatedTimelinePrefix(arena, robot, 0, [{ kind: "zap", seconds: 41 }], { zapArmed: true }),
    ).toEqual({ segments: [], droppedCount: 1 });
  });

  it("offers Self Destruct only to a Team's last live deployed robot under rules revision 3", () => {
    const robot = makeRobot("r1", "t1", "rifle", { x: 1, y: 1 });
    const docked = makeRobot("r2", "t1", "rifle", "dock");
    const lastStanding = { rulesRevision: 3, liveTeamRobots: 1 } as const;
    expect(canProgramSelfDestruct(lastStanding, projectRobotAtTick(robot, []))).toBe(true);
    expect(canProgramSelfDestruct(lastStanding, projectRobotAtTick(docked, []))).toBe(false);
    expect(
      canProgramSelfDestruct(
        { rulesRevision: 3, liveTeamRobots: 2 },
        projectRobotAtTick(robot, []),
      ),
    ).toBe(false);
    expect(
      canProgramSelfDestruct(
        { rulesRevision: 2, liveTeamRobots: 1 },
        projectRobotAtTick(robot, []),
      ),
    ).toBe(false);
    expect(canProgramSelfDestruct({ liveTeamRobots: 1 }, projectRobotAtTick(robot, []))).toBe(
      false,
    );
    expect(canProgramSelfDestruct(undefined, projectRobotAtTick(robot, []))).toBe(false);
  });

  it("times Self Destruct at 20 ticks and keeps it only while allowed", () => {
    const arena = makeOpenArena(6, 6);
    const robot = makeRobot("r1", "t1", "rifle", { x: 1, y: 1 });
    const selfDestruct = { kind: "self-destruct" as const };
    const face = { kind: "set-scan-direction" as const, heading: "E" as const };
    const lastStanding = { rulesRevision: 3, liveTeamRobots: 1 } as const;
    expect(timelineTiming(robot, [selfDestruct], 900)[0]).toMatchObject({
      startTick: 0,
      endTick: 20,
      durationTicks: 20,
    });
    expect(validatedTimelinePrefix(arena, robot, 0, [face, selfDestruct], lastStanding)).toEqual({
      segments: [face, selfDestruct],
      droppedCount: 0,
    });
    // A robot that survives its own blast keeps its later orders, as in the original.
    expect(validatedTimelinePrefix(arena, robot, 0, [selfDestruct, face], lastStanding)).toEqual({
      segments: [selfDestruct, face],
      droppedCount: 0,
    });
    // A teammate still alive, the earlier rules, or no rules drop it.
    expect(
      validatedTimelinePrefix(arena, robot, 0, [face, selfDestruct], {
        rulesRevision: 3,
        liveTeamRobots: 2,
      }),
    ).toEqual({ segments: [face], droppedCount: 1 });
    expect(validatedTimelinePrefix(arena, robot, 0, [selfDestruct], { liveTeamRobots: 1 })).toEqual(
      { segments: [], droppedCount: 1 },
    );
    expect(validatedTimelinePrefix(arena, robot, 0, [selfDestruct])).toEqual({
      segments: [],
      droppedCount: 1,
    });
    const docked = makeRobot("r2", "t1", "rifle", "dock");
    expect(validatedTimelinePrefix(arena, docked, 0, [selfDestruct], lastStanding)).toEqual({
      segments: [],
      droppedCount: 1,
    });
  });
});
