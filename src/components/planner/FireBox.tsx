"use client";

import { Crosshair, Radar } from "lucide-react";

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
      <button type="button" data-active={aimActive} disabled={disabled} onClick={onAim}>
        <Crosshair size={15} aria-hidden="true" /> Aim &amp; Fire
      </button>
      <button type="button" disabled={disabled} onClick={onScan}>
        <Radar size={15} aria-hidden="true" /> Scan &amp; Fire
      </button>
      {disabled ? (
        <small>Deploy this robot to enable firing tools.</small>
      ) : (
        <small>Ctrl+Shift+click a tile for repeat Aim &amp; Fire.</small>
      )}
    </div>
  );
}
