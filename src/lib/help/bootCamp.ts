/**
 * Boot Camp quick-start facts.
 *
 * Every number shown by the onboarding flow is derived here from the canonical
 * engine catalog/constants (docs/spec.md §2-§6) so the tutorial can never drift
 * from the resolver. Only qualitative copy is hand-written, and
 * `bootCamp.test.ts` locks each comparative claim ("most armor", "fastest
 * trigger") to the data it summarizes.
 */

import { ROBOT_CATALOG_DATA, WEAPON_CATALOG_DATA } from "../../engine/catalogData";
import {
  ARENA_DIMENSIONS,
  COVER_CLASS_BULLET_DAMAGE_ADJUST,
  COVER_CLASS_HIT_SCORE,
  DEPLOY_COST_TICKS,
  fireControlAccuracyAdjustment,
  LIVE_FIRE_HIT_THRESHOLDS,
  MOVE_DOUBLE_COST_TICKS,
  POSTURE_CHANGE_COST_TICKS,
  ROBOTS_PER_TEAM_BY_LENGTH,
  SCAN_DIRECTION_COST_TICKS,
  TICKS_PER_SECOND,
  TURN_DURATION_TICKS_DEFAULT,
  WEAPON_MAX_RANGE,
  WEAPON_TIMING,
} from "../../engine/constants";
import {
  calculateLiveFireBreakdownFromFactors,
  distanceScoreAdjustment,
} from "../../engine/liveFireMath";
import type {
  CoverClass,
  Posture,
  RandomMaskRoll,
  RobotClass,
  WeaponDefinition,
  WeaponId,
} from "../../engine/types";
import type { RoomConfig } from "../setup/validate";
import type { V1RobotClass } from "./content";

// ──────────────────────────────────────────────────────────────────────────
// Browser-safe engine mirrors
//
// Next.js cannot bundle engine modules that use runtime `./x.js` imports
// (catalog.ts, firing.ts, cover.ts, blast.ts), so — like planner/firingHelpers —
// this module composes the dependency-free engine pieces and mirrors the few
// tiny resolver formulas it needs. `bootCamp.test.ts` asserts every mirror is
// identical to the real engine function over its whole input domain.

/** Same composition as `engine/catalog.ts` WEAPONS. */
export const WEAPONS: Readonly<Record<WeaponId, WeaponDefinition>> = Object.fromEntries(
  (Object.keys(WEAPON_CATALOG_DATA) as WeaponId[]).map((id) => [
    id,
    { id, ...WEAPON_CATALOG_DATA[id], ...WEAPON_TIMING[id], maxRange: WEAPON_MAX_RANGE },
  ]),
) as Record<WeaponId, WeaponDefinition>;

/** Mirror of `engine/catalog.ts` DEFAULT_ROSTER_BY_LENGTH (parity-tested). */
export const ROSTER_BY_LENGTH: Readonly<Record<SelectableLength, readonly RobotClass[]>> = {
  melee: ["rifle", "burst", "auto", "missile"],
  battle: ["rifle", "rifle", "burst", "burst", "auto", "missile"],
};

/** Mirror of `engine/cover.ts` coverClassForTerrain (parity-tested). */
export const coverClassForPostureOn = (
  posture: Posture,
  terrain: "open" | "rough" | "bush" | "low-wall",
): CoverClass => {
  if (terrain === "low-wall") return posture === "upright" ? 3 : posture === "ducking" ? 2 : 1;
  if (terrain === "bush") return posture === "upright" ? 4 : posture === "ducking" ? 3 : 2;
  return posture === "crouching" ? 3 : 4;
};

/** Mirror of `engine/blast.ts` applyExplosiveCoverCut (parity-tested). */
export const explosiveCoverCut = (raw: number, coverClass: CoverClass): number => {
  if (coverClass === 1) return raw >> 1;
  if (coverClass === 2) return raw - (raw >> 2);
  if (coverClass === 3) return raw - (raw >> 3);
  return raw;
};

/** Mirror of the bullet distance damage adjustment in `engine/firing.ts` (parity-tested). */
export const bulletDistanceDamageAdjust = (distance: number): number =>
  distance > 12 ? -4 : distance < 5 ? 4 : 0;

