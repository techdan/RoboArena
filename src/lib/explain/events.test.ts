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
});
