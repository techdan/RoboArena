"use client";

import { CheckCircle2, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";

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
    <div className="connection-overlay" data-outcome={outcome} role={resumed ? "status" : "alert"}>
      <Icon size={20} aria-hidden="true" />
      <div>
        <strong>
          {resumed
            ? "Room state resumed"
            : incompatible
              ? "Incompatible room protocol"
              : "Reconnecting to room service"}
        </strong>
        <p>{message}</p>
      </div>
      {resumed ? null : (
        <button type="button" disabled={busy} onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" /> {busy ? "Reconnecting…" : "Reconnect"}
        </button>
      )}
    </div>
  );
}
