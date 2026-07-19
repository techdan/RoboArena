"use client";

import { Crosshair, Radar } from "lucide-react";
import { HelpButton } from "../help/HelpProvider";

export function FireBox({
  disabled,
  aimActive,
  onAim,
  onScan,
}: {
  readonly disabled: boolean;
  readonly aimActive: boolean;
  readonly onAim: () => void;
  readonly onScan: () => void;
}) {
  return (
    <div className="fire-box">
      <div className="action-with-help">
        <button
          type="button"
          aria-pressed={aimActive}
          data-active={aimActive}
          disabled={disabled}
          onClick={onAim}
        >
          <Crosshair size={15} aria-hidden="true" />
          {aimActive ? "Cancel Aim & Fire" : "Aim & Fire"}
        </button>
        <HelpButton topic="action:aim-fire" label="Aim and Fire" />
      </div>
      <div className="action-with-help">
        <button type="button" disabled={disabled} onClick={onScan}>
          <Radar size={15} aria-hidden="true" /> Scan &amp; Fire
        </button>
        <HelpButton topic="action:scan-fire" label="Scan and Fire" />
      </div>
      {disabled ? (
        <small>Deploy this robot to enable firing tools.</small>
      ) : aimActive ? (
        <small>Choose a target tile, or press this button again to cancel.</small>
      ) : (
        <small>Use Repeat in the firing dialog; Ctrl+Shift+click remains a desktop shortcut.</small>
      )}
    </div>
  );
}
