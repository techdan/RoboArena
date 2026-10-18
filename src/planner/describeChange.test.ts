import { describe, expect, it } from "vitest";
import type { RobotCommandSegment, TurnOrders } from "../engine/types";
import { describeOrdersChange, describeSegment } from "./describeChange";

const orders = (timelines: Record<string, readonly RobotCommandSegment[]>): TurnOrders => ({
  turnNumber: 1,
  timelines: Object.entries(timelines).map(([robotId, segments]) => ({ robotId, segments })),
});
const names = new Map([
  ["r1", "Rifle"],
  ["r2", "Burst"],
]);
const deploy: RobotCommandSegment = { kind: "deploy", to: { x: 1, y: 2 } };
const move: RobotCommandSegment = {
  kind: "move",
  posture: "upright",
  path: [{ to: { x: 2, y: 2 } }, { to: { x: 4, y: 7 } }],
};
const aim: RobotCommandSegment = {
  kind: "aim-and-fire",
  target: { x: 9, y: 3 },
  weapon: "rifle",
  repeat: false,
};

describe("describeSegment", () => {
  it("names each order the way the command bar does", () => {
    expect(describeSegment(deploy)).toBe("deploy at 1,2");
    expect(describeSegment(move)).toBe("move to 4,7");
    expect(describeSegment({ kind: "set-posture", posture: "ducking" })).toBe("duck");
    expect(describeSegment({ kind: "set-scan-direction", heading: "NE" })).toBe("face NE");
    expect(describeSegment(aim)).toBe("aim at 9,3");
    expect(describeSegment({ kind: "self-destruct" })).toBe("self destruct");
  });
});

describe("describeOrdersChange", () => {
  it("names the order that was added, with the robot", () => {
    expect(
      describeOrdersChange(orders({ r2: [deploy] }), orders({ r2: [deploy, move] }), names),
    ).toBe("Burst: move to 4,7");
  });

  it("counts several identical orders added at once", () => {
    expect(
      describeOrdersChange(
        orders({ r1: [deploy] }),
        orders({ r1: [deploy, aim, aim, aim] }),
        names,
      ),
    ).toBe("Rifle: aim at 9,3 ×3");
  });

  it("describes removals and a cleared plan", () => {
    expect(
      describeOrdersChange(orders({ r1: [deploy, move, aim] }), orders({ r1: [deploy] }), names),
    ).toBe("Rifle: remove 2 actions");
    expect(describeOrdersChange(orders({ r1: [deploy, move] }), orders({ r1: [] }), names)).toBe(
      "Rifle: clear plan",
    );
  });

  it("reports a replaced tail as a change and identical drafts as nothing", () => {
    expect(
      describeOrdersChange(orders({ r1: [deploy, move] }), orders({ r1: [deploy, aim] }), names),
    ).toBe("Rifle: change orders");
    expect(
      describeOrdersChange(orders({ r1: [deploy] }), orders({ r1: [deploy] }), names),
    ).toBeNull();
  });

  it("finds the robot that changed when another robot is unchanged", () => {
    expect(
      describeOrdersChange(
        orders({ r1: [deploy], r2: [] }),
        orders({ r1: [deploy], r2: [deploy] }),
        names,
      ),
    ).toBe("Burst: deploy at 1,2");
  });
});
