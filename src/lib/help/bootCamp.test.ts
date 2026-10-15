import { describe, expect, it } from "vitest";
import { DEFAULT_ROSTER_BY_LENGTH, ROBOT_DEFINITIONS, WEAPONS } from "../../engine/catalog.js";
import {
  COVER_CLASS_HIT_SCORE,
  ROBOTS_PER_TEAM_BY_LENGTH,
  TURN_DURATION_TICKS_DEFAULT,
} from "../../engine/constants.js";
import { applyExplosiveCoverCut } from "../../engine/blast.js";
import { coverClassForTerrain } from "../../engine/cover.js";
import {
  calculateDirectDamageRange,
  calculateLiveFireScoreBreakdown,
} from "../../engine/firing.js";
import type { WeaponId } from "../../engine/types.js";
import { roomConfigSchema, DEFAULT_ROOM_CONFIG } from "../setup/validate.js";
import {
  bulletDistanceDamageAdjust,
  coverClassForPostureOn,
  explosiveCoverCut,
  ROSTER_BY_LENGTH,
  WEAPONS as BOOT_CAMP_WEAPONS,
  bulletDistanceBands,
  CLASS_BRIEFING,
  classStats,
  COVER_SPOTS,
  coverClassEffects,
  coverMatrix,
  damageRollAverage,
  damageRollRange,
  exampleOpeningProgram,
  fireModeComparison,
  formatRange,
  formatSeconds,
  hitChancePercent,
  LENGTH_ROSTERS,
  missileBlastRings,
  normalizeBars,
  POSTURES,
  rosterSlots,
  SELECTABLE_LENGTHS,
  SQUAD_STATS,
  squadStatBars,
  V1_CLASSES,
} from "./bootCamp.js";

const byClass = (robotClass: (typeof V1_CLASSES)[number]) =>
  SQUAD_STATS.find((entry) => entry.robotClass === robotClass)!;

describe("Boot Camp numeric helpers", () => {
  it("derives inclusive damage ranges and averages from base/mask rolls", () => {
    expect(damageRollRange({ base: 10, mask: 7 })).toEqual({ min: 10, max: 17 });
    expect(damageRollRange({ base: 60, mask: 31 })).toEqual({ min: 60, max: 91 });
    expect(damageRollAverage({ base: 8, mask: 15 })).toBe(15.5);
    expect(formatRange({ min: 8, max: 23 })).toBe("8–23");
    expect(formatRange({ min: 4, max: 4 })).toBe("4");
  });

  it("normalizes bars against the largest value with an optional visibility floor", () => {
    expect(normalizeBars([140, 120, 100, 100])).toEqual([1, 120 / 140, 100 / 140, 100 / 140]);
    expect(normalizeBars([0, 1, 100], 0.1)).toEqual([0, 0.1, 1]);
    expect(normalizeBars([0, 0])).toEqual([0, 0]);
    expect(normalizeBars([])).toEqual([]);
  });

  it("formats engine ticks as readable seconds", () => {
    expect(formatSeconds(30)).toBe("0.5s");
    expect(formatSeconds(10)).toBe("0.17s");
    expect(formatSeconds(TURN_DURATION_TICKS_DEFAULT)).toBe("15s");
  });
});

