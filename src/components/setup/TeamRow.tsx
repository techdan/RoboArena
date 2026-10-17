"use client";

import { Crown, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import type { PublicPlayer } from "../../lib/net/protocol";
import { HOME_CORNER_LABELS } from "../../lib/setup/validate";

/** One claimed seat in the lobby lineup, lit in the team's colour. */
export function TeamRow({
  player,
  isSelf,
  editing = false,
  onEdit,
  children,
}: {
  readonly player: PublicPlayer;
  readonly isSelf: boolean;
  readonly editing?: boolean;
  /** Offered on the player's own seat; disabled while they are marked ready. */
  readonly onEdit?: () => void;
  /** The inline team editor, shown instead of the seat details while editing. */
  readonly children?: ReactNode;
}) {
  const corner =
    player.homeSlot === undefined
      ? "No corner yet"
      : player.side === undefined
        ? `Home ${HOME_CORNER_LABELS[player.homeSlot]}`
        : `Home ${HOME_CORNER_LABELS[player.homeSlot]} · Side ${player.side}`;
  return (
    <li className="site-seat" data-team={player.color} data-self={isSelf ? "true" : "false"}>
      <div className="site-seat-name">
        <span className="site-seat-title">{player.name}</span>
        {player.isHost ? <Crown className="site-seat-host" size={15} aria-label="Host" /> : null}
        {isSelf ? <span className="site-seat-you">You</span> : null}
      </div>
      {editing ? (
        children
      ) : (
        <>
          <div className="site-seat-row">
            <span>{corner}</span>
            {isSelf && onEdit !== undefined ? (
              <button
                type="button"
                className="site-seat-edit"
                onClick={onEdit}
                disabled={player.ready}
                title={player.ready ? "Click Ready to make changes" : undefined}
              >
                <Pencil size={12} aria-hidden="true" /> Edit
              </button>
            ) : null}
          </div>
          <div className="site-seat-row">
            <span>{player.connected ? "Connected" : "Away · seat kept"}</span>
            {player.ready ? (
              <span className="site-pill" data-tone="go">
                Ready
              </span>
            ) : (
              <span className="site-pill" data-tone="rail">
                Not ready
              </span>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/** An unclaimed seat: an invitation, not an empty slot. */
export function OpenSeat({ code, first }: { readonly code: string; readonly first: boolean }) {
  return (
    <li className="site-seat" data-open="true">
      <strong>Open seat</strong>
      <span>{first ? `Share code ${code}` : "Optional · 2–4 teams"}</span>
    </li>
  );
}
