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
});
