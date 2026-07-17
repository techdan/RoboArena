"use client";

import { Download } from "lucide-react";
import type { ParticipantTurnResult } from "../../lib/net/protocol";

export function ObservedTurnExport({ turn }: { readonly turn: ParticipantTurnResult }) {
  const download = () => {
    const payload = JSON.stringify(
      {
        format: "roboarena-observed-turn-v1",
        turnNumber: turn.turnNumber,
        initialState: turn.initialState,
        events: turn.events,
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `roboarena-turn-${turn.turnNumber}-observed.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" className="secondary-action" onClick={download}>
      <Download size={15} aria-hidden="true" /> Export observed turn
    </button>
  );
}
