import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROSTER_BY_LENGTH,
  ROBOT_DEFINITIONS,
  WEAPONS,
} from "./catalog.js";
import { ROBOTS_PER_TEAM_BY_LENGTH } from "./constants.js";

describe("ROBOT_DEFINITIONS — point-buy table from B&W Mac Custom Game", () => {
  it("all 5 v1 classes present", () => {
    expect(Object.keys(ROBOT_DEFINITIONS).sort()).toEqual([
      "auto",
      "burst",
      "missile",
      "rifle",
      "stealth",
    ]);
  });

  it("Rifle: 140 armor / 40 rating / High accuracy", () => {
    const r = ROBOT_DEFINITIONS.rifle;
    expect(r.armor).toBe(140);
    expect(r.rating).toBe(40);
    expect(r.accuracy).toBe("high");
  });

  it("Stealth: 120 armor / 100 rating / Burst Gun + stealth visibility", () => {
    const s = ROBOT_DEFINITIONS.stealth;
    expect(s.armor).toBe(120);
    expect(s.rating).toBe(100);
    expect(s.primaryWeapon).toBe("burst-gun");
    expect(s.stealthVisibility).toBe("stealth");
  });

  it("Missile carries Rifle as secondary (per manual)", () => {
    expect(ROBOT_DEFINITIONS.missile.secondaryWeapons).toContain("rifle");
  });

  it("Default Melee roster sums to a Team Rating of 230 (40+50+60+80)", () => {
    const roster = DEFAULT_ROSTER_BY_LENGTH.melee;
    const sum = roster.reduce((acc, c) => acc + ROBOT_DEFINITIONS[c].rating, 0);
    expect(sum).toBe(230);
  });

  it("Default rosters match robots-per-team count for each game length", () => {
    expect(DEFAULT_ROSTER_BY_LENGTH.skirmish).toHaveLength(
      ROBOTS_PER_TEAM_BY_LENGTH.skirmish,
    );
    expect(DEFAULT_ROSTER_BY_LENGTH.melee).toHaveLength(
      ROBOTS_PER_TEAM_BY_LENGTH.melee,
    );
    expect(DEFAULT_ROSTER_BY_LENGTH.battle).toHaveLength(
      ROBOTS_PER_TEAM_BY_LENGTH.battle,
    );
    expect(DEFAULT_ROSTER_BY_LENGTH.campaign).toHaveLength(
      ROBOTS_PER_TEAM_BY_LENGTH.campaign,
    );
  });

  it("Battle default roster: 2 Rifle, 2 Burst, 1 Auto, 1 Missile (DOS-confirmed)", () => {
    const roster = DEFAULT_ROSTER_BY_LENGTH.battle;
    const counts = roster.reduce<Record<string, number>>((acc, c) => {
      acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ rifle: 2, burst: 2, auto: 1, missile: 1 });
  });
});

describe("WEAPONS catalog", () => {
  it("all 5 weapon ids present", () => {
    expect(Object.keys(WEAPONS).sort()).toEqual([
      "auto-rifle",
      "burst-gun",
      "grenade-launcher",
      "missile-launcher",
      "rifle",
    ]);
  });

  it("all weapons have max range 18 (DOS cursor probe)", () => {
    for (const w of Object.values(WEAPONS)) {
      expect(w.maxRange).toBe(18);
    }
  });

  it("Burst Gun fires 3 bullets per click (multi-bullet model)", () => {
    expect(WEAPONS["burst-gun"].bulletsPerClick).toBe(3);
  });

  it("Missile blast: radius 2, 3 damage entries (r=0,1,2)", () => {
    const m = WEAPONS["missile-launcher"];
    expect(m.blast?.radius).toBe(2);
    expect(m.blast?.damageAtRadius).toHaveLength(3);
  });

  it("Missile damage curve: r0 ≈ 70, r1 ≈ 50, r2 ≈ 15 (from Match 2)", () => {
    const curve = WEAPONS["missile-launcher"].blast!.damageAtRadius;
    const mid = (b: { min: number; max: number }) => (b.min + b.max) / 2;
    expect(mid(curve[0]!)).toBeCloseTo(67.5, 0); // 55-80
    expect(mid(curve[1]!)).toBe(50); // 40-60
    expect(mid(curve[2]!)).toBe(15); // 13-17
  });

  it("Rifle full bracket (standing) is 18-25 (Match 3 confirmed)", () => {
    expect(WEAPONS.rifle.brackets!.standing.full).toEqual({ min: 18, max: 25 });
  });

  it("Rifle partial bracket (standing) is 10-17 (Match 1 d=6 confirmed)", () => {
    expect(WEAPONS.rifle.brackets!.standing.partial).toEqual({ min: 10, max: 17 });
  });

  it("Rifle crouching brackets are shifted ~25% lower than standing", () => {
    const r = WEAPONS.rifle.brackets!;
    expect(r.crouching.full.min).toBeLessThan(r.standing.full.min);
    expect(r.crouching.full.max).toBeLessThan(r.standing.full.max);
    expect(r.crouching.partial.min).toBeLessThan(r.standing.partial.min);
  });
});
