import type { ParticipantResolutionEvent } from "../net/protocol";

export type EventCategory = "combat" | "movement" | "contacts" | "system";

export interface ExplainedEvent {
  readonly key: string;
  readonly tick: number;
  readonly category: EventCategory;
  readonly title: string;
  readonly detail: string;
}

const missReason: Readonly<
  Record<Extract<ParticipantResolutionEvent, { readonly kind: "shot-missed" }>["reason"], string>
> = {
  "out-of-range": "The target tile was beyond the weapon’s range.",
  "angle-blocked": "The target was outside the active scan gate.",
  "sight-blocked": "Solid terrain blocked the shot’s line of sight.",
  "hit-roll": "The deterministic hit roll did not clear the computed score threshold.",
  "no-target": "No eligible robot occupied the targeted tile at the firing boundary.",
};

export const explainEvent = (event: ParticipantResolutionEvent): ExplainedEvent | null => {
  const base = { key: `${event.tick}:${event.seq}`, tick: event.tick };
  switch (event.kind) {
    case "deployed":
      return {
        ...base,
        category: "movement",
        title: "Robot deployed",
        detail: `${event.robotId} entered at ${event.to.x},${event.to.y}.`,
      };
    case "move-step":
      return {
        ...base,
        category: "movement",
        title: "Movement",
        detail: `${event.robotId} reached ${event.to.x},${event.to.y}.`,
      };
    case "posture-changed":
      return {
        ...base,
        category: "movement",
        title: "Posture changed",
        detail: `${event.robotId} set ${event.posture} posture.`,
      };
    case "scan-rotated":
      return {
        ...base,
        category: "movement",
        title: "Sensor rotated",
        detail: `${event.robotId} faced ${event.heading}.`,
      };
    case "enemy-spotted":
      return {
        ...base,
        category: "contacts",
        title: "Contact spotted",
        detail: `${event.enemyId} became visible at ${event.at.x},${event.at.y}.`,
      };
    case "enemy-lost":
      return {
        ...base,
        category: "contacts",
        title: "Contact lost",
        detail: `${event.enemyId} was last seen near ${event.lastSeenAt.x},${event.lastSeenAt.y}.`,
      };
    case "last-known-marker":
      return {
        ...base,
        category: "contacts",
        title: "Last known position",
        detail: `A contact marker was recorded at ${event.at.x},${event.at.y}.`,
      };
    case "scan-target-acquired":
      return {
        ...base,
        category: "combat",
        title: "Target acquired",
        detail: `${event.shooterId} acquired ${event.targetId} at distance ${event.distance}.`,
      };
    case "fired":
      return {
        ...base,
        category: "combat",
        title: `${event.fireMode === "scan" ? "Scan" : "Aim"} fire`,
        detail: `${event.shooterId} fired ${event.weapon} at tile ${event.target.x},${event.target.y}.`,
      };
    case "shot-missed":
      return {
        ...base,
        category: "combat",
        title: "Shot missed",
        detail: `${missReason[event.reason]}${event.score === undefined ? "" : ` Computed score: ${event.score}.`}`,
      };
    case "damaged": {
      const source = event.sourceId === undefined ? "An unseen source" : event.sourceId;
      const cause =
        event.damageKind === "direct"
          ? `${source} dealt ${event.damage} direct damage${event.score === undefined ? "" : ` at score ${event.score}`}.`
          : `${source} dealt ${event.damage} blast damage${event.radius === undefined ? "" : ` at radius ${event.radius}`}.`;
      return {
        ...base,
        category: "combat",
        title: "Damage",
        detail: `${event.targetId}: ${cause}`,
      };
    }
    case "destroyed":
      return {
        ...base,
        category: "combat",
        title: "Robot destroyed",
        detail: `${event.robotId} reached zero armor.`,
      };
    case "command-aborted":
      return {
        ...base,
        category: "system",
        title: "Command aborted",
        detail: `${event.robotId} could not continue because it was destroyed.`,
      };
    default:
      return null;
  }
};

export const explainEvents = (
  events: readonly ParticipantResolutionEvent[],
): readonly ExplainedEvent[] =>
  events.flatMap((event) => {
    const explained = explainEvent(event);
    return explained === null ? [] : [explained];
  });
