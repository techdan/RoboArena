"use client";

import { Clapperboard } from "lucide-react";
import { useEffect, useState } from "react";
import { listArchivedTurns } from "../../lib/replays/turnArchive";

/**
 * Buttons for rewatching earlier turns as separate movies. The latest turn
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
  /** The turn the page plays by default; listed last as "Latest". */
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
    <nav className="turn-reel" aria-label="Rewatch earlier turns">
      <span className="turn-reel-label">
        <Clapperboard aria-hidden="true" size={14} /> Rewatch
      </span>
      {turns.map((turn) => (
        <button
          key={turn}
          type="button"
          className="turn-reel-button"
          aria-pressed={selectedTurn === turn}
          onClick={() => onSelect(turn)}
        >
          Turn {turn}
        </button>
      ))}
      {currentTurn !== null ? (
        <button
          type="button"
          className="turn-reel-button"
          aria-pressed={selectedTurn === null}
          onClick={() => onSelect(null)}
        >
          Turn {currentTurn} · Latest
        </button>
      ) : null}
    </nav>
  );
}
