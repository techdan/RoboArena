/** Phase 10 authorized firing previews. These helpers never consume RNG or full enemy state. */

import {
  COVER_CLASS_HIT_SCORE,
  LIVE_FIRE_HIT_THRESHOLDS,
  WEAPON_ACCURACY_ADDS,
  WEAPON_MAX_RANGE,
} from "../engine/constants";
import type {
  AccuracyTier,
  Arena,
  CoverClass,
  Heading,
  Posture,
  RobotState,
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
const AIM_ACCURACY_INDEX: Readonly<Partial<Record<WeaponId, 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7>>> = {
  rifle: 0,
  "burst-gun": 3,
  "auto-rifle": 6,
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
}

export type AimPreviewStatus =
  "eligible" | "shooter-docked" | "out-of-range" | "angle-blocked" | "sight-blocked";

export interface AimPreview {
  readonly status: AimPreviewStatus;
  readonly distance: number;
  readonly target: TileCoord;
  readonly weapon: WeaponId;
  readonly authorizedContact: AuthorizedContact | null;
  readonly estimates: readonly HitEstimate[];
  readonly stoppedAt?: TileCoord;
}

export const availableWeapons = (robot: RobotState): readonly WeaponId[] =>
  [robot.definition.primaryWeapon, ...(robot.definition.secondaryWeapons ?? [])].filter(
    (weapon) => robot.ammo[weapon] === "unlimited" || (robot.ammo[weapon] ?? 0) > 0,
  );

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

const terrainAt = (arena: Arena, tile: TileCoord) => arena.tiles[tile.y]?.[tile.x]?.terrain;

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

const distanceAdjustment = (distance: number, accuracyBase: number): number => {
  if (distance > 12) return Math.floor(accuracyBase / 2) - 4;
  if (distance >= 7) return accuracyBase - 2;
  if (distance >= 3) return Math.floor(accuracyBase / 2) + (6 - distance);
  return accuracyBase + 2 * (3 - distance) + 2;
};

const estimate = (
  arena: Arena,
  from: TileCoord,
  target: TileCoord,
  posture: Posture,
  accuracy: AccuracyTier,
  weapon: WeaponId,
  damageStaggered: boolean,
): HitEstimate => {
  const distance = floorDistance(from, target);
  const coverClass = coverAt(arena, from, target, posture);
  const terrain = terrainAt(arena, target);
  const weaponAdd = WEAPON_ACCURACY_ADDS[AIM_ACCURACY_INDEX[weapon] ?? 0] ?? 0;
  const terrainAdd =
    terrain === "rough" ? 2 : terrain === "bush" ? -1 : terrain === "low-wall" ? -3 : weaponAdd;
  let score = Math.max(
    0,
    Math.min(
      19,
      COVER_CLASS_HIT_SCORE[coverClass] + distanceAdjustment(distance, accuracy + 4) + terrainAdd,
    ),
  );
  if (damageStaggered) score >>= 1;
  const threshold = LIVE_FIRE_HIT_THRESHOLDS[score] ?? 0;
  return {
    posture,
    coverClass,
    score,
    threshold,
    chancePercent: Math.round((threshold / 256) * 100),
  };
};

export const previewAim = (input: {
  readonly arena: Arena;
  readonly shooter: RobotState;
  readonly target: TileCoord;
  readonly weapon: WeaponId;
  readonly authorizedContacts: readonly AuthorizedContact[];
}): AimPreview => {
  const position = input.shooter.position;
  if (position === "dock")
    return {
      status: "shooter-docked",
      distance: 0,
      target: input.target,
      weapon: input.weapon,
      authorizedContact: null,
      estimates: [],
    };
  const distance = floorDistance(position, input.target);
  if (distance > PLANNER_WEAPON_RANGE[input.weapon])
    return {
      status: "out-of-range",
      distance,
      target: input.target,
      weapon: input.weapon,
      authorizedContact: null,
      estimates: [],
    };
  if (!isTileInScanGate(position, input.shooter.scanHeading, input.target))
    return {
      status: "angle-blocked",
      distance,
      target: input.target,
      weapon: input.weapon,
      authorizedContact: null,
      estimates: [],
    };
  const stoppedAt = [...lineExclusive(position, input.target), input.target].find((tile) => {
    const terrain = terrainAt(input.arena, tile);
    return terrain === "wall" || terrain === "outer-wall";
  });
  if (stoppedAt !== undefined)
    return {
      status: "sight-blocked",
      distance,
      target: input.target,
      weapon: input.weapon,
      authorizedContact: null,
      estimates: [],
      stoppedAt,
    };
  const contact =
    input.authorizedContacts.find(
      (candidate) => candidate.tile.x === input.target.x && candidate.tile.y === input.target.y,
    ) ?? null;
  const postures: readonly Posture[] =
    contact === null ? ["upright", "ducking", "crouching"] : [contact.posture];
  return {
    status: "eligible",
    distance,
    target: input.target,
    weapon: input.weapon,
    authorizedContact: contact,
    estimates: postures.map((posture) =>
      estimate(
        input.arena,
        position,
        input.target,
        posture,
        input.shooter.definition.accuracy,
        input.weapon,
        input.shooter.damageStaggerActionsRemaining > 0,
      ),
    ),
  };
};

export const defaultScanSettings = (weapon: WeaponId, remainingTicks: number) => ({
  maxDistance: PLANNER_WEAPON_RANGE[weapon],
  seconds: Math.max(1, Math.min(40, Math.ceil(Math.max(0, remainingTicks) / 60))),
});