export const V1_CLASSES: readonly V1RobotClass[] = ["rifle", "burst", "auto", "missile"];
export const POSTURES: readonly Posture[] = ["upright", "ducking", "crouching"];
export const COVER_CLASSES: readonly CoverClass[] = [4, 3, 2, 1];

/** Game lengths a v1 room can select (mirrors `roomConfigSchema`; locked by tests). */
export const SELECTABLE_LENGTHS = [
  "melee",
  "battle",
] as const satisfies readonly RoomConfig["gameLength"][];
export type SelectableLength = (typeof SELECTABLE_LENGTHS)[number];

export const CLASS_LABEL: Readonly<Record<V1RobotClass, string>> = {
  rifle: "Rifle",
  burst: "Burst",
  auto: "Auto",
  missile: "Missile",
};

export const POSTURE_LABEL: Readonly<Record<Posture, string>> = {
  upright: "Upright",
  ducking: "Ducking",
  crouching: "Crouching",
};

// ──────────────────────────────────────────────────────────────────────────
// Generic numeric helpers

export interface NumericRange {
  readonly min: number;
  readonly max: number;
}

/** Inclusive range of `base + (random & mask)`. */
export const damageRollRange = (roll: RandomMaskRoll): NumericRange => ({
  min: roll.base,
  max: roll.base + roll.mask,
});

/** Mean of `base + (random & mask)` for a uniform random value. */
export const damageRollAverage = (roll: RandomMaskRoll): number => roll.base + roll.mask / 2;

export const formatRange = (range: NumericRange): string =>
  range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;

export const ticksToSeconds = (ticks: number): number => ticks / TICKS_PER_SECOND;

/** Short human second label: 0.5s, 0.17s, 15s. */
export const formatSeconds = (ticks: number): string => {
  const seconds = ticksToSeconds(ticks);
  return `${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(2))}s`;
};

/**
 * Normalize values to 0..1 bars against the largest value. A positive
 * `floor` keeps tiny-but-nonzero values visible; zero stays zero.
 */
export const normalizeBars = (values: readonly number[], floor = 0): number[] => {
  const max = Math.max(0, ...values);
  if (max <= 0) return values.map(() => 0);
  return values.map((value) => {
    if (value <= 0) return 0;
    return Math.max(floor, Math.min(1, value / max));
  });
};

// ──────────────────────────────────────────────────────────────────────────
// Squad comparison

export interface ClassStats {
  readonly robotClass: V1RobotClass;
  readonly label: string;
  readonly armor: number;
  readonly accuracyTier: number;
  readonly weaponId: WeaponId;
  readonly weaponName: string;
  readonly kind: WeaponDefinition["kind"];
  /** Damage of a single bullet, or a direct (radius 0) blast. */
  readonly damagePerHit: NumericRange;
  readonly shotsPerTrigger: number;
  /** Total damage if every bullet of one trigger hits (or a direct blast). */
  readonly damagePerTrigger: NumericRange;
  readonly averageDamagePerTrigger: number;
  readonly aimIntervalTicks: number;
  readonly scanIntervalTicks: number;
  readonly triggersPerSecond: number;
  /** Average damage per second of Aim & Fire if every shot lands. */
  readonly peakDamagePerSecond: number;
  readonly range: number;
  readonly ammo: number | "unlimited";
  readonly secondaryWeaponNames: readonly string[];
}

const hitRoll = (weapon: WeaponDefinition): RandomMaskRoll => {
  const roll = weapon.damageRoll ?? weapon.blast?.damageAtRadius[0];
  if (roll === undefined) throw new Error(`Weapon ${weapon.id} has no damage roll.`);
  return roll;
};

