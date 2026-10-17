import { describe, expect, it } from "vitest";
import { normalizeRoomCode } from "./CodeInput";

describe("normalizeRoomCode", () => {
  it("uppercases and strips separators from typed or pasted codes", () => {
    expect(normalizeRoomCode("abc-234")).toBe("ABC234");
    expect(normalizeRoomCode(" 9mc 7qy ")).toBe("9MC7QY");
  });

  it("keeps at most six characters", () => {
    expect(normalizeRoomCode("ABCDEFGH")).toBe("ABCDEF");
  });
});
