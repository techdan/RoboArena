import { describe, expect, it } from "vitest";
import { blastDamagePresentation, fireActionCount } from "./combatPresentation";

describe("planner combat presentation", () => {
  it("counts a Burst action as one hit roll", () => {
    expect(fireActionCount("burst-gun", 4)).toEqual({
      primary: "4 bursts",
      projectiles: null,
    });
    expect(fireActionCount("rifle", 1)).toEqual({
      primary: "1 shot",
      projectiles: null,
    });
    expect(fireActionCount("missile-launcher", 2)).toEqual({
      primary: "2 missiles",
      projectiles: null,
    });
  });

  it("derives explosive damage bands from the selected weapon catalog", () => {
    expect(blastDamagePresentation("missile-launcher")).toEqual({
      radius: 2,
      bands: "impact 60–91 · radius 1: 40–55 · radius 2: 10–17",
    });
    expect(blastDamagePresentation("grenade-launcher")).toEqual({
      radius: 2,
      bands: "impact 45–76 · radius 1: 25–40 · radius 2: 5–12",
    });
    expect(blastDamagePresentation("rifle")).toBeNull();
  });
});