export const classStats = (robotClass: V1RobotClass): ClassStats => {
  const robot = ROBOT_CATALOG_DATA[robotClass];
  const weapon = WEAPONS[robot.primaryWeapon];
  const roll = hitRoll(weapon);
  const perHit = damageRollRange(roll);
  const shots = weapon.bulletsPerClick;
  const averagePerTrigger = damageRollAverage(roll) * shots;
  const triggersPerSecond = TICKS_PER_SECOND / weapon.firingIntervalTicks;
  return {
    robotClass,
    label: CLASS_LABEL[robotClass],
    armor: robot.armor,
    accuracyTier: robot.accuracy,
    weaponId: weapon.id,
    weaponName: weapon.displayName,
    kind: weapon.kind,
    damagePerHit: perHit,
    shotsPerTrigger: shots,
    damagePerTrigger: { min: perHit.min * shots, max: perHit.max * shots },
    averageDamagePerTrigger: averagePerTrigger,
    aimIntervalTicks: weapon.firingIntervalTicks,
    scanIntervalTicks: weapon.scanFiringIntervalTicks,
    triggersPerSecond,
    peakDamagePerSecond: averagePerTrigger * triggersPerSecond,
    range: weapon.maxRange,
    ammo: weapon.startingAmmo,
    secondaryWeaponNames: (robot.secondaryWeapons ?? []).map((id) => WEAPONS[id].displayName),
  };
};

export const SQUAD_STATS: readonly ClassStats[] = V1_CLASSES.map(classStats);

export type StatBarId = "armor" | "accuracy" | "trigger" | "rate" | "output";

export interface StatBar {
  readonly id: StatBarId;
  readonly label: string;
  /** 0..1, normalized across the four v1 classes. */
  readonly fill: number;
  readonly value: string;
}

const MAX_ACCURACY_TIER = 2;

/** Stat bars for every v1 class, each normalized against the best class. */
export const squadStatBars = (
  stats: readonly ClassStats[] = SQUAD_STATS,
): ReadonlyMap<V1RobotClass, readonly StatBar[]> => {
  const armor = normalizeBars(stats.map((entry) => entry.armor));
  // Tier 0 is still a working gun, so accuracy bars count tiers from one.
  const accuracy = stats.map((entry) => (entry.accuracyTier + 1) / (MAX_ACCURACY_TIER + 1));
  const trigger = normalizeBars(stats.map((entry) => entry.averageDamagePerTrigger));
  const rate = normalizeBars(stats.map((entry) => entry.triggersPerSecond));
  const output = normalizeBars(stats.map((entry) => entry.peakDamagePerSecond));
  return new Map(
    stats.map((entry, index) => [
      entry.robotClass,
      [
        { id: "armor", label: "Armor", fill: armor[index] ?? 0, value: `${entry.armor} HP` },
        {
          id: "accuracy",
          label: "Accuracy",
          fill: accuracy[index] ?? 0,
          value: `Tier ${entry.accuracyTier}`,
        },
        {
          id: "trigger",
          label: "Damage / trigger",
          fill: trigger[index] ?? 0,
          value: formatRange(entry.damagePerTrigger),
        },
        {
          id: "rate",
          label: "Fire rate",
          fill: rate[index] ?? 0,
          value: `${Number(entry.triggersPerSecond.toFixed(1))}/s`,
        },
        {
          id: "output",
          label: "Peak output",
          fill: output[index] ?? 0,
          value: `~${Math.round(entry.peakDamagePerSecond)}/s`,
        },
      ] satisfies StatBar[],
    ]),
  );
};

export interface ClassBriefing {
  readonly role: string;
  readonly bestAt: readonly string[];
  readonly watchOut: readonly string[];
}

const stat = (robotClass: V1RobotClass): ClassStats => {
  const found = SQUAD_STATS.find((entry) => entry.robotClass === robotClass);
  if (found === undefined) throw new Error(`Missing stats for ${robotClass}`);
  return found;
};

