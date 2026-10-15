"use client";

import { ShieldCheck } from "lucide-react";
import { matchFlowCopy } from "../../lib/presentation/matchFlow";
import type { MatchSnapshotMessage } from "../../lib/net/protocol";
import { FieldGuideButton } from "../help/HelpProvider";
import { RoomStatus } from "./RoomStatus";

export function MatchFlowHeader({
  roomCode,
  matchId,
  team,
  turnNumber,
  status,
  spectating = false,
}: {
  readonly roomCode: string;
  readonly matchId: string;
  readonly team: { readonly name: string; readonly color: string };
  readonly turnNumber: number;
  readonly status: MatchSnapshotMessage["status"];
  readonly spectating?: boolean;
}) {
  const copy = matchFlowCopy(status, turnNumber);
  return (
    <header className="match-flow-header">
      <div className="match-flow-context">
        <p className="eyebrow">Room {roomCode}</p>
        <div className="match-flow-identity">
          <span className={`team-swatch team-swatch-${team.color}`} aria-hidden="true" />
          <strong>{team.name}</strong>
          <span>Team</span>
          <span aria-hidden="true">·</span>
          <span>{copy.eyebrow}</span>
          <span aria-hidden="true">·</span>
          <span className="match-id" title={matchId}>
            Match {matchId}
          </span>
        </div>
      </div>
      <div className="match-flow-saved-state">
        <ShieldCheck size={15} aria-hidden="true" /> Room state saved
      </div>
      <FieldGuideButton />
      <RoomStatus status={status} turnNumber={turnNumber} spectating={spectating} />
    </header>
  );
}
