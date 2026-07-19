"use client";

import { Radar, X } from "lucide-react";
import { useState } from "react";
import { WEAPON_TIMING } from "../../engine/constants";
import type { WeaponId } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import {
  defaultScanSettings,
  PLANNER_WEAPON_RANGE,
  WEAPON_LABELS,
} from "../../planner/firingHelpers";
import { usePlannerDialogFocus } from "./usePlannerDialogFocus";

export interface ScanAndFireDialogProps {
  readonly weapons: readonly WeaponId[];
  readonly initialWeapon: WeaponId;
  readonly initialMaxDistance?: number;
  readonly initialSeconds?: number;
  readonly remainingTicks: number;
  readonly onDistanceChange: (distance: number) => void;
  readonly onSecondsChange?: (seconds: number) => void;
  readonly onWeaponChange?: (weapon: WeaponId) => void;
  readonly onConfirm: (weapon: WeaponId, maxDistance: number, seconds: number) => void;
  readonly onCancel: () => void;
}

export function ScanAndFireDialog({
  weapons,
  initialWeapon,
  initialMaxDistance,
  initialSeconds,
  remainingTicks,
  onDistanceChange,
  onSecondsChange,
  onWeaponChange,
  onConfirm,
  onCancel,
}: ScanAndFireDialogProps) {
  const defaults = defaultScanSettings(initialWeapon, remainingTicks);
  const [weapon, setWeapon] = useState(initialWeapon);
  const [maxDistance, setMaxDistance] = useState(initialMaxDistance ?? defaults.maxDistance);
  const [seconds, setSeconds] = useState(initialSeconds ?? defaults.seconds);
  const dialogRef = usePlannerDialogFocus<HTMLElement>(onCancel, { modal: false });
  return (
    <section
      ref={dialogRef}
      className="planner-dialog planner-dialog--docked"
      role="dialog"
      aria-modal="false"
      aria-labelledby="scan-fire-title"
      tabIndex={-1}
    >
      <header>
        <div>
          <p className="eyebrow">Automatic acquisition</p>
          <h2 id="scan-fire-title">Scan &amp; Fire</h2>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close Scan and Fire dialog">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="scan-explanation">
        <Radar size={18} aria-hidden="true" />
        <p>
          Watch the current inclusive forward semicircle. At each firing opportunity, the server
          acquires the nearest eligible visible enemy within this cap.
        </p>
      </div>
      <label className="setup-label">
        Weapon
        <select
          className="setup-input"
          name="scan-weapon"
          autoComplete="off"
          data-dialog-initial-focus
          value={weapon}
          onChange={(event) => {
            const next = event.currentTarget.value as WeaponId;
            const distance = PLANNER_WEAPON_RANGE[next];
            setWeapon(next);
            onWeaponChange?.(next);
            setMaxDistance(distance);
            onDistanceChange(distance);
          }}
        >
          {weapons.map((id) => (
            <option key={id} value={id}>
              {WEAPON_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
      <div className="scan-fields">
        <label className="setup-label">
          Maximum Distance
          <input
            className="setup-input"
            aria-label="Maximum Distance"
            name="scan-maximum-distance"
            autoComplete="off"
            type="number"
            inputMode="numeric"
            min={1}
            max={PLANNER_WEAPON_RANGE[weapon]}
            value={maxDistance}
            onChange={(event) => {
              const value = Math.max(
                1,
                Math.min(PLANNER_WEAPON_RANGE[weapon], Number(event.currentTarget.value)),
              );
              setMaxDistance(value);
              onDistanceChange(value);
            }}
          />
        </label>
        <label className="setup-label">
          Seconds
          <input
            className="setup-input"
            aria-label="Seconds"
            name="scan-seconds"
            autoComplete="off"
            type="number"
            inputMode="numeric"
            min={1}
            max={40}
            value={seconds}
            onChange={(event) => {
              const value = Math.max(1, Math.min(40, Number(event.currentTarget.value)));
              setSeconds(value);
              onSecondsChange?.(value);
            }}
          />
        </label>
      </div>
      <div className="fire-preview">
        <p>
          Shot Analysis is open beside the board. Hover or keyboard-focus a tile to inspect it and
          change the assumed target posture there. Checks immediately, then every{" "}
          {formatGameTime(WEAPON_TIMING[weapon].scanFiringIntervalTicks)}
          {` for ${seconds}s`}. Range and cone are deterministic. Estimated hit chance includes
          cover and sight strength for an authorized contact; the actual RNG roll is never shown.
        </p>
      </div>
      <footer>
        <button type="button" className="secondary-action" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-action"
          onClick={() => onConfirm(weapon, maxDistance, seconds)}
        >
          Add Scan &amp; Fire
        </button>
      </footer>
    </section>
  );
}
