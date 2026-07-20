/** Pure presentation helpers for the Phase 11.8.1 planner command surface. */

import type {
  Heading,
  RobotCommandSegment,
  RobotState,
  TileCoord,
  WeaponId,
} from "../engine/types";
import { WEAPON_LABELS } from "./firingHelpers";

export const HEADINGS: readonly Heading[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export const headingFromVector = (x: number, y: number): Heading => {
  if (x === 0 && y === 0) return "N";
  const clockwiseDegrees = (Math.atan2(y, x) * 180) / Math.PI + 90;
  const index = Math.round(clockwiseDegrees / 45 + HEADINGS.length) % HEADINGS.length;
  return HEADINGS[index] ?? "N";
};

const COMPACT_WEAPON_LABELS: Readonly<Record<WeaponId, string>> = {
  rifle: "Rifle",
  "burst-gun": "Burst",
  "auto-rifle": "Auto",
  "missile-launcher": "Missile",
  "grenade-launcher": "Grenade",
};

const titleCase = (value: string): string =>
  value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

export const robotDisplayNames = (robots: readonly RobotState[]): ReadonlyMap<string, string> => {
  const totals = new Map<string, number>();
  for (const robot of robots)
    totals.set(robot.definition.class, (totals.get(robot.definition.class) ?? 0) + 1);
  const seen = new Map<string, number>();
  return new Map(
    robots.map((robot) => {
      const robotClass = robot.definition.class;
      const ordinal = (seen.get(robotClass) ?? 0) + 1;
      seen.set(robotClass, ordinal);
      const base = titleCase(robotClass);
      return [robot.id, totals.get(robotClass) === 1 ? base : `${base} ${ordinal}`] as const;
    }),
  );
};

const directions = {
  "0,-1": "↑",
  "1,-1": "↗",
  "1,0": "→",
  "1,1": "↘",
  "0,1": "↓",
  "-1,1": "↙",
  "-1,0": "←",
  "-1,-1": "↖",
} as const;

const arrowForStep = (from: TileCoord, to: TileCoord): string => {
  const key = `${Math.sign(to.x - from.x)},${Math.sign(to.y - from.y)}`;
  return directions[key as keyof typeof directions] ?? "·";
};

export interface CommandPresentation {
  readonly label: string;
  readonly compact: string;
  readonly detail: string;
  readonly weapon: WeaponId | null;
}

export const commandPresentation = (
  segment: RobotCommandSegment,
  startPosition?: TileCoord | "dock",
): CommandPresentation => {
  switch (segment.kind) {
    case "deploy":
      return {
        label: "Deploy",
        compact: `${segment.to.x},${segment.to.y}`,
        detail: `Deploy at tile ${segment.to.x},${segment.to.y}`,
        weapon: null,
      };
    case "move": {
      const arrows: string[] = [];
      let previous = startPosition === "dock" ? undefined : startPosition;
      for (const step of segment.path) {
        if (previous !== undefined && step.via !== undefined) {
          arrows.push(arrowForStep(previous, step.via));
          previous = step.via;
        }
        if (previous !== undefined) arrows.push(arrowForStep(previous, step.to));
        previous = step.to;
      }
      return {
        label: "Move",
        compact: arrows.join("").slice(0, 8) || "Move",
        detail: `${segment.path.length} movement selector${segment.path.length === 1 ? "" : "s"} while ${segment.posture}`,
        weapon: null,
      };
    }
    case "set-posture":
      return {
        label: "Posture",
        compact: titleCase(segment.posture),
        detail: `Change posture to ${segment.posture}`,
        weapon: null,
      };
    case "set-scan-direction":
      return {
        label: "Scan direction",
        compact: segment.heading,
        detail: `Set scan direction to ${segment.heading}`,
        weapon: null,
      };
    case "aim-and-fire":
      return {
        label: "Aim & Fire",
        compact: `${COMPACT_WEAPON_LABELS[segment.weapon]} · ${segment.target.x},${segment.target.y}`,
        detail: `${WEAPON_LABELS[segment.weapon]} at tile ${segment.target.x},${segment.target.y}`,
        weapon: segment.weapon,
      };
    case "scan-and-fire":
      return {
        label: "Scan & Fire",
        compact: `${COMPACT_WEAPON_LABELS[segment.weapon]} · ${segment.maxDistance}t · ${segment.seconds}s`,
        detail: `${WEAPON_LABELS[segment.weapon]}, ${segment.maxDistance} tiles for ${segment.seconds} seconds`,
        weapon: segment.weapon,
      };
  }
};

export const rotateHeading = (heading: Heading, delta: -1 | 1): Heading => {
  const index = HEADINGS.indexOf(heading);
  return HEADINGS[(index + delta + HEADINGS.length) % HEADINGS.length] ?? heading;
};

export const removableSegmentIndex = (segmentCount: number): number | null =>
  segmentCount > 0 ? segmentCount - 1 : null;
