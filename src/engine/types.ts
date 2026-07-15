/**
 * Core engine types. All purely structural; no React, no DOM, no I/O.
 *
 * Sourced from `docs/spec.md`.
 */

// ──────────────────────────────────────────────────────────────────────────
// Tiles, coordinates, headings

export interface TileCoord {
  readonly x: number;
  readonly y: number;
}

/** 8-direction compass. Used for scan headings and movement direction. */
export type Heading = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type Terrain = "open" | "rough" | "low-wall" | "wall" | "bush" | "crevice" | "outer-wall";

export interface ArenaTile {
  readonly terrain: Terrain;
}

// ──────────────────────────────────────────────────────────────────────────
// Robots

/** Stored as 1/2/3 in the original (RE §14/§15). */
export type Posture = "upright" | "ducking" | "crouching";

/** Exact stat-table values: Auto 0, Burst/Missile/Stealth 1, Rifle 2. */
export type AccuracyTier = 0 | 1 | 2;

export type CoverClass = 1 | 2 | 3 | 4;

export type RobotClass = "rifle" | "burst" | "auto" | "missile" | "stealth";

export type WeaponId =
  "rifle" | "burst-gun" | "auto-rifle" | "missile-launcher" | "grenade-launcher";

/**
 * Static class definition (Custom Game point-buy table). Engine reads these
 * to construct concrete `RobotState` instances at deploy time.
 */
export interface RobotDefinition {
  readonly class: RobotClass;
  readonly accuracy: AccuracyTier;
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

export interface RandomMaskRoll {
  readonly base: number;
  readonly mask: number;
}

export interface WeaponDefinition {
  readonly id: WeaponId;
  readonly displayName: string;
  /** `bullet` = single hit, `burst` = multi-bullet per click, `explosive` = blast. */
  readonly kind: "bullet" | "burst" | "explosive";
  /** For burst weapons: bullets per click. Each rolls hit and damage independently. */
  readonly bulletsPerClick: number;
  /** Fixed cost for the selected firing command, in 60 Hz ticks. */
  readonly firingIntervalTicks: number;
  /** v1: all weapons cap at 18. */
  readonly maxRange: number;
  /** Bullet weapons have unlimited ammo; explosives are limited. */
  readonly startingAmmo: number | "unlimited";
  /** Direct-fire base + (random & mask), before cover/distance adjustments. */
  readonly damageRoll?: RandomMaskRoll;
  /** Index into the exact 0x1596 add table; mapping is still provisional. */
  readonly accuracyAddIndex?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** For explosives: blast radius and per-radius damage curve. */
  readonly blast?: {
    readonly radius: number;
    /** `damageAtRadius[i]` = base + (random & mask) at Euclidean radius i. */
    readonly damageAtRadius: readonly RandomMaskRoll[];
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Commands — what a robot is programmed to do during a turn

export type RobotCommandSegment =
  | { readonly kind: "deploy"; readonly to: TileCoord }
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

interface EventEnvelope {
  readonly tick: number;
  readonly seq: number;
}

export type ResolutionEvent = EventEnvelope &
  (
    | { readonly kind: "turn-start"; readonly turnNumber: number }
    | {
        readonly kind: "command-start";
        readonly robotId: string;
        readonly commandIndex: number;
        readonly commandKind: RobotCommandSegment["kind"];
      }
    | {
        readonly kind: "deployed";
        readonly robotId: string;
        readonly to: TileCoord;
      }
    | {
        readonly kind: "move-step";
        readonly robotId: string;
        readonly to: TileCoord;
      }
    | {
        readonly kind: "posture-changed";
        readonly robotId: string;
        readonly posture: Posture;
      }
    | {
        readonly kind: "scan-rotated";
        readonly robotId: string;
        readonly heading: Heading;
      }
    | {
        readonly kind: "fired";
        readonly shooterId: string;
        readonly commandIndex: number;
        readonly weapon: WeaponId;
        readonly target: TileCoord;
      }
    | {
        readonly kind: "shot-missed";
        readonly shooterId: string;
        readonly shotIndex: number;
        readonly target: TileCoord;
        readonly reason:
          "out-of-range" | "angle-blocked" | "sight-blocked" | "hit-roll" | "no-target";
        readonly score?: number;
      }
    | {
        readonly kind: "damaged";
        readonly sourceId: string;
        readonly shotIndex: number;
        readonly targetId: string;
        readonly damage: number;
        readonly score: number;
      }
    | { readonly kind: "destroyed"; readonly robotId: string }
    | {
        readonly kind: "command-aborted";
        readonly robotId: string;
        readonly commandIndex: number;
        readonly reason: "destroyed";
      }
    | { readonly kind: "turn-end"; readonly turnNumber: number }
  );

export type Projectile =
  | {
      readonly kind: "tile";
      readonly target: TileCoord;
      readonly impactTick: number;
      readonly weapon: WeaponId;
    }
  | { readonly kind: "tracking"; readonly targetRobotId: string; readonly weapon: WeaponId };

// ──────────────────────────────────────────────────────────────────────────
// Match state and config

export type SportType = "survival" | "treasure-hunt" | "capture-the-flag" | "hostage" | "baseball";

export type Formation = "beginner" | "standard" | "fire-fight" | "missile-fest" | "beat-the-clock";

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
  readonly formatVersion: number;
  readonly initialState: MatchState;
  readonly seed: string;
  readonly turns: readonly {
    readonly orders: TurnOrders;
    /** Optional digest of derived events; events are not replay source-of-truth. */
    readonly eventDigest?: string;
  }[];
}
