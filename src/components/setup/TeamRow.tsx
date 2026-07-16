"use client";

import { Crown, Radio, ShieldCheck } from "lucide-react";
import type { PublicPlayer } from "../../lib/net/protocol";

export function TeamRow({
  player,
  isSelf,
}: {
  readonly player: PublicPlayer;
  readonly isSelf: boolean;
}) {
  return (
    <li className="team-row" data-self={isSelf ? "true" : "false"}>
      <span className={`team-swatch team-swatch-${player.color}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-bold">{player.name}</span>
          {player.isHost ? <Crown className="size-3.5 text-amber-300" aria-label="Host" /> : null}
          {isSelf ? <span className="you-label">You</span> : null}
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-white/35">
          <Radio className="size-3" aria-hidden="true" />
          {player.connected ? "Connected" : "Away — seat retained"}
        </p>
      </div>
      <div className="text-right">
        {player.ready ? (
          <span className="ready-label">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Ready
          </span>
        ) : (
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-white/30">
            Planning
          </span>
        )}
        {player.side === undefined ? null : (
          <p className="mt-1 font-mono text-[10px] text-white/35">
            SIDE {player.side} · HOME {player.homeSlot! + 1}
          </p>
        )}
      </div>
    </li>
  );
}
