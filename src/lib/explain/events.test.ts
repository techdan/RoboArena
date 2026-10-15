import { describe, expect, it } from "vitest";
import { explainEvent } from "./events.js";

describe("authorized event explanations", () => {
  it("explains a scored hit-roll miss without inventing hidden data", () => {
    const result = explainEvent({
      tick: 30,
      seq: 4,
      kind: "shot-missed",
      shooterId: "r1",
      shotIndex: 0,
      target: { x: 4, y: 5 },
      reason: "hit-roll",
      score: 12,
    });
    expect(result?.detail).toContain("Computed score: 12");
  });

  it("labels redacted damage as coming from an unseen source", () => {
    const result = explainEvent({
      tick: 40,
      seq: 2,
      kind: "damaged",
      damageKind: "direct",
      targetId: "mine",
      damage: 9,
    });
    expect(result?.detail).toContain("unseen source");
    expect(result?.detail).not.toContain("undefined");
  });

  it("describes Zap damage and Time Bomb events", () => {
    expect(
      explainEvent({
        tick: 60,
        seq: 1,
        kind: "damaged",
        damageKind: "zap",
        sourceId: "r1",
        targetId: "e1",
        damage: 75,
      })?.detail,
    ).toBe("e1: r1 zapped it for 75 damage.");
    expect(
      explainEvent({ tick: 60, seq: 0, kind: "zapped", shooterId: "r1", at: { x: 2, y: 3 } })
        ?.title,
    ).toBe("Zap");
    expect(
      explainEvent({
        tick: 120,
        seq: 2,
        kind: "bomb-placed",
        robotId: "r1",
        bombId: "b1",
        at: { x: 2, y: 3 },
        detonatesAt: 480,
      })?.detail,
    ).toBe("r1 armed a Time Bomb at 2,3.");
    expect(
      explainEvent({
        tick: 480,
        seq: 3,
        kind: "bomb-exploded",
        bombId: "b1",
        ownerId: "r1",
        at: { x: 2, y: 3 },
      })?.title,
    ).toBe("Time Bomb exploded");
  });
});
