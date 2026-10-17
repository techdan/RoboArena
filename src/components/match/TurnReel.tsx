"use client";

import { useEffect, useState } from "react";
import { listArchivedTurns } from "../../lib/replays/turnArchive";

/**
 * Chips for rewatching earlier turns as separate movies. The latest turn
 * stays the default; this only lists turns this browser has already received.
 */
export function TurnReel({
  matchId,
  currentTurn,
  selectedTurn,
  onSelect,
  refreshKey,
}: {
  readonly matchId: string;
  /** The turn the page plays by default; listed last as "new". */
  readonly currentTurn: number | null;
  readonly selectedTurn: number | null;
  readonly onSelect: (turnNumber: number | null) => void;
  readonly refreshKey?: string;
}) {
  const [turns, setTurns] = useState<number[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listArchivedTurns(matchId).then((list) => {
      if (!cancelled) setTurns(list.filter((turn) => turn !== currentTurn));
    });
    return () => {
      cancelled = true;
    };
  }, [matchId, currentTurn, refreshKey]);
  if (turns.length === 0) return null;
  return (
    <nav className="site-reel" aria-label="Rewatch earlier turns">
      <span className="site-label">Rewatch</span>
      {turns.map((turn) => (
        <button
          key={turn}
          type="button"
          className="site-reel-chip"
          aria-pressed={selectedTurn === turn}
          aria-label={`Turn ${turn}`}
          onClick={() => onSelect(turn)}
        >
          T{turn}
        </button>
      ))}
      {currentTurn !== null ? (
        <button
          type="button"
          className="site-reel-chip"
          aria-pressed={selectedTurn === null}
          aria-label={`Turn ${currentTurn}, latest`}
          onClick={() => onSelect(null)}
        >
          T{currentTurn} · new
        </button>
      ) : null}
    </nav>
  );
}