describe("Boot Camp squad stats", () => {
  it("covers every v1 class and each of their primary/secondary weapons", () => {
    expect(SQUAD_STATS.map((entry) => entry.robotClass)).toEqual([
      "rifle",
      "burst",
      "auto",
      "missile",
    ]);
    const v1Weapons = new Set<WeaponId>(
      V1_CLASSES.flatMap((robotClass) => [
        ROBOT_DEFINITIONS[robotClass].primaryWeapon,
        ...(ROBOT_DEFINITIONS[robotClass].secondaryWeapons ?? []),
      ]),
    );
    const shown = new Set(SQUAD_STATS.map((entry) => entry.weaponId));
    for (const weaponId of v1Weapons) expect(shown.has(weaponId), weaponId).toBe(true);
    for (const robotClass of V1_CLASSES) {
      expect(CLASS_BRIEFING[robotClass].bestAt.length).toBeGreaterThan(0);
      expect(CLASS_BRIEFING[robotClass].watchOut.length).toBeGreaterThan(0);
    }
  });

  it("derives every stat from the canonical catalog", () => {
    for (const robotClass of V1_CLASSES) {
      const robot = ROBOT_DEFINITIONS[robotClass];
      const weapon = WEAPONS[robot.primaryWeapon];
      const stats = classStats(robotClass);
      const roll = weapon.damageRoll ?? weapon.blast!.damageAtRadius[0]!;
      expect(stats.armor).toBe(robot.armor);
      expect(stats.accuracyTier).toBe(robot.accuracy);
      expect(stats.damagePerHit).toEqual({ min: roll.base, max: roll.base + roll.mask });
      expect(stats.shotsPerTrigger).toBe(weapon.bulletsPerClick);
      expect(stats.damagePerTrigger.max).toBe((roll.base + roll.mask) * weapon.bulletsPerClick);
      expect(stats.aimIntervalTicks).toBe(weapon.firingIntervalTicks);
      expect(stats.scanIntervalTicks).toBe(weapon.scanFiringIntervalTicks);
      expect(stats.range).toBe(weapon.maxRange);
      expect(stats.ammo).toBe(weapon.startingAmmo);
    }
    expect(byClass("burst").damagePerTrigger).toEqual({ min: 8, max: 23 });
    expect(byClass("missile").secondaryWeaponNames).toEqual([WEAPONS.rifle.displayName]);
  });

  it("produces normalized bars where the best class fills the bar", () => {
    const bars = squadStatBars();
    for (const id of ["armor", "trigger", "rate", "output"] as const) {
      const fills = V1_CLASSES.map(
        (robotClass) => bars.get(robotClass)!.find((bar) => bar.id === id)!.fill,
      );
      expect(Math.max(...fills), id).toBe(1);
      for (const fill of fills) expect(fill).toBeGreaterThan(0);
      for (const fill of fills) expect(fill).toBeLessThanOrEqual(1);
    }
    expect(bars.get("rifle")!.find((bar) => bar.id === "accuracy")!.fill).toBe(1);
  });

  // Locks the hand-written "best at / watch out" copy to the data it summarizes.
  it("keeps comparative briefing claims true", () => {
    const most = <K extends keyof (typeof SQUAD_STATS)[number]>(key: K) =>
      [...SQUAD_STATS].sort((a, b) => Number(b[key]) - Number(a[key]))[0]!.robotClass;
    const least = <K extends keyof (typeof SQUAD_STATS)[number]>(key: K) =>
      [...SQUAD_STATS].sort((a, b) => Number(a[key]) - Number(b[key]))[0]!.robotClass;
    expect(most("armor")).toBe("rifle");
    expect(most("peakDamagePerSecond")).toBe("missile");
    expect(least("peakDamagePerSecond")).toBe("rifle");
    expect(least("aimIntervalTicks")).toBe("auto");
    expect(least("accuracyTier")).toBe("auto");
    expect(byClass("missile").ammo).not.toBe("unlimited");
    for (const robotClass of ["rifle", "burst", "auto"] as const)
      expect(byClass(robotClass).ammo).toBe("unlimited");
    // Rifle is the best Scan & Fire shooter against covered targets.
    for (const distance of [4, 8, 13]) {
      const rows = fireModeComparison(distance, 1);
      const rifle = rows.find((row) => row.robotClass === "rifle")!.scan;
      for (const row of rows) expect(rifle).toBeGreaterThanOrEqual(row.scan);
      const burst = rows.find((row) => row.robotClass === "burst")!;
      expect(rifle).toBeGreaterThan(burst.scan);
    }
  });
});

describe("Boot Camp rosters", () => {
  it("lists exactly the game lengths a room can select", () => {
    for (const gameLength of SELECTABLE_LENGTHS) {
      expect(
        roomConfigSchema.safeParse({
          ...DEFAULT_ROOM_CONFIG,
          gameLength,
          arenaName: gameLength === "melee" ? "rubble-two" : "rubble-three",
        }).success,
      ).toBe(true);
    }
    for (const gameLength of ["skirmish", "campaign"]) {
      expect(roomConfigSchema.safeParse({ ...DEFAULT_ROOM_CONFIG, gameLength }).success).toBe(
        false,
      );
    }
  });

  it("derives roster counts from the default roster table", () => {
    expect(rosterSlots(["rifle", "rifle", "burst"])).toEqual([
      { robotClass: "rifle", count: 2 },
      { robotClass: "burst", count: 1 },
    ]);
    for (const roster of LENGTH_ROSTERS) {
      const total = roster.slots.reduce((sum, slot) => sum + slot.count, 0);
      expect(total).toBe(DEFAULT_ROSTER_BY_LENGTH[roster.length].length);
      expect(total).toBe(ROBOTS_PER_TEAM_BY_LENGTH[roster.length]);
    }
  });
});

