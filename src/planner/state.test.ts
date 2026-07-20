import { describe, expect, it } from "vitest";
import { makeRobot } from "../engine/__fixtures__/match";
import type { TurnOrders } from "../engine/types";
import { DEFAULT_HISTORY_LIMIT } from "./history";
import { projectRobotAtTick, timelineForRobot } from "./segments";
import { createPlannerState, plannerReducer } from "./state";

const orders = (turnNumber: number, robotId = "r1"): TurnOrders => ({
  turnNumber,
  timelines: [{ robotId, segments: [] }],
});

describe("planner draft state", () => {
  it("undoes/redoes byte-equivalent orders and clears redo on a new edit", () => {
    const initial = createPlannerState(orders(1), "rev-1");
    const editedOrders: TurnOrders = {
      turnNumber: 1,
      timelines: [{ robotId: "r1", segments: [{ kind: "deploy", to: { x: 1, y: 1 } }] }],
    };
    const edited = plannerReducer(initial, { type: "edit", orders: editedOrders });
    const undone = plannerReducer(edited, { type: "undo" });
    expect(JSON.stringify(undone.history.present)).toBe(JSON.stringify(initial.history.present));
    const redone = plannerReducer(undone, { type: "redo" });
    expect(JSON.stringify(redone.history.present)).toBe(JSON.stringify(editedOrders));
    const robot = makeRobot("r1", "t1", "rifle", "dock");
    expect(
      projectRobotAtTick(robot, timelineForRobot(undone.history.present, robot.id).segments)
        .position,
    ).toBe("dock");
    expect(
      projectRobotAtTick(robot, timelineForRobot(redone.history.present, robot.id).segments)
        .position,
    ).toEqual({ x: 1, y: 1 });
    expect(
      plannerReducer(undone, { type: "edit", orders: orders(1, "r2") }).history.future,
    ).toEqual([]);
  });

  it("retains the newest bounded undo states and drops the oldest first", () => {
    let state = createPlannerState(orders(1, "r0"), "rev-1");
    for (let index = 1; index <= DEFAULT_HISTORY_LIMIT + 1; index += 1)
      state = plannerReducer(state, { type: "edit", orders: orders(1, `r${index}`) });

    expect(state.history.past).toHaveLength(DEFAULT_HISTORY_LIMIT);
    for (let index = 0; index < DEFAULT_HISTORY_LIMIT; index += 1)
      state = plannerReducer(state, { type: "undo" });
    expect(state.history.present).toEqual(orders(1, "r1"));
    expect(plannerReducer(state, { type: "undo" })).toEqual(state);

    for (let index = 0; index < DEFAULT_HISTORY_LIMIT; index += 1)
      state = plannerReducer(state, { type: "redo" });
    expect(state.history.present).toEqual(orders(1, `r${DEFAULT_HISTORY_LIMIT + 1}`));
  });

  it("preserves a newer unsent draft when an authoritative snapshot changes", () => {
    const local = plannerReducer(createPlannerState(orders(1), "rev-1"), {
      type: "edit",
      orders: orders(1, "local"),
    });
    const refreshed = plannerReducer(local, {
      type: "authoritative-refresh",
      revision: "rev-2",
      orders: orders(1, "server"),
    });
    expect(refreshed.history.present).toEqual(orders(1, "local"));
    expect(refreshed.conflictRevision).toBe("rev-2");
    expect(refreshed.conflictOrders).toEqual(orders(1, "local"));
    expect(plannerReducer(refreshed, { type: "keep-local" }).history.present).toEqual(
      orders(1, "local"),
    );
  });

  it("moves a prior-turn draft into recoverable conflict state", () => {
    const local = plannerReducer(createPlannerState(orders(1), "rev-1"), {
      type: "edit",
      orders: orders(1, "local"),
    });
    const refreshed = plannerReducer(local, {
      type: "authoritative-refresh",
      revision: "rev-2",
      orders: orders(2, "server"),
    });
    expect(refreshed.history.present).toEqual(orders(2, "server"));
    expect(refreshed.conflictOrders).toEqual(orders(1, "local"));
    expect(plannerReducer(refreshed, { type: "keep-local" })).toBe(refreshed);
    const recovered = plannerReducer(refreshed, {
      type: "recover-conflict",
      revision: "rev-2",
      orders: orders(2, "recovered"),
    });
    expect(recovered.history.present).toEqual(orders(2, "recovered"));
    expect(recovered.conflictOrders).toBeNull();
    expect(recovered.dirty).toBe(true);
  });
});
