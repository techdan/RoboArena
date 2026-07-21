import { describe, expect, it } from "vitest";
import type { PlannerDraftStorage } from "./draft";
import {
  clearPlannerDraft,
  legacyPlannerDraftKey,
  loadPlannerDraft,
  plannerDraftKey,
  savePlannerDraft,
} from "./draft";

const orders = (turnNumber: number) => ({
  turnNumber,
  timelines: [{ robotId: "r1", segments: [{ kind: "deploy" as const, to: { x: 1, y: 1 } }] }],
});

class MemoryStorage implements PlannerDraftStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("planner draft persistence", () => {
  it("stores a versioned envelope including a preserved conflict", () => {
    const storage = new MemoryStorage();
    expect(
      savePlannerDraft(storage, "match", "team", {
        authoritativeRevision: "rev-2",
        orders: orders(2),
        conflictOrders: orders(1),
      }),
    ).toBe(true);
    expect(loadPlannerDraft(storage, "match", "team", "fallback")).toMatchObject({
      kind: "restored",
      envelope: { authoritativeRevision: "rev-2", orders: orders(2), conflictOrders: orders(1) },
    });
    expect(storage.values.has(plannerDraftKey("match", "team"))).toBe(true);
  });

  it("migrates a valid legacy draft without rejecting its prior turn", () => {
    const storage = new MemoryStorage();
    storage.values.set(legacyPlannerDraftKey("match", "team"), JSON.stringify(orders(1)));
    expect(loadPlannerDraft(storage, "match", "team", "rev-2")).toMatchObject({
      kind: "restored",
      envelope: { authoritativeRevision: "rev-2", orders: orders(1) },
    });
  });

  it("distinguishes malformed data from unavailable storage and contains write failures", () => {
    const corrupt = new MemoryStorage();
    corrupt.values.set(plannerDraftKey("match", "team"), "not json");
    expect(loadPlannerDraft(corrupt, "match", "team", "rev")).toEqual({ kind: "corrupt" });
    const unavailable: PlannerDraftStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadPlannerDraft(unavailable, "match", "team", "rev")).toEqual({ kind: "unavailable" });
    expect(
      savePlannerDraft(unavailable, "match", "team", {
        authoritativeRevision: "rev",
        orders: orders(1),
      }),
    ).toBe(false);
    expect(() => clearPlannerDraft(unavailable, "match", "team")).not.toThrow();
  });

  it("clears both the current and legacy keys so a locked turn leaves no stale draft", () => {
    const storage = new MemoryStorage();
    storage.values.set(plannerDraftKey("match", "team"), JSON.stringify(orders(1)));
    storage.values.set(legacyPlannerDraftKey("match", "team"), JSON.stringify(orders(1)));
    clearPlannerDraft(storage, "match", "team");
    expect(loadPlannerDraft(storage, "match", "team", "rev")).toEqual({ kind: "none" });
  });
});
