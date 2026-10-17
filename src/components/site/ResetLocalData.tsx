"use client";

import { useState } from "react";
import { recentRooms, resetLocalGameData } from "../../lib/net/client";

/**
 * Clearing this browser's room seats cannot be undone, so the first click only
 * opens a confirmation that lists exactly what will be forgotten.
 */
export function ResetLocalData() {
  const [rooms, setRooms] = useState<readonly string[] | null>(null);
  if (rooms === null) {
    return (
      <button
        type="button"
        className="site-button"
        data-variant="ghost"
        onClick={() => setRooms(recentRooms())}
      >
        Clear saved game data on this device…
      </button>
    );
  }
  const roomCount = rooms.length === 1 ? "1 room" : `${rooms.length} rooms`;
  return (
    <div className="site-confirm" role="group" aria-labelledby="reset-local-data-title">
      <strong id="reset-local-data-title">Clear saved game data on this device?</strong>
      <ul>
        <li>
          {rooms.length === 0
            ? "Forgets any room seats saved in this browser."
            : `Forgets your seats in ${roomCount}: ${rooms.join(", ")}.`}
        </li>
        <li>Deletes unsent planner drafts.</li>
        <li>
          You will not be able to return to a match in progress from this device. Matches on the
          server are not changed.
        </li>
      </ul>
      <div className="site-confirm-actions">
        <button
          type="button"
          className="site-button"
          data-variant="danger"
          onClick={() => {
            resetLocalGameData();
            window.location.assign("/");
          }}
        >
          {rooms.length === 0 ? "Clear saved data" : `Clear ${roomCount} and drafts`}
        </button>
        <button
          type="button"
          className="site-button"
          data-variant="ghost"
          onClick={() => setRooms(null)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
