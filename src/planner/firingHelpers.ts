/** Phase 10 authorized firing previews. These helpers never consume RNG or full enemy state. */

import {
  COVER_CLASS_BULLET_DAMAGE_ADJUST,
  COVER_CLASS_HIT_SCORE,
  LIVE_FIRE_HIT_THRESHOLDS,
  WEAPON_ACCURACY_ADDS,
  WEAPON_MAX_RANGE,
  WEAPON_TIMING,
} from "../engine/constants";
import { WEAPON_CATALOG_DATA } from "../engine/catalogData";
import {
  calculateDirectDamageRangeFromFactors,
  calculateLiveFireBreakdownFromFactors,
  distanceScoreAdjustment,
  type DirectDamageRange,
  type LiveFireScoreBreakdown,
} from "../engine/liveFireMath";
import type {
  AccuracyTier,
  Arena,
  CoverClass,
  Heading,
  Posture,
  RobotState,
  RobotCommandSegment,
  TileCoord,
  WeaponId,
} from "../engine/types";

const HEADING_VECTORS: Readonly<Record<Heading, readonly [number, number]>> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};
export const PLANNER_WEAPON_RANGE: Readonly<Record<WeaponId, number>> = {
  rifle: WEAPON_MAX_RANGE,
  "burst-gun": WEAPON_MAX_RANGE,
  "auto-rifle": WEAPON_MAX_RANGE,
  "missile-launcher": WEAPON_MAX_RANGE,
  "grenade-launcher": WEAPON_MAX_RANGE,
};
export const WEAPON_LABELS: Readonly<Record<WeaponId, string>> = {
  rifle: "Rifle",
  "burst-gun": "Burst Gun",
  "auto-rifle": "Machine Gun",
  "missile-launcher": "Missile Launcher",
  "grenade-launcher": "Grenade Launcher",
};
const WEAPON_RESOLUTION: Readonly<Record<WeaponId, "direct-hit-roll" | "blast">> = {
  rifle: "direct-hit-roll",
  "burst-gun": "direct-hit-roll",
  "auto-rifle": "direct-hit-roll",
  "missile-launcher": "blast",
  "grenade-launcher": "blast",
};

export interface AuthorizedContact {
  readonly id: string;
  readonly label: string;
  readonly tile: TileCoord;
  readonly posture: Posture;
}

export interface HitEstimate {
  readonly posture: Posture;
  readonly coverClass: CoverClass;
  readonly score: number;
  readonly threshold: number;
  readonly chancePercent: number;
  readonly breakdown: LiveFireScoreBreakdown;
  readonly offTileBreakdown: LiveFireScoreBreakdown | null;
  readonly damageRange: DirectDamageRange | null;
}

export type HitChanceBand = "excellent" | "good" | "risky" | "poor" | "zero";

export const hitChanceBand = (chancePercent: number): HitChanceBand => {
  if (chancePercent >= 75) return "excellent";
  if (chancePercent >= 50) return "good";
  if (chancePercent >= 25) return "risky";
  if (chancePercent > 0) return "poor";
  return "zero";
};

export const targetingOpportunityTicks = (weapon: WeaponId, fireMode: "aim" | "scan"): number =>
  fireMode === "scan"
    ? WEAPON_TIMING[weapon].scanFiringIntervalTicks
    : WEAPON_TIMING[weapon].firingIntervalTicks;

export type AimPreviewStatus =
  "eligible" | "shooter-docked" | "out-of-range" | "angle-blocked" | "sight-blocked";

export interface AimPreview {
  readonly status: AimPreviewStatus;
  readonly distance: number;
  readonly target: TileCoord;
  readonly weapon: WeaponId;
  readonly authorizedContact: AuthorizedContact | null;
  readonly resolution: "direct-hit-roll" | "blast";
  readonly fireMode: "aim" | "scan";
  readonly scanStrength: number;
  readonly onConeBoundary: boolean;
  readonly estimates: readonly HitEstimate[];
  readonly stoppedAt?: TileCoord;
}

