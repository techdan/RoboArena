/** Versioned, failure-safe browser persistence for private planner drafts. */

import type { RobotCommandSegment, TurnOrders } from "../engine/types";

const DRAFT_VERSION = 1 as const;

export interface PlannerDraftEnvelope {
  readonly version: typeof DRAFT_VERSION;
  readonly authoritativeRevision: string;
  readonly orders: TurnOrders;
  readonly conflictOrders?: TurnOrders;
}

export type PlannerDraftLoad =
  | { readonly kind: "none" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "corrupt" }
  | { readonly kind: "restored"; readonly envelope: PlannerDraftEnvelope };

export interface PlannerDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const plannerDraftKey = (matchId: string, teamId: string): string =>
  `roboarena.planner-draft.v${DRAFT_VERSION}.${matchId}.${teamId}`;

export const legacyPlannerDraftKey = (matchId: string, teamId: string): string =>
  `roboarena.planner-draft.${matchId}.${teamId}`;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isInteger = (value: unknown): value is number => Number.isInteger(value);

const isTile = (value: unknown): boolean =>
  isObject(value) && isInteger(value.x) && isInteger(value.y);

const isSegment = (value: unknown): value is RobotCommandSegment => {
  if (!isObject(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "deploy":
      return isTile(value.to);
    case "move":
      return (
        (value.posture === "upright" ||
          value.posture === "ducking" ||
          value.posture === "crouching") &&
        Array.isArray(value.path) &&
        value.path.length > 0 &&
        value.path.every(
          (step) =>
            isObject(step) && isTile(step.to) && (step.via === undefined || isTile(step.via)),
        )
      );
    case "set-posture":
      return (
        value.posture === "upright" || value.posture === "ducking" || value.posture === "crouching"
      );
    case "set-scan-direction":
      return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].includes(String(value.heading));
    case "aim-and-fire":
      return (
        isTile(value.target) &&
        typeof value.weapon === "string" &&
        typeof value.repeat === "boolean"
      );
    case "scan-and-fire":
      return (
        typeof value.weapon === "string" &&
        isInteger(value.maxDistance) &&
        value.maxDistance >= 0 &&
        isInteger(value.seconds) &&
        value.seconds > 0
      );
    default:
      return false;
  }
};

export const isTurnOrders = (value: unknown): value is TurnOrders => {
  if (
    !isObject(value) ||
    !isInteger(value.turnNumber) ||
    value.turnNumber < 1 ||
    !Array.isArray(value.timelines)
  ) {
    return false;
  }
  const robotIds = new Set<string>();
  return value.timelines.every((timeline) => {
    if (
      !isObject(timeline) ||
      typeof timeline.robotId !== "string" ||
      robotIds.has(timeline.robotId) ||
      !Array.isArray(timeline.segments) ||
      !timeline.segments.every(isSegment)
    ) {
      return false;
    }
    robotIds.add(timeline.robotId);
    return true;
  });
};

const isEnvelope = (value: unknown): value is PlannerDraftEnvelope =>
  isObject(value) &&
  value.version === DRAFT_VERSION &&
  typeof value.authoritativeRevision === "string" &&
  isTurnOrders(value.orders) &&
  (value.conflictOrders === undefined || isTurnOrders(value.conflictOrders));

export const loadPlannerDraft = (
  storage: PlannerDraftStorage,
  matchId: string,
  teamId: string,
  fallbackRevision: string,
): PlannerDraftLoad => {
  let raw: string | null;
  try {
    raw = storage.getItem(plannerDraftKey(matchId, teamId));
    if (raw === null) raw = storage.getItem(legacyPlannerDraftKey(matchId, teamId));
  } catch {
    return { kind: "unavailable" };
  }
  if (raw === null) return { kind: "none" };
  try {
    const value: unknown = JSON.parse(raw);
    if (isEnvelope(value)) return { kind: "restored", envelope: value };
    if (isTurnOrders(value)) {
      return {
        kind: "restored",
        envelope: {
          version: DRAFT_VERSION,
          authoritativeRevision: fallbackRevision,
          orders: value,
        },
      };
    }
    return { kind: "corrupt" };
  } catch {
    return { kind: "corrupt" };
  }
};

export const savePlannerDraft = (
  storage: PlannerDraftStorage,
  matchId: string,
  teamId: string,
  envelope: Omit<PlannerDraftEnvelope, "version">,
): boolean => {
  try {
    storage.setItem(
      plannerDraftKey(matchId, teamId),
      JSON.stringify({ version: DRAFT_VERSION, ...envelope }),
    );
    return true;
  } catch {
    return false;
  }
};
