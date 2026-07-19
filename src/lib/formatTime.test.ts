import { describe, expect, it } from "vitest";
import { formatGameTime } from "./formatTime.js";

describe("formatGameTime", () => {
  it("presents engine ticks as seconds", () => {
    expect(formatGameTime(0)).toBe("0.00s");
    expect(formatGameTime(245)).toBe("4.08s");
    expect(formatGameTime(545)).toBe("9.08s");
  });
});