/** Hand-written role copy with every number pulled from the catalog. */
export const CLASS_BRIEFING: Readonly<Record<V1RobotClass, ClassBriefing>> = {
  rifle: {
    role: "Tough sharpshooter",
    bestAt: [
      `Most armor on the team (${stat("rifle").armor} HP)`,
      "Most accurate Scan & Fire ambusher",
    ],
    watchOut: [
      `One bullet per trigger (${formatRange(stat("rifle").damagePerHit)} dmg)`,
      "Lowest damage output",
    ],
  },
  burst: {
    role: "Hard-hitting brawler",
    bestAt: [
      `Widest damage roll (${formatRange(stat("burst").damagePerHit)} per hit)`,
      `Quick ${formatSeconds(stat("burst").aimIntervalTicks)} trigger`,
    ],
    watchOut: [`${stat("burst").armor} HP armor`, "Less accurate than the Rifle in Scan & Fire"],
  },
  auto: {
    role: "Rapid suppressor",
    bestAt: [
      `Fastest trigger (${formatSeconds(stat("auto").aimIntervalTicks)} between shots)`,
      "Shredding exposed, upright targets",
    ],
    watchOut: ["Lowest accuracy: struggles vs cover and long range", `${stat("auto").armor} HP`],
  },
  missile: {
    role: "Blast artillery",
    bestAt: [
      `Blasts never roll to hit (${formatRange(stat("missile").damagePerHit)} direct)`,
      "Punishing clusters and robots in cover",
    ],
    watchOut: [
      `Only ${String(stat("missile").ammo)} missiles per match`,
      "Blasts hurt your own robots too",
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Rosters by game length

export interface RosterSlot {
  readonly robotClass: RobotClass;
  readonly count: number;
}

export interface LengthRoster {
  readonly length: SelectableLength;
  readonly label: string;
  readonly robots: number;
  readonly arena: { readonly width: number; readonly height: number };
  readonly slots: readonly RosterSlot[];
}

export const rosterSlots = (roster: readonly RobotClass[]): RosterSlot[] => {
  const counts = new Map<RobotClass, number>();
  for (const robotClass of roster) counts.set(robotClass, (counts.get(robotClass) ?? 0) + 1);
  return [...counts].map(([robotClass, count]) => ({ robotClass, count }));
};

export const LENGTH_ROSTERS: readonly LengthRoster[] = SELECTABLE_LENGTHS.map((length) => ({
  length,
  label: `${length.slice(0, 1).toUpperCase()}${length.slice(1)}`,
  robots: ROBOTS_PER_TEAM_BY_LENGTH[length],
  arena: ARENA_DIMENSIONS[length],
  slots: rosterSlots(ROSTER_BY_LENGTH[length]),
}));

// ──────────────────────────────────────────────────────────────────────────
// Weapons, damage, cover

/** Distances where bullet damage changes, probed from the (parity-tested) formula. */
export interface DistanceDamageBand {
  readonly from: number;
  readonly to: number;
  readonly adjustment: number;
}

export const bulletDistanceBands = (
  weapon: WeaponDefinition = WEAPONS.rifle,
): DistanceDamageBand[] => {
  const bands: DistanceDamageBand[] = [];
  for (let distance = 1; distance <= weapon.maxRange; distance += 1) {
    const adjustment = bulletDistanceDamageAdjust(distance);
    const last = bands.at(-1);
    if (last !== undefined && last.adjustment === adjustment) {
      bands[bands.length - 1] = { ...last, to: distance };
    } else {
      bands.push({ from: distance, to: distance, adjustment });
    }
  }
  return bands;
};

export interface BlastRing {
  readonly radius: number;
  readonly damage: NumericRange;
}

export const missileBlastRings = (
  weapon: WeaponDefinition = WEAPONS["missile-launcher"],
): BlastRing[] =>
  (weapon.blast?.damageAtRadius ?? []).map((roll, radius) => ({
    radius,
    damage: damageRollRange(roll),
  }));

export interface CoverClassEffect {
  readonly coverClass: CoverClass;
  readonly hitScore: number;
  readonly bulletDamageAdjust: number;
  /** Fraction of blast damage that still lands (exact integer cut on 256). */
  readonly blastFraction: number;
}

export const coverClassEffects = (): CoverClassEffect[] =>
  COVER_CLASSES.map((coverClass) => ({
    coverClass,
    hitScore: COVER_CLASS_HIT_SCORE[coverClass],
    bulletDamageAdjust: COVER_CLASS_BULLET_DAMAGE_ADJUST[coverClass],
    blastFraction: explosiveCoverCut(256, coverClass) / 256,
  }));

/** Plain-language cover situations a player can create on the board. */
export type CoverSpot = "open" | "bush" | "low-wall";
export const COVER_SPOTS: readonly { readonly id: CoverSpot; readonly label: string }[] = [
  { id: "open", label: "In the open" },
  { id: "bush", label: "Bush cover" },
  { id: "low-wall", label: "Behind a low wall" },
];

export const coverClassFor = (posture: Posture, spot: CoverSpot): CoverClass =>
  coverClassForPostureOn(posture, spot);

/**
 * Engine hit chance (Aim or Scan & Fire, target inside the shooter's front
 * arc). Scan & Fire uses the full 18-tile Maximum Distance unless given one;
 * a tighter Maximum Distance aims better.
 */
export const hitChancePercent = (input: {
  readonly robotClass: V1RobotClass;
  readonly distance: number;
  readonly coverClass: CoverClass;
  readonly fireMode?: "aim" | "scan";
  readonly scanMaxDistance?: number;
}): number => {
  const robot = ROBOT_CATALOG_DATA[input.robotClass];
  const fireMode = input.fireMode ?? "aim";
  return calculateLiveFireBreakdownFromFactors({
    fireMode,
    coverAdjustment: COVER_CLASS_HIT_SCORE[input.coverClass],
    distanceAccuracyAdjustment: distanceScoreAdjustment(input.distance, robot.accuracy + 4),
    fireControlAdjustment: fireControlAccuracyAdjustment(fireMode, input.scanMaxDistance),
    // Full scan sight (clear line): Scan & Fire takes no sight-strength penalty.
    scanStrength: 16,
    damageStaggered: false,
    targetInFrontArc: true,
    hitThresholds: LIVE_FIRE_HIT_THRESHOLDS,
  }).chancePercent;
};

/** Example distances for the posture/cover chance table. */
export const COVER_EXAMPLE = { shooter: "rifle" as V1RobotClass, near: 5, far: 13 } as const;

export interface CoverMatrixRow {
  readonly posture: Posture;
  readonly cells: readonly {
    readonly spot: CoverSpot;
    readonly coverClass: CoverClass;
    readonly nearChance: number;
    readonly farChance: number;
  }[];
}

export const coverMatrix = (): CoverMatrixRow[] =>
  POSTURES.map((posture) => ({
    posture,
    cells: COVER_SPOTS.map(({ id: spot }) => {
      const coverClass = coverClassFor(posture, spot);
      const chance = (distance: number) =>
        hitChancePercent({
          robotClass: COVER_EXAMPLE.shooter,
          distance,
          coverClass,
        });
      return {
        spot,
        coverClass,
        nearChance: chance(COVER_EXAMPLE.near),
        farChance: chance(COVER_EXAMPLE.far),
      };
    }),
  }));

/** Aim vs Scan hit chance per class at one distance; Scan's Maximum Distance is set to that distance. */
export const fireModeComparison = (distance: number, coverClass: CoverClass) =>
  V1_CLASSES.map((robotClass) => ({
    robotClass,
    aim: hitChancePercent({ robotClass, distance, coverClass, fireMode: "aim" }),
    scan: hitChancePercent({
      robotClass,
      distance,
      coverClass,
      fireMode: "scan",
      scanMaxDistance: distance,
    }),
  }));

// ──────────────────────────────────────────────────────────────────────────
// Turn anatomy

export interface ProgramSegment {
  readonly id: string;
  readonly label: string;
  readonly ticks: number;
  readonly tone: "deploy" | "move" | "posture" | "scan" | "fire";
}

/** An example opening program that fills exactly one default turn. */
export const exampleOpeningProgram = (
  budgetTicks: number = TURN_DURATION_TICKS_DEFAULT,
): ProgramSegment[] => {
  const fixed: ProgramSegment[] = [
    { id: "deploy", label: "Deploy", ticks: DEPLOY_COST_TICKS, tone: "deploy" },
    { id: "move", label: "Move 6 tiles", ticks: MOVE_DOUBLE_COST_TICKS * 3, tone: "move" },
    { id: "crouch", label: "Crouch", ticks: POSTURE_CHANGE_COST_TICKS, tone: "posture" },
    { id: "scan", label: "Face enemy", ticks: SCAN_DIRECTION_COST_TICKS, tone: "scan" },
  ];
  const used = fixed.reduce((total, segment) => total + segment.ticks, 0);
  return [
    ...fixed,
    { id: "ambush", label: "Scan & Fire", ticks: Math.max(0, budgetTicks - used), tone: "fire" },
  ];
};

export const WEAPON_RANGE = WEAPON_MAX_RANGE;
