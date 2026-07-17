import { ROBOT_CATALOG_DATA, WEAPON_CATALOG_DATA } from "../../engine/catalogData";
import {
  DEPLOY_COST_TICKS,
  MOVE_DOUBLE_COST_TICKS,
  MOVE_SINGLE_COST_TICKS,
  POSTURE_CHANGE_COST_TICKS,
  SCAN_DIRECTION_COST_TICKS,
  TICKS_PER_SECOND,
  WEAPON_MAX_RANGE,
  WEAPON_TIMING,
} from "../../engine/constants";
import { canTraverse, isFullSpeedTerrain } from "../../engine/traversal";
import type { Posture, RobotClass, Terrain, WeaponId } from "../../engine/types";

export type HelpTab = "robots" | "terrain" | "actions";
export type V1RobotClass = Exclude<RobotClass, "stealth">;
export type ActionHelpId =
  "movement" | "posture" | "scan-direction" | "aim-fire" | "scan-fire" | "timeline" | "lock-orders";
export type HelpTopicId = `robot:${V1RobotClass}` | `terrain:${Terrain}` | `action:${ActionHelpId}`;

export interface HelpFact {
  readonly label: string;
  readonly value: string;
}

export interface HelpTopic {
  readonly id: HelpTopicId;
  readonly tab: HelpTab;
  readonly title: string;
  readonly summary: string;
  readonly details: readonly string[];
  readonly facts: readonly HelpFact[];
}

const V1_ROBOT_CLASSES: readonly V1RobotClass[] = ["rifle", "burst", "auto", "missile"];
export const TERRAIN_TYPES: readonly Terrain[] = [
  "open",
  "rough",
  "low-wall",
  "wall",
  "bush",
  "crevice",
  "outer-wall",
];
const POSTURES: readonly Posture[] = ["upright", "ducking", "crouching"];

const titleCase = (value: string): string =>
  value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const ticks = (value: number): string =>
  `${value} ticks · ${(value / TICKS_PER_SECOND).toFixed(2)}s`;

const weaponSummary = (weaponId: WeaponId): string => {
  const weapon = WEAPON_CATALOG_DATA[weaponId];
  const ammo =
    weapon.startingAmmo === "unlimited" ? "unlimited ammo" : `${weapon.startingAmmo} ammo`;
  return `${weapon.displayName}, range ${WEAPON_MAX_RANGE}, ${ammo}`;
};

const robotRole: Readonly<Record<V1RobotClass, string>> = {
  rifle: "Durable, accurate line unit for dependable direct fire.",
  burst: "Balanced close-to-mid-range attacker that rolls three bullets per burst.",
  auto: "Fast-firing pressure unit with lighter armor and lower accuracy.",
  missile: "Limited-ammo explosive support whose blast can also hurt friendlies.",
};

export const ROBOT_HELP: readonly HelpTopic[] = V1_ROBOT_CLASSES.map((robotClass) => {
  const robot = ROBOT_CATALOG_DATA[robotClass];
  const weapons = [robot.primaryWeapon, ...(robot.secondaryWeapons ?? [])];
  return {
    id: `robot:${robotClass}`,
    tab: "robots",
    title: `${titleCase(robotClass)} Robot`,
    summary: robotRole[robotClass],
    details: [
      "Upright and ducking can cross passable terrain; crouching can move only on open ground.",
      "Lower posture can improve endpoint cover, but posture changes consume timeline time.",
    ],
    facts: [
      { label: "Armor", value: `${robot.armor} HP` },
      { label: "Accuracy", value: `Tier ${robot.accuracy}` },
      { label: "Rating", value: `${robot.rating}` },
      { label: "Weapons", value: weapons.map(weaponSummary).join("; ") },
    ],
  } satisfies HelpTopic;
});

const terrainSummary: Readonly<Record<Terrain, string>> = {
  open: "Clear ground and the only terrain eligible for compressed two-tile movement.",
  rough: "Passable slow ground that forces one-tile movement selectors.",
  "low-wall": "Passable while upright or ducking and valuable as endpoint cover.",
  wall: "Solid terrain that blocks movement and line of sight.",
  bush: "Passable slow terrain that changes endpoint cover.",
  crevice: "Impassable terrain; shots may cross it when sight is otherwise clear.",
  "outer-wall": "Arena boundary that blocks movement and line of sight.",
};

const terrainCover: Readonly<Record<Terrain, string>> = {
  open: "Baseline endpoint cover; crouching changes the target profile.",
  rough: "Baseline endpoint cover; movement is slowed.",
  "low-wall": "Raised endpoint cover whose result depends on posture and shot direction.",
  wall: "Blocks sight completely.",
  bush: "Bush endpoint samples improve cover depending on posture.",
  crevice: "No special endpoint cover; terrain is impassable.",
  "outer-wall": "Blocks sight completely.",
};