const projectedAmmo = (
  robot: RobotState,
  segments: readonly RobotCommandSegment[],
): Readonly<Record<WeaponId, number | "unlimited">> => {
  const ammo = { ...robot.ammo };
  for (const segment of segments) {
    if (segment.kind !== "aim-and-fire" && segment.kind !== "scan-and-fire") continue;
    const remaining = ammo[segment.weapon];
    if (remaining === "unlimited") continue;
    ammo[segment.weapon] =
      segment.kind === "scan-and-fire" || segment.repeat ? 0 : Math.max(0, remaining - 1);
  }
  return ammo;
};

/**
 * Scan & Fire and repeat fire conservatively reserve all remaining finite ammo.
 * This keeps later commands legal regardless of hidden runtime acquisitions.
 */
export const availableWeapons = (
  robot: RobotState,
  segments: readonly RobotCommandSegment[] = [],
): readonly WeaponId[] => {
  const ammo = projectedAmmo(robot, segments);
  return [robot.definition.primaryWeapon, ...(robot.definition.secondaryWeapons ?? [])].filter(
    (weapon) => ammo[weapon] === "unlimited" || (ammo[weapon] ?? 0) > 0,
  );
};

const floorDistance = (from: TileCoord, to: TileCoord): number => {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  return Math.floor(Math.sqrt(dx * dx + dy * dy));
};

export const isTileInScanGate = (from: TileCoord, heading: Heading, target: TileCoord): boolean => {
  const [headingX, headingY] = HEADING_VECTORS[heading];
  return headingX * (target.x - from.x) + headingY * (target.y - from.y) >= 0;
};

