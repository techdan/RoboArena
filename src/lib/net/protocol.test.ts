/** Phase 8 protocol and setup schema validation. */

import { describe, expect, it } from "vitest";
import { clientMessageSchema } from "./protocol";
import { configForLength, roomConfigSchema } from "../setup/validate";

const create = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  requestId: "request-1",
  kind: "CreateRoom",
  name: "Ember Unit",
  color: "red",
  ...overrides,
});

describe("room protocol schemas", () => {
  it("rejects unknown protocol versions and extra fields", () => {
    expect(clientMessageSchema.safeParse(create({ version: 2 })).success).toBe(false);
    expect(clientMessageSchema.safeParse(create({ hiddenOrders: [] })).success).toBe(false);
  });

  it("rejects oversized names and invalid colors", () => {
    expect(clientMessageSchema.safeParse(create({ name: "x".repeat(25) })).success).toBe(false);
    expect(clientMessageSchema.safeParse(create({ color: "purple" })).success).toBe(false);
  });

  it("locks Melee and Battle to the verified arena defaults", () => {
    expect(configForLength("melee").arenaName).toBe("rubble-two");
    expect(configForLength("battle").arenaName).toBe("rubble-three");
    expect(
      roomConfigSchema.safeParse({ ...configForLength("melee"), arenaName: "rubble-three" })
        .success,
    ).toBe(false);
  });

  it("requires a participant token for canonical planner snapshots", () => {
    const valid = {
      version: 1,
      requestId: "match-1",
      kind: "GetMatchState",
      code: "ABC234",
      token: "x".repeat(43),
    };
    expect(clientMessageSchema.safeParse(valid).success).toBe(true);
    expect(clientMessageSchema.safeParse({ ...valid, token: undefined }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ ...valid, hiddenOrders: [] }).success).toBe(false);
  });

  it("accepts a corner selection and rejects out-of-range or non-integer slots", () => {
    const setHomeSlot = (homeSlot: unknown) => ({
      version: 1,
      requestId: "corner-1",
      kind: "SetHomeSlot",
      code: "ABC234",
      token: "x".repeat(43),
      homeSlot,
    });
    expect(clientMessageSchema.safeParse(setHomeSlot(0)).success).toBe(true);
    expect(clientMessageSchema.safeParse(setHomeSlot(3)).success).toBe(true);
    expect(clientMessageSchema.safeParse(setHomeSlot(4)).success).toBe(false);
    expect(clientMessageSchema.safeParse(setHomeSlot(-1)).success).toBe(false);
    expect(clientMessageSchema.safeParse(setHomeSlot(1.5)).success).toBe(false);
    expect(clientMessageSchema.safeParse(setHomeSlot(undefined)).success).toBe(false);
  });

  it("accepts a well-formed resignation and rejects a missing match id", () => {
    const resign = (overrides: Record<string, unknown> = {}) => ({
      version: 1,
      requestId: "resign-1",
      kind: "ResignMatch",
      code: "ABC234",
      token: "x".repeat(43),
      matchId: "match-1",
      ...overrides,
    });
    expect(clientMessageSchema.safeParse(resign()).success).toBe(true);
    expect(clientMessageSchema.safeParse(resign({ matchId: undefined })).success).toBe(false);
    expect(clientMessageSchema.safeParse(resign({ extra: true })).success).toBe(false);
  });

  it("strictly validates bounded private turn orders", () => {
    const valid = {
      version: 1,
      requestId: "lock-1",
      kind: "LockOrders",
      code: "ABC234",
      token: "x".repeat(43),
      matchId: "match-1",
      orders: {
        turnNumber: 1,
        timelines: [
          {
            robotId: "r1",
            segments: [{ kind: "deploy", to: { x: 1, y: 1 } }],
          },
        ],
      },
    };
    expect(clientMessageSchema.safeParse(valid).success).toBe(true);
    expect(
      clientMessageSchema.safeParse({
        ...valid,
        orders: { ...valid.orders, hiddenOpponentOrders: [] },
      }).success,
    ).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        ...valid,
        orders: {
          ...valid.orders,
          timelines: [
            {
              robotId: "r1",
              segments: [{ kind: "scan-and-fire", weapon: "rifle", maxDistance: 19, seconds: 1 }],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
