"use client";

import { CheckCircle2, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";

/** Connection toast pinned to the top of match pages. */
export function ConnectionOverlay({
  outcome,
  message,
  busy,
  onRetry,
}: {
  readonly outcome: "retrying" | "resumed" | "incompatible-protocol";
  readonly message: string;
  readonly busy: boolean;
  readonly onRetry: () => void;
}) {
  const resumed = outcome === "resumed";
  const incompatible = outcome === "incompatible-protocol";
  const Icon = resumed ? CheckCircle2 : incompatible ? ShieldAlert : WifiOff;
  return (
    <div className="site-toast" data-outcome={outcome} role={resumed ? "status" : "alert"}>
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>
          {resumed
            ? "Reconnected"
            : incompatible
              ? "This page needs an update"
              : "Reconnecting to the game server"}
        </strong>
        <p>{message}</p>
      </div>
      {resumed ? null : (
        <button type="button" className="site-button" disabled={busy} onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" /> {busy ? "Reconnecting…" : "Reconnect"}
        </button>
      )}
    </div>
  );
}
