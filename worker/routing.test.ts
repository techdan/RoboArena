import { describe, expect, it } from "vitest";
import { parseRoomRoute, roomCodeForRequest } from "./routing";

describe("room Worker routing", () => {
  it("routes existing room codes and new-room request ids", () => {
    expect(parseRoomRoute("/rooms/ABC234")).toEqual({ kind: "room", code: "ABC234" });
    expect(parseRoomRoute("/rooms/new/req%201")).toEqual({ kind: "new", requestId: "req 1" });
    expect(parseRoomRoute("/rooms/abc234")).toBeUndefined();
    expect(parseRoomRoute("/rooms/ABC23O")).toBeUndefined();
    expect(parseRoomRoute(`/rooms/new/${"x".repeat(65)}`)).toBeUndefined();
    expect(parseRoomRoute("/")).toBeUndefined();
  });

  it("derives a stable valid room code from a CreateRoom request id", async () => {
    const code = await roomCodeForRequest("create-1");
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(await roomCodeForRequest("create-1")).toBe(code);
    expect(await roomCodeForRequest("create-2")).not.toBe(code);
  });
});
