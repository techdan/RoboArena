"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { MatchSnapshotMessage } from "../../lib/net/protocol";
import { FieldGuideButton } from "../help/HelpProvider";

/** Slim match bar: who you are, which room, which turn, and that the server holds the state. */
export function MatchFlowHeader({
  roomCode,
  matchId,
  team,
  turnNumber,
  status,
  children,
}: {
  readonly roomCode: string;
  readonly matchId: string;
  readonly team: { readonly name: string; readonly color: string };
  readonly turnNumber: number;
  readonly status: MatchSnapshotMessage["status"];
  /** Extra controls for this phase, such as the rewatch reel. */
  readonly children?: ReactNode;
}) {
  const turn = String(turnNumber).padStart(2, "0");
  return (
    <header className="site-matchbar">
      <Link href="/" className="site-wordmark" aria-label="RoboArena home">
        <span className="site-wordmark-glyph" aria-hidden="true">
          RA
        </span>
      </Link>
      <span className="site-matchbar-team" data-team={team.color}>
        <span className="site-lamp" aria-hidden="true" />
        {team.name}
      </span>
      <span className="site-matchbar-room">Room {roomCode}</span>
      {status === "finished" ? null : (
        <span className="site-turnplate" role="img" aria-label={`Turn ${turnNumber}`}>
          <span aria-hidden="true">T</span>
          {turn.split("").map((digit, index) => (
            <span key={index} aria-hidden="true">
              {digit}
            </span>
          ))}
        </span>
      )}
      {children}
      <span className="site-matchbar-saved" title={`Match ${matchId}`}>
        <ShieldCheck size={14} aria-hidden="true" /> Room state saved
      </span>
      <FieldGuideButton />
    </header>
  );
}