const lineExclusive = (from: TileCoord, to: TileCoord): readonly TileCoord[] => {
  const tiles: TileCoord[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = Math.abs(to.y - y);
  const stepX = x < to.x ? 1 : -1;
  const stepY = y < to.y ? 1 : -1;
  let error = dx - dy;
  while (x !== to.x || y !== to.y) {
    const doubled = 2 * error;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
    if (x === to.x && y === to.y) break;
    tiles.push({ x, y });
  }
  return tiles;
};

const isOnScanGateBoundary = (from: TileCoord, heading: Heading, target: TileCoord): boolean => {
  if (from.x === target.x && from.y === target.y) return false;
  const [headingX, headingY] = HEADING_VECTORS[heading];
  return headingX * (target.x - from.x) + headingY * (target.y - from.y) === 0;
};

const terrainAt = (arena: Arena, tile: TileCoord) => arena.tiles[tile.y]?.[tile.x]?.terrain;

const previewScanSightStrength = (arena: Arena, from: TileCoord, to: TileCoord): number => {
  if (from.x === to.x && from.y === to.y) return 16;
  let strength = 16;
  for (const tile of [from, ...lineExclusive(from, to), to]) {
    const terrain = terrainAt(arena, tile);
    if (terrain === undefined || terrain === "wall" || terrain === "outer-wall") return 0;
    if (terrain === "low-wall" || terrain === "bush") strength = Math.max(0, strength - 3);
  }
  return strength;
};

const targetSamples = (from: TileCoord, to: TileCoord) => {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const distance = Math.max(dx, dy);
  const stepX = Math.sign(from.x - to.x);
  const stepY = Math.sign(from.y - to.y);
  return {
    center: to,
    major:
      distance < 2
        ? undefined
        : dx > dy
          ? { x: to.x + stepX, y: to.y }
          : { x: to.x, y: to.y + stepY },
    diagonal:
      distance > 1 && Math.abs(dx - dy) < 2 ? { x: to.x + stepX, y: to.y + stepY } : undefined,
  };
};

const coverAt = (arena: Arena, from: TileCoord, to: TileCoord, posture: Posture): CoverClass => {
  if (from.x === to.x && from.y === to.y) return 4;
  const samples = targetSamples(from, to);
  const terrains = [samples.center, samples.major, samples.diagonal]
    .filter((tile): tile is TileCoord => tile !== undefined)
    .map((tile) => terrainAt(arena, tile));
  const elevated = terrains.includes("low-wall");
  const bush = terrains.includes("bush");
  if (elevated) return posture === "upright" ? 3 : posture === "ducking" ? 2 : 1;
  if (bush) return posture === "upright" ? 4 : posture === "ducking" ? 3 : 2;
  return posture === "crouching" ? 3 : 4;
};

const estimate = (
  arena: Arena,
  from: TileCoord,
  target: TileCoord,
  posture: Posture,
  accuracy: AccuracyTier,
  weapon: WeaponId,
  damageStaggered: boolean,
  fireMode: "aim" | "scan",
  scanStrength: number,
): HitEstimate => {
  const distance = floorDistance(from, target);
  const coverClass = coverAt(arena, from, target, posture);
  const weaponDefinition = {
    id: weapon,
    ...WEAPON_CATALOG_DATA[weapon],
    ...WEAPON_TIMING[weapon],
    maxRange: WEAPON_MAX_RANGE,
  } as const;
  const targetTerrain = terrainAt(arena, target);
  const accuracyIndex =
    fireMode === "scan"
      ? (weaponDefinition.scanAccuracyAddIndex ?? weaponDefinition.accuracyAddIndex ?? 0)
      : (weaponDefinition.accuracyAddIndex ?? 0);
  const weaponTerrainAdjustment =
    targetTerrain === "rough"
      ? 2
      : targetTerrain === "bush"
        ? -1
        : targetTerrain === "low-wall"
          ? -3
          : (WEAPON_ACCURACY_ADDS[accuracyIndex] ?? 0);
  const breakdownInput = {
    fireMode,
    coverAdjustment: COVER_CLASS_HIT_SCORE[coverClass],
    distanceAccuracyAdjustment: distanceScoreAdjustment(distance, accuracy + 4),
    weaponTerrainAdjustment,
    scanStrength: fireMode === "scan" ? scanStrength : 16,
    damageStaggered,
    hitThresholds: LIVE_FIRE_HIT_THRESHOLDS,
  } as const;
  const breakdown = calculateLiveFireBreakdownFromFactors({
    ...breakdownInput,
    targetOnAimedTile: true,
  });
  const offTileBreakdown =
    fireMode === "aim"
      ? calculateLiveFireBreakdownFromFactors({ ...breakdownInput, targetOnAimedTile: false })
      : null;
  const damageRoll = weaponDefinition.damageRoll;
  const damageRange =
    damageRoll === undefined
      ? null
      : calculateDirectDamageRangeFromFactors({
          rawMinimum: damageRoll.base,
          rawMaximum: damageRoll.base + damageRoll.mask,
          coverAdjustment: COVER_CLASS_BULLET_DAMAGE_ADJUST[coverClass],
          distanceAdjustment: distance > 12 ? -4 : distance < 5 ? 4 : 0,
          bulletsPerClick: weaponDefinition.bulletsPerClick,
        });
  return {
    posture,
    coverClass,
    score: breakdown.finalScore,
    threshold: breakdown.threshold,
    chancePercent: breakdown.chancePercent,
    breakdown,
    offTileBreakdown,
    damageRange,
  };
};

export const previewAim = (input: {
  readonly arena: Arena;
  readonly shooter: RobotState;
  readonly target: TileCoord;
  readonly weapon: WeaponId;
  readonly authorizedContacts: readonly AuthorizedContact[];
  readonly fireMode?: "aim" | "scan";
  readonly maxDistance?: number;
  readonly assumedPostures?: readonly Posture[];
}): AimPreview => {
  const resolution = WEAPON_RESOLUTION[input.weapon];
  const fireMode = input.fireMode ?? "aim";
  const position = input.shooter.position;
  if (position === "dock")
    return {
      status: "shooter-docked",
      distance: 0,
      target: input.target,
      weapon: input.weapon,
      authorizedContact: null,
      resolution,
      fireMode,
      scanStrength: 0,
      onConeBoundary: false,
      estimates: [],
    };
  const distance = floorDistance(position, input.target);
  const maxDistance = Math.min(
    PLANNER_WEAPON_RANGE[input.weapon],
    input.maxDistance ?? PLANNER_WEAPON_RANGE[input.weapon],
  );
  const onConeBoundary = isOnScanGateBoundary(position, input.shooter.scanHeading, input.target);
  if (distance > maxDistance)
    return {
      status: "out-of-range",
      distance,
      target: input.target,
      weapon: input.weapon,
      authorizedContact: null,
      resolution,
      fireMode,
      scanStrength: 0,
      onConeBoundary,
      estimates: [],
    };
  if (!isTileInScanGate(position, input.shooter.scanHeading, input.target))
    return {
      status: "angle-blocked",
      distance,
      target: input.target,
      weapon: input.weapon,
      authorizedContact: null,
      resolution,
      fireMode,
      scanStrength: 0,
      onConeBoundary,
      estimates: [],
    };
  const scanStrength =
    fireMode === "scan" ? previewScanSightStrength(input.arena, position, input.target) : 16;
  const stoppedAt = [...lineExclusive(position, input.target), input.target].find((tile) => {
    const terrain = terrainAt(input.arena, tile);
    return terrain === "wall" || terrain === "outer-wall";
  });
  if (stoppedAt !== undefined || scanStrength === 0)
    return {
      status: "sight-blocked",
      distance,
      target: input.target,
      weapon: input.weapon,
      authorizedContact: null,
      resolution,
      fireMode,
      scanStrength,
      onConeBoundary,
      estimates: [],
      ...(stoppedAt === undefined ? {} : { stoppedAt }),
    };
  const contact =
    input.authorizedContacts.find(
      (candidate) => candidate.tile.x === input.target.x && candidate.tile.y === input.target.y,
    ) ?? null;
  const postures: readonly Posture[] =
    contact === null
      ? (input.assumedPostures ?? ["upright", "ducking", "crouching"])
      : [contact.posture];
  return {
    status: "eligible",
    distance,
    target: input.target,
    weapon: input.weapon,
    authorizedContact: contact,
    resolution,
    fireMode,
    scanStrength,
    onConeBoundary,
    estimates:
      resolution === "blast"
        ? []
        : postures.map((posture) =>
            estimate(
              input.arena,
              position,
              input.target,
              posture,
              input.shooter.definition.accuracy,
              input.weapon,
              input.shooter.damageStaggerActionsRemaining > 0,
              fireMode,
              scanStrength,
            ),
          ),
  };
};

export interface TargetingTilePreview extends AimPreview {
  readonly tile: TileCoord;
  readonly chancePercent: number | null;
  readonly chanceBand: HitChanceBand | null;
}

/**
 * Deterministic, participant-authorized planner overlay. Empty tiles use the
 * three public posture assumptions; only explicit contacts narrow that set.
 */
export const previewTargetingTiles = (input: {
  readonly arena: Arena;
  readonly shooter: RobotState;
  readonly weapon: WeaponId;
  readonly authorizedContacts: readonly AuthorizedContact[];
  readonly fireMode: "aim" | "scan";
  readonly maxDistance: number;
  readonly assumedPosture?: Posture;
}): readonly TargetingTilePreview[] => {
  const tiles: TargetingTilePreview[] = [];
  for (let y = 0; y < input.arena.height; y += 1) {
    for (let x = 0; x < input.arena.width; x += 1) {
      const tile = { x, y };
      const preview = previewAim({
        arena: input.arena,
        shooter: input.shooter,
        target: tile,
        weapon: input.weapon,
        authorizedContacts: input.authorizedContacts,
        fireMode: input.fireMode,
        maxDistance: input.maxDistance,
        assumedPostures: [input.assumedPosture ?? "upright"],
      });
      const chancePercent = preview.estimates[0]?.chancePercent ?? null;
      tiles.push({
        ...preview,
        tile,
        chancePercent,
        chanceBand: chancePercent === null ? null : hitChanceBand(chancePercent),
      });
    }
  }
  return tiles;
};

export const defaultScanSettings = (weapon: WeaponId, remainingTicks: number) => ({
  maxDistance: PLANNER_WEAPON_RANGE[weapon],
  seconds: Math.max(1, Math.min(40, Math.floor(Math.max(0, remainingTicks) / 60))),
});
