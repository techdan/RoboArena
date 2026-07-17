"use client";

import { RefreshCw, WifiOff } from "lucide-react";

export function ConnectionOverlay({
  message,
  busy,
  onRetry,
}: {
  readonly message: string;
  readonly busy: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <div className="connection-overlay" role="alert">
      <WifiOff size={20} aria-hidden="true" />
      <div>
        <strong>Room service disconnected</strong>
        <p>{message}</p>
      </div>
      <button type="button" disabled={busy} onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" /> {busy ? "Reconnecting…" : "Reconnect"}
      </button>
    </div>
  );
}