export const TERRAIN_HELP: readonly HelpTopic[] = TERRAIN_TYPES.map((terrain) => ({
  id: `terrain:${terrain}`,
  tab: "terrain",
  title: titleCase(terrain),
  summary: terrainSummary[terrain],
  details: [
    "Cover is resolved from terrain samples at the target end of the shot, not from a generic tile bonus.",
    "Robot posture and nearby endpoint samples can change the final cover class.",
  ],
  facts: [
    {
      label: "Traversal",
      value: POSTURES.map(
        (posture) => `${titleCase(posture)}: ${canTraverse(posture, terrain) ? "yes" : "no"}`,
      ).join(" · "),
    },
    { label: "Two-tile move", value: isFullSpeedTerrain(terrain) ? "Eligible" : "No" },
    { label: "Cover / sight", value: terrainCover[terrain] },
  ],
}));

const weaponCadences = (mode: "aim" | "scan"): string =>
  (Object.keys(WEAPON_CATALOG_DATA) as WeaponId[])
    .filter((weaponId) => weaponId !== "grenade-launcher")
    .map(
      (weaponId) =>
        `${WEAPON_CATALOG_DATA[weaponId].displayName} ${
          mode === "aim"
            ? WEAPON_TIMING[weaponId].firingIntervalTicks
            : WEAPON_TIMING[weaponId].scanFiringIntervalTicks
        }t`,
    )
    .join(" · ");

export const ACTION_HELP: readonly HelpTopic[] = [
  {
    id: "action:movement",
    tab: "actions",
    title: "Movement",
    summary:
      "Tap or click a destination to append the cheapest legal route from the projected endpoint.",
    details: [
      "One-tile selectors cost the fixed single-step amount. Two-tile selectors are used only when both tiles permit full-speed compression.",
      "Editing an earlier command removes later commands that no longer form a legal timeline.",
    ],
    facts: [
      { label: "One tile", value: ticks(MOVE_SINGLE_COST_TICKS) },
      { label: "Two tiles", value: ticks(MOVE_DOUBLE_COST_TICKS) },
      { label: "Deploy", value: ticks(DEPLOY_COST_TICKS) },
    ],
  },
  {
    id: "action:posture",
    tab: "actions",
    title: "Posture",
    summary: "Set upright, ducking, or crouching posture at an exact point in the program.",
    details: [
      "Posture affects movement permission, cover, and the projected state used by later commands.",
    ],
    facts: [{ label: "Change cost", value: ticks(POSTURE_CHANGE_COST_TICKS) }],
  },
  {
    id: "action:scan-direction",
    tab: "actions",
    title: "Scan Direction",
    summary: "Set the center heading of the inclusive forward scan semicircle.",
    details: ["The two perpendicular boundary rays are included in the scan gate."],
    facts: [{ label: "Change cost", value: ticks(SCAN_DIRECTION_COST_TICKS) }],
  },
  {
    id: "action:aim-fire",
    tab: "actions",
    title: "Aim & Fire",
    summary:
      "Target a tile immediately; a robot on another tile is never substituted as the target.",
    details: [
      "Repeat fire schedules another shot at the selected weapon cadence while time remains.",
      "The authorized preview can explain range, sight, cover, and visible target state without exposing hidden contacts.",
    ],
    facts: [{ label: "Cadence", value: weaponCadences("aim") }],
  },
  {
    id: "action:scan-fire",
    tab: "actions",
    title: "Scan & Fire",
    summary:
      "Watch the forward scan gate for a visible eligible contact, then fire on acquisition.",
    details: [
      "You choose both engagement distance and duration. Command boundaries create deterministic acquisition opportunities.",
      "The engagement distance is a player-set cap and does not change the weapon’s maximum range.",
    ],
    facts: [{ label: "Repeat cadence", value: weaponCadences("scan") }],
  },
  {
    id: "action:timeline",
    tab: "actions",
    title: "Program Timeline",
    summary: "Commands execute from left to right over the 60-tick-per-second turn clock.",
    details: [
      "Commands beyond the turn horizon stay in the draft but do not execute this turn.",
      "Scrubbing previews each robot’s projected position, posture, and scan heading without resolving combat.",
    ],
    facts: [{ label: "Clock", value: `${TICKS_PER_SECOND} ticks per second` }],
  },
  {
    id: "action:lock-orders",
    tab: "actions",
    title: "Lock Orders",
    summary: "Submit the private program as final for this turn.",
    details: [
      "Opponents see only readiness, never your draft. Resolution begins when every active player has locked.",
      "Saving to the server preserves a draft; locking prevents further edits for that turn.",
    ],
    facts: [],
  },
];

export const HELP_TOPICS: readonly HelpTopic[] = [...ROBOT_HELP, ...TERRAIN_HELP, ...ACTION_HELP];
const HELP_BY_ID = new Map(HELP_TOPICS.map((topic) => [topic.id, topic]));

export const helpTopic = (id: HelpTopicId): HelpTopic => {
  const topic = HELP_BY_ID.get(id);
  if (topic === undefined) throw new Error(`Unknown help topic: ${id}`);
  return topic;
};

export const helpTopicsForTab = (tab: HelpTab): readonly HelpTopic[] =>
  HELP_TOPICS.filter((topic) => topic.tab === tab);
