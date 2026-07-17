import { CheckCircle2, Clock3, Film, Trophy } from "lucide-react";
import type { MatchSnapshotMessage } from "../../lib/net/protocol";

const COPY = {
  planning: ["Your turn", "Program privately, save if desired, then lock when ready."],
  waiting: ["Orders locked", "You can leave safely. Resolution begins when everyone locks."],
  "turn-ready": ["Turn ready", "Your authorized movie is ready on this device."],
  finished: ["Match complete", "Final Ceremony scores are ready."],
} as const;

export function RoomStatus({ status }: { readonly status: MatchSnapshotMessage["status"] }) {
  const [title, detail] = COPY[status];
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
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </section>
  );
}
