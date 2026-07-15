import { describe, expect, it } from "vitest";
import { ARENA_DIMENSIONS } from "./constants.js";
import { DEFAULT_ROSTER_BY_LENGTH, ROBOT_DEFINITIONS, WEAPONS } from "./catalog.js";

describe("robot catalog", () => {
  it("matches the binary accuracy tiers", () => {
    expect(
      Object.fromEntries(Object.entries(ROBOT_DEFINITIONS).map(([k, v]) => [k, v.accuracy])),
    ).toEqual({
      rifle: 2,
      burst: 1,
      auto: 0,
      missile: 1,
      stealth: 1,
    });
  });

  it("matches the binary armor table", () => {
    expect(
      Object.fromEntries(Object.entries(ROBOT_DEFINITIONS).map(([k, v]) => [k, v.armor])),
    ).toEqual({
      rifle: 140,
      burst: 120,
      auto: 100,
      missile: 100,
      stealth: 120,
    });
  });

  it("gives Missile robots their rifle secondary", () => {
    expect(ROBOT_DEFINITIONS.missile.secondaryWeapons).toContain("rifle");
  });

  it("keeps the beginner battle roster", () => {
    expect(DEFAULT_ROSTER_BY_LENGTH.battle).toEqual([
      "rifle",
      "rifle",
      "burst",
      "burst",
      "auto",
      "missile",
    ]);
  });
});

describe("weapon catalog", () => {
  it("uses the three exact direct-fire roll families", () => {
    expect(WEAPONS.rifle.damageRoll).toEqual({ base: 10, mask: 7 });
    expect(WEAPONS["auto-rifle"].damageRoll).toEqual({ base: 8, mask: 15 });
    expect(WEAPONS["burst-gun"].damageRoll).toEqual({ base: 6, mask: 15 });
  });

  it("uses exact missile base/mask rows", () => {
    expect(WEAPONS["missile-launcher"].blast?.damageAtRadius).toEqual([
      { base: 60, mask: 31 },
      { base: 40, mask: 15 },
      { base: 10, mask: 7 },
    ]);
  });

  it("uses exact grenade base/mask rows", () => {
    expect(WEAPONS["grenade-launcher"].blast?.damageAtRadius).toEqual([
      { base: 45, mask: 31 },
      { base: 25, mask: 15 },
      { base: 5, mask: 7 },
    ]);
  });

  it("uses a uniform max range of 18", () => {
    for (const weapon of Object.values(WEAPONS)) expect(weapon.maxRange).toBe(18);
  });

  it("keeps burst at three bullets per click", () => {
    expect(WEAPONS["burst-gun"].bulletsPerClick).toBe(3);
  });

  it("uses fixed, integer fire costs", () => {
    for (const weapon of Object.values(WEAPONS)) {
      expect(Number.isInteger(weapon.firingIntervalTicks)).toBe(true);
      expect(weapon.firingIntervalTicks).toBeGreaterThan(0);
    }
  });

  it("limits missile ammunition", () => {
    expect(WEAPONS["missile-launcher"].startingAmmo).toBe(3);
  });

  it("corrects Rubble Two to 24x24", () => {
    expect(ARENA_DIMENSIONS.melee).toEqual({ width: 24, height: 24 });
  });
});
