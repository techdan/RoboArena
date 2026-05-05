/**
 * Core engine types. All purely structural; no React, no DOM, no I/O.
 *
 * Sourced from `docs/initial-plan.md` §"Data model".
 */

// ──────────────────────────────────────────────────────────────────────────
// Tiles, coordinates, headings

export interface TileCoord {
  readonly x: number;
  readonly y: number;
}

/** 8-direction compass. Used for scan headings and movement direction. */
export type Heading = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type Terrain =
  | "open"
  | "rough"
  | "low-wall"
  | "wall"
  | "bush"
  | "crevice"
  | "outer-wall";

export interface ArenaTile {
  readonly terrain: Terrain;
}

// ──────────────────────────────────────────────────────────────────────────
// Robots

/**
 * v1 ships 2 postures (Standing + Crouching). Ducking is deferred to v2 —
 * see plan §"Ducking — deferred". Reintroducing it = adding "ducking" here
 * and slotting brackets/cover lookups for it; engine code paths are already
 * keyed by posture.
 */
export type Posture = "standing" | "crouching";

export type AccuracyTier = "high" | "medium" | "low";

export type RobotClass =
  | "rifle"
  | "burst"
  | "auto"
  | "missile"
  | "stealth";

export type WeaponId =
  | "rifle"
  | "burst-gun"
  | "auto-rifle"
  | "missile-launcher"
  | "grenade-launcher";

/**
 * Static class definition (Custom Game point-buy table). Engine reads these
 * to construct concrete `RobotState` instances at deploy time.
 */
export interface RobotDefinition {
  readonly class: RobotClass;
  readonly accuracy: AccuracyTier; // descriptive only — engine uses scan-zone hit chance
  readonly armor: number; // max HP
  readonly rating: number; // point cost
  readonly primaryWeapon: WeaponId;
  /** Some formations grant secondaries (e.g. Missile robots also carry Rifles). */
  readonly secondaryWeapons?: readonly WeaponId[];
  /** Stealth class: invisible unless moving or scanned from an adjacent tile. */
  readonly stealthVisibility?: "stealth";
}

export interface RobotState {
  readonly id: string;
  readonly teamId: string;
  readonly definition: RobotDefinition;
  readonly position: TileCoord | "dock";
  readonly hp: number;
  readonly posture: Posture;
  readonly scanHeading: Heading;
  /**
   * Stride parity for movement-cost alternation. Persists across non-move
   * commands; resets on deployment. 0 = next move costs the lower value
   * (0.3 s single, 0.4 s double); 1 = next move costs the higher value.
   */
  readonly strideParity: 0 | 1;
  /** Per-weapon ammo counter for explosives. Bullets are unlimited. */
  readonly ammo: Readonly<Record<WeaponId, number | "unlimited">>;
}

// ──────────────────────────────────────────────────────────────────────────
// Weapons

export interface DamageBracket {
  readonly min: number;
  readonly max: number;
}

/** Two damage brackets per posture; `P(full)` mixes them per shot via distance. */
export interface WeaponBrackets {
  readonly standing: { readonly full: DamageBracket; readonly partial: DamageBracket };
  readonly crouching: { readonly full: DamageBracket; readonly partial: DamageBracket };
}

