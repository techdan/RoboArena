/**
 * Plain-language names for draft edits, so Undo and Redo can say what they
 * will take back ("Burst: move to 4,7") instead of acting blind. Pure: it
 * compares two order snapshots and never touches planner state.
 */

import type { RobotCommandSegment, TurnOrders } from "../engine/types";

const POSTURE_NAMES = { upright: "stand", ducking: "duck", crouching: "crouch" } as const;

/** One segment as a short lower-case phrase. */
export const describeSegment = (segment: RobotCommandSegment): string => {
  switch (segment.kind) {
    case "deploy":
      return `deploy at ${segment.to.x},${segment.to.y}`;
    case "move": {
      const last = segment.path.at(-1);
      return last === undefined ? "move" : `move to ${last.to.x},${last.to.y}`;
    }
    case "set-posture":
      return POSTURE_NAMES[segment.posture];
    case "set-scan-direction":
      return `face ${segment.heading}`;
    case "aim-and-fire":
      return `aim at ${segment.target.x},${segment.target.y}`;
    case "scan-and-fire":
      return "scan & fire";
    case "zap":
      return "zap";
    case "place-bomb":
      return "place bomb";
    case "self-destruct":
      return "self destruct";
  }
};

const sameSegment = (a: RobotCommandSegment | undefined, b: RobotCommandSegment | undefined) =>
  a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);

/**
 * What changed between two drafts, from the first robot whose timeline
 * differs. Returns null when the drafts are identical.
 */
export const describeOrdersChange = (
  before: TurnOrders,
  after: TurnOrders,
  names: ReadonlyMap<string, string>,
): string | null => {
  const ids = [
    ...new Set([...before.timelines, ...after.timelines].map((timeline) => timeline.robotId)),
  ];
  for (const id of ids) {
    const from = before.timelines.find((timeline) => timeline.robotId === id)?.segments ?? [];
    const to = after.timelines.find((timeline) => timeline.robotId === id)?.segments ?? [];
    let shared = 0;
    while (shared < Math.min(from.length, to.length) && sameSegment(from[shared], to[shared]))
      shared += 1;
    if (shared === from.length && shared === to.length) continue;
    const name = names.get(id) ?? "Robot";
    const added = to.slice(shared);
    const removed = from.slice(shared);
    if (removed.length === 0) {
      const last = added.at(-1)!;
      const extra = added.length > 1 && added.every((segment) => segment.kind === last.kind);
      return `${name}: ${describeSegment(last)}${extra ? ` ×${added.length}` : ""}`;
    }
    if (added.length === 0) {
      return to.length === 0
        ? `${name}: clear plan`
        : `${name}: remove ${removed.length} action${removed.length === 1 ? "" : "s"}`;
    }
    return `${name}: change orders`;
  }
  return null;
};
