"use client";

import { Flag } from "lucide-react";
import { useState } from "react";

/**
 * Two-step resign affordance. Resigning is irreversible — it forfeits the match
 * for good — so the first click only arms an explicit confirm/cancel choice.
 */
export function ResignControl({
  onResign,
  disabled = false,
}: {
  readonly onResign: () => void;
  readonly disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span
        className="inline-flex items-center gap-2 text-xs"
        role="group"
        aria-label="Confirm resignation"
      >
        <span className="font-bold text-red-200">Resign for good?</span>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-400/60 bg-red-500/20 px-3 py-1.5 font-bold text-red-100 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled}
          onClick={() => {
            setConfirming(false);
            onResign();
          }}
        >
          Confirm resign
        </button>
        <button
          type="button"
          className="cursor-pointer rounded-lg border border-white/15 px-3 py-1.5 font-bold text-white/60 transition hover:border-white/30 hover:text-white/80"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-200 transition hover:border-red-400/60 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={() => setConfirming(true)}
    >
      <Flag size={14} aria-hidden="true" /> Resign
    </button>
  );
}
