import { describe, expect, it } from "vitest";
import { bootCampHref, safeReturnPath } from "./bootCampStorage.js";

describe("Boot Camp return paths", () => {
  it("keeps same-origin paths", () => {
    expect(safeReturnPath("/room/ABC234")).toBe("/room/ABC234");
    expect(safeReturnPath("/")).toBe("/");
  });

  it("rejects external, protocol-relative, and self-referencing targets", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/boot-camp",
      "/room/\nX",
      undefined,
      ["/room/A"],
    ]) {
      expect(safeReturnPath(value)).toBe("/");
    }
  });

  it("builds the boot camp link with an encoded return path", () => {
    expect(bootCampHref()).toBe("/boot-camp");
    expect(bootCampHref("/room/ABC234")).toBe("/boot-camp?next=%2Froom%2FABC234");
    expect(bootCampHref("//evil")).toBe("/boot-camp");
  });
});
