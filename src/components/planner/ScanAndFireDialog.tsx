"use client";

import { Radar, X } from "lucide-react";
import { useState } from "react";
import type { WeaponId } from "../../engine/types";
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
  onConfirm,
  onCancel,
}: ScanAndFireDialogProps) {
  const defaults = defaultScanSettings(initialWeapon, remainingTicks);
  const [weapon, setWeapon] = useState(initialWeapon);
  const [maxDistance, setMaxDistance] = useState(initialMaxDistance ?? defaults.maxDistance);
  const [seconds, setSeconds] = useState(initialSeconds ?? defaults.seconds);
  const dialogRef = usePlannerDialogFocus<HTMLElement>(onCancel);
  return (
    <div
      className="planner-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="planner-dialog"
        role="dialog"
        aria-modal="true"
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
              onChange={(event) =>
                setSeconds(Math.max(1, Math.min(40, Number(event.currentTarget.value))))
              }
            />
          </label>
        </div>
        <div className="fire-preview">
          <p>
            Range and cone are deterministic. Hit score, cover, and sight strength are evaluated
            only against an authorized contact at each firing opportunity; the actual RNG roll is
            never shown here.
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
    </div>
  );
}