export interface WeaponDefinition {
  readonly id: WeaponId;
  readonly displayName: string;
  /** `bullet` = single hit, `burst` = multi-bullet per click, `explosive` = blast. */
  readonly kind: "bullet" | "burst" | "explosive";
  /** For burst weapons (Burst Gun): bullets per click. Each rolls hit + bracket independently. */
  readonly bulletsPerClick: number;
  /** Per-click firing intervals (alternating, in ticks). [parity-0, parity-1] */
  readonly firingIntervalTicks: readonly [number, number];
  /** v1: all weapons cap at 18. */
  readonly maxRange: number;
  /** Bullet weapons have unlimited ammo; explosives are limited. */
  readonly startingAmmo: number | "unlimited";
  /** For bullet/burst weapons: per-bullet damage brackets by posture. Undefined for explosives. */
  readonly brackets?: WeaponBrackets;
  /** For explosives: blast radius and per-radius damage curve. */
  readonly blast?: {
    readonly radius: number;
    /** `damageAtRadius[i]` = damage bracket at Chebyshev distance i from impact. */
    readonly damageAtRadius: readonly DamageBracket[];
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Commands — what a robot is programmed to do during a turn

export type RobotCommandSegment =
  | { readonly kind: "move"; readonly path: readonly TileCoord[]; readonly posture: Posture }
  | { readonly kind: "set-posture"; readonly posture: Posture }
  | { readonly kind: "set-scan-direction"; readonly heading: Heading }
  | {
      readonly kind: "aim-and-fire";
      readonly target: TileCoord;
      readonly weapon: WeaponId;
      /** Ctrl+Shift on DOS / Alt on Amiga: repeat-fire at the same tile until budget runs out. */
      readonly repeat: boolean;
    }
  | {
      readonly kind: "scan-and-fire";
      readonly weapon: WeaponId;
      /** Player-set Scan-and-Fire engagement cap (NOT weapon range). */
      readonly maxDistance: number;
      /** Player-set duration to stay in scan-and-fire mode. */
      readonly seconds: number;
    };

export interface CommandTimeline {
  readonly robotId: string;
  readonly segments: readonly RobotCommandSegment[];
}

export interface TurnOrders {
  readonly turnNumber: number;
  readonly timelines: readonly CommandTimeline[];
}

// ──────────────────────────────────────────────────────────────────────────
// Resolution events — what the renderer consumes

export type ResolutionEvent =
  | { readonly kind: "move-step"; readonly tick: number; readonly robotId: string; readonly to: TileCoord }
  | { readonly kind: "posture-changed"; readonly tick: number; readonly robotId: string; readonly posture: Posture }
  | { readonly kind: "scan-rotated"; readonly tick: number; readonly robotId: string; readonly heading: Heading }
  | {
      readonly kind: "projectile-launched";
      readonly tick: number;
      readonly shooterId: string;
      readonly projectile: Projectile;
    }
  | {
      readonly kind: "projectile-impact";
      readonly tick: number;
      readonly impact: TileCoord;
      readonly hitRobotIds: readonly string[];
    }
  | {
      readonly kind: "hit";
      readonly tick: number;
      readonly targetId: string;
      readonly damage: number;
      readonly bracket: "full" | "partial";
    }
  | {
      readonly kind: "miss";
      readonly tick: number;
      readonly targetTile: TileCoord;
      readonly reason: "angle-blocked" | "wall-blocked" | "scan-grey" | "cover" | "target-moved";
    }
  | { readonly kind: "destroyed"; readonly tick: number; readonly robotId: string }
  | { readonly kind: "robot-returned-to-dock"; readonly tick: number; readonly robotId: string }
  | { readonly kind: "last-known-marker"; readonly tick: number; readonly tile: TileCoord; readonly observingTeamId: string };

export type Projectile =
  | { readonly kind: "tile"; readonly target: TileCoord; readonly impactTick: number; readonly weapon: WeaponId }
  | { readonly kind: "tracking"; readonly targetRobotId: string; readonly weapon: WeaponId };

// ──────────────────────────────────────────────────────────────────────────
// Match state and config

export type SportType =
  | "survival"
  | "treasure-hunt"
  | "capture-the-flag"
  | "hostage"
  | "baseball";

export type Formation =
  | "beginner"
  | "standard"
  | "fire-fight"
  | "missile-fest"
  | "beat-the-clock";

export type GameLength = "skirmish" | "melee" | "battle" | "campaign";

export type ArenaType = "rubble" | "suburbs" | "computer";

export interface GameConfig {
  readonly sportType: SportType;
  readonly formation: Formation;
  readonly length: GameLength;
  readonly arenaType: ArenaType;
  readonly arenaSizeName: string; // e.g. "Rubble Three"
  readonly turnLengthSeconds: number; // 1–40, default 15
}

export interface TeamState {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly side: 1 | 2 | 3 | 4;
  readonly brain: "human" | "stupid"; // v1: "human" only
  readonly robots: readonly RobotState[];
  readonly score: number;
}

export interface MatchState {
  readonly config: GameConfig;
  readonly turnNumber: number;
  readonly teams: readonly TeamState[];
  readonly arena: Arena;
  /** Last-known enemy positions per observing team, from the previous turn end. */
  readonly lastKnownMarkers: ReadonlyMap<string, readonly TileCoord[]>;
}

export interface Arena {
  readonly type: ArenaType;
  readonly sizeName: string; // "Rubble Three", etc.
  readonly width: number;
  readonly height: number;
  readonly tiles: ReadonlyArray<ReadonlyArray<ArenaTile>>; // tiles[y][x]
  readonly homeAreas: readonly HomeArea[];
  readonly dock: readonly TileCoord[];
}

export interface HomeArea {
  readonly corner: "NW" | "NE" | "SE" | "SW";
  readonly tiles: readonly TileCoord[];
}

// ──────────────────────────────────────────────────────────────────────────
// Replay

export interface ReplayLog {
  readonly initialState: MatchState;
  readonly seed: string;
  readonly turns: readonly {
    readonly orders: TurnOrders;
    readonly events: readonly ResolutionEvent[];
  }[];
}
