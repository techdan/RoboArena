import type { ParticipantResolutionEvent } from "../../lib/net/protocol";

const explain = (event: ParticipantResolutionEvent): string | null => {
  switch (event.kind) {
    case "enemy-spotted":
      return `Contact spotted at ${event.at.x},${event.at.y}.`;
    case "enemy-lost":
      return `Contact lost near ${event.lastSeenAt.x},${event.lastSeenAt.y}.`;
    case "fired":
      return `${event.shooterId} fired ${event.weapon} at ${event.target.x},${event.target.y}.`;
    case "shot-missed":
      return `${event.shooterId} missed: ${event.reason.replaceAll("-", " ")}.`;
    case "damaged":
      return `${event.targetId} took ${event.damage} ${event.damageKind} damage.`;
    case "destroyed":
      return `${event.robotId} was destroyed.`;
    case "last-known-marker":
      return `Last known contact recorded at ${event.at.x},${event.at.y}.`;
    default:
      return null;
  }
};

export function TurnExplanation({
  events,
}: {
  readonly events: readonly ParticipantResolutionEvent[];
}) {
  const lines = events.flatMap((event) => {
    const text = explain(event);
    return text === null ? [] : [{ key: `${event.tick}:${event.seq}`, tick: event.tick, text }];
  });
  return (
    <section className="match-panel turn-explanation">
      <p className="eyebrow">Authorized turn log</p>
      <h2>What happened</h2>
      {lines.length === 0 ? (
        <p>No observable combat events occurred this turn.</p>
      ) : (
        <ol>
          {lines.slice(0, 20).map((line) => (
            <li key={line.key}>
              <time>{line.tick}t</time> {line.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
