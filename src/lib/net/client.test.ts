import { describe, expect, it } from "vitest";
import { roomServerUrl } from "./client";

describe("room server URL", () => {
  it("puts each room on its own path, and new rooms under their request id", () => {
    expect(roomServerUrl({ code: "ABC234" })).toBe("ws://localhost:3001/rooms/ABC234");
    expect(roomServerUrl({ createRequestId: "a b" })).toBe("ws://localhost:3001/rooms/new/a%20b");
  });
});