describe("Boot Camp combat facts", () => {
  it("derives the missile blast rings from the catalog", () => {
    const blast = WEAPONS["missile-launcher"].blast!;
    const rings = missileBlastRings();
    expect(rings).toHaveLength(blast.radius + 1);
    expect(rings[0]).toEqual({ radius: 0, damage: { min: 60, max: 91 } });
    expect(rings.at(-1)!.radius).toBe(blast.radius);
  });

  it("probes the engine for bullet distance damage bands", () => {
    const bands = bulletDistanceBands();
    expect(bands[0]).toMatchObject({ from: 1, adjustment: 4 });
    expect(bands.at(-1)).toMatchObject({ to: WEAPONS.rifle.maxRange, adjustment: -4 });
    expect(bands.some((band) => band.adjustment === 0)).toBe(true);
  });

  it("orders cover classes from exposed to best cover", () => {
    const effects = coverClassEffects();
    expect(effects.map((effect) => effect.coverClass)).toEqual([4, 3, 2, 1]);
    expect(effects.map((effect) => effect.hitScore)).toEqual([
      COVER_CLASS_HIT_SCORE[4],
      COVER_CLASS_HIT_SCORE[3],
      COVER_CLASS_HIT_SCORE[2],
      COVER_CLASS_HIT_SCORE[1],
    ]);
    expect(effects.map((effect) => effect.blastFraction)).toEqual([1, 7 / 8, 3 / 4, 1 / 2]);
  });

  it("builds a posture × cover matrix where lower posture never raises hit chance", () => {
    const matrix = coverMatrix();
    expect(matrix.map((row) => row.posture)).toEqual(POSTURES);
    for (const row of matrix)
      expect(row.cells.map((cell) => cell.spot)).toEqual(COVER_SPOTS.map((spot) => spot.id));
    for (let spot = 0; spot < COVER_SPOTS.length; spot += 1) {
      const far = matrix.map((row) => row.cells[spot]!.farChance);
      expect(far[0]!).toBeGreaterThanOrEqual(far[1]!);
      expect(far[1]!).toBeGreaterThanOrEqual(far[2]!);
    }
    const crouchedBehindWall = matrix[2]!.cells.find((cell) => cell.spot === "low-wall")!;
    expect(crouchedBehindWall.coverClass).toBe(1);
  });

  it("matches the engine for representative hit chances", () => {
    expect(hitChancePercent({ robotClass: "rifle", distance: 8, coverClass: 4 })).toBe(94);
    expect(hitChancePercent({ robotClass: "auto", distance: 13, coverClass: 1 })).toBeLessThan(
      hitChancePercent({ robotClass: "rifle", distance: 13, coverClass: 1 }),
    );
  });

  it("fills exactly one default turn with the example opening", () => {
    const program = exampleOpeningProgram();
    expect(program.reduce((total, segment) => total + segment.ticks, 0)).toBe(
      TURN_DURATION_TICKS_DEFAULT,
    );
    expect(program[0]!.id).toBe("deploy");
  });
});

describe("Boot Camp browser-safe engine mirrors", () => {
  it("composes weapons and rosters identically to engine/catalog", () => {
    expect(BOOT_CAMP_WEAPONS).toEqual(WEAPONS);
    for (const length of SELECTABLE_LENGTHS) {
      expect(ROSTER_BY_LENGTH[length]).toEqual(DEFAULT_ROSTER_BY_LENGTH[length]);
    }
  });

  it("matches engine cover, blast cut, and distance damage formulas", () => {
    for (const posture of POSTURES) {
      for (const terrain of ["open", "rough", "bush", "low-wall"] as const) {
        expect(coverClassForPostureOn(posture, terrain)).toBe(
          coverClassForTerrain(posture, terrain),
        );
      }
    }
    for (const coverClass of [1, 2, 3, 4] as const) {
      for (let raw = 0; raw <= 120; raw += 1) {
        expect(explosiveCoverCut(raw, coverClass)).toBe(applyExplosiveCoverCut(raw, coverClass));
      }
    }
    for (let distance = 0; distance <= WEAPONS.rifle.maxRange + 2; distance += 1) {
      const engine = calculateDirectDamageRange({
        weapon: WEAPONS.rifle,
        coverClass: 2,
        distance,
      });
      expect(bulletDistanceDamageAdjust(distance)).toBe(engine!.distanceAdjustment);
    }
  });

  it("matches the engine live-fire chance for every class, distance, cover, mode, and scan distance", () => {
    for (const robotClass of V1_CLASSES) {
      const robot = ROBOT_DEFINITIONS[robotClass];
      for (const fireMode of ["aim", "scan"] as const) {
        for (const coverClass of [1, 2, 3, 4] as const) {
          for (const scanMaxDistance of [4, 10, 18] as const) {
            for (let distance = 0; distance <= WEAPONS.rifle.maxRange; distance += 1) {
              const engine = calculateLiveFireScoreBreakdown({
                accuracy: robot.accuracy,
                distance,
                coverClass,
                targetInFrontArc: true,
                fireMode,
                scanMaxDistance,
              }).chancePercent;
              const mirrored = hitChancePercent({
                robotClass,
                distance,
                coverClass,
                fireMode,
                scanMaxDistance,
              });
              expect(mirrored).toBe(engine);
            }
          }
        }
      }
    }
  });
});
