import { describe, expect, it } from "vitest";
import type { RobotCommandSegment } from "../engine/types";
import {
  COACH_STEPS,
  coachFinished,
  currentCoachStep,
  rememberCoach,
  type CoachFacts,
  type CoachStepId,
} from "./firstTurnCoach";

const deploy: RobotCommandSegment = { kind: "deploy", to: { x: 2, y: 2 } };
const move: RobotCommandSegment = { kind: "move", path: [], posture: "upright" };
const aim: RobotCommandSegment = {
  kind: "aim-and-fire",
  target: { x: 6, y: 6 },
  weapon: "rifle",
  repeat: false,
};

const facts = (overrides: Partial<CoachFacts> = {}): CoachFacts => ({
  timelines: [[], []],
  ordersOpened: false,
  rehearsed: false,
  skipped: new Set<CoachStepId>(),
  ...overrides,
});

describe("first-turn coach", () => {
  it("walks deploy, move, orders, aim, squad, rehearse and lock in order", () => {
    expect(COACH_STEPS.map((step) => step.id)).toEqual([
      "deploy",
      "move",
      "orders",
      "aim",
      "squad",
      "rehearse",
      "lock",
    ]);
    expect(currentCoachStep(facts()).id).toBe("deploy");
    expect(currentCoachStep(facts({ timelines: [[deploy], []] })).id).toBe("move");
    expect(currentCoachStep(facts({ timelines: [[deploy, move], []] })).id).toBe("orders");
    expect(
      currentCoachStep(facts({ timelines: [[deploy, move], []], ordersOpened: true })).id,
    ).toBe("aim");
    expect(
      currentCoachStep(facts({ timelines: [[deploy, move, aim], []], ordersOpened: true })).id,
    ).toBe("squad");
    expect(
      currentCoachStep(facts({ timelines: [[deploy, move, aim], [deploy]], ordersOpened: true }))
        .id,
    ).toBe("rehearse");
    expect(
      currentCoachStep(
        facts({ timelines: [[deploy, move, aim], [deploy]], ordersOpened: true, rehearsed: true }),
      ).id,
    ).toBe("lock");
  });

  it("goes back to an earlier step when undo removes the order it was waiting for", () => {
    const ahead = facts({ timelines: [[deploy, move], []], ordersOpened: true, rehearsed: true });
    expect(currentCoachStep(ahead).id).toBe("aim");
    expect(currentCoachStep({ ...ahead, timelines: [[deploy], []] }).id).toBe("move");
  });

  it("lets the player skip steps they cannot do yet, but only those", () => {
    const stuck = facts({ timelines: [[deploy, move], []], ordersOpened: true });
    expect(currentCoachStep({ ...stuck, skipped: new Set(["aim"]) }).id).toBe("squad");
    expect(COACH_STEPS.filter((step) => step.skippable).map((step) => step.id)).toEqual([
      "aim",
      "squad",
    ]);
  });

  it("remembers that the guide is finished and tolerates blocked storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    expect(coachFinished(storage)).toBe(false);
    rememberCoach(storage, true);
    expect(coachFinished(storage)).toBe(true);
    rememberCoach(storage, false);
    expect(coachFinished(storage)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(coachFinished(blocked)).toBe(false);
    expect(() => rememberCoach(blocked, true)).not.toThrow();
  });
});
