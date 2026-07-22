import { CheckCircle2, Clock3, Film, Trophy } from "lucide-react";
import type { MatchSnapshotMessage } from "../../lib/net/protocol";
import { matchFlowCopy } from "../../lib/presentation/matchFlow";

export function RoomStatus({
  status,
  turnNumber = 1,
}: {
  readonly status: MatchSnapshotMessage["status"];
  readonly turnNumber?: number;
}) {
  const copy = matchFlowCopy(status, turnNumber);
  const Icon =
    status === "planning"
      ? CheckCircle2
      : status === "waiting"
        ? Clock3
        : status === "turn-ready"
          ? Film
          : Trophy;
  return (
    <section className="match-room-status" data-status={status} role="status">
      <Icon size={20} aria-hidden="true" />
      <div>
        <strong>{copy.heading}</strong>
        <p>{copy.detail}</p>
      </div>
    </section>
  );
}
