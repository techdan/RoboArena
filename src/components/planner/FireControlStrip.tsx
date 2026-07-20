"use client";

import { Crosshair, Radar, X } from "lucide-react";
import { TICKS_PER_SECOND } from "../../engine/constants";
import type { TileCoord, WeaponId } from "../../engine/types";
import { PLANNER_WEAPON_RANGE, WEAPON_LABELS } from "../../planner/firingHelpers";

interface SharedControlsProps {
  readonly weapon: WeaponId;
  readonly onCancel: () => void;
}

export interface AimFireControlsProps extends SharedControlsProps {
  readonly target: TileCoord | null;
  readonly shots: number;
  readonly maxShots: number;
  readonly firingIntervalTicks: number;
  readonly canReview: boolean;
  readonly onShotsChange: (shots: number) => void;
  readonly onReview: () => void;
}

/**
 * Compact Aim & Fire controls that take over the two entry buttons' slot in the
 * action strip: `⌖ target · fire time · shots · Review · ✕`. Cancel restores
 * the entry buttons; the strip height and every other group stay fixed.
 */
export function AimFireControls({
  weapon,
  target,
  shots,
  maxShots,
  firingIntervalTicks,
  canReview,
  onShotsChange,
  onCancel,
  onReview,
}: AimFireControlsProps) {
  const intervalSeconds = firingIntervalTicks / TICKS_PER_SECOND;
  const fireSeconds = shots * intervalSeconds;
  return (
    <div className="fire-inline" aria-label="Aim and Fire controls">
      <span className="fire-inline-mode" title={`Aim & Fire · ${WEAPON_LABELS[weapon]}`}>
        <Crosshair size={15} aria-hidden="true" />
      </span>
      <span className="fire-inline-target" aria-live="polite">
        {target === null ? "Choose tile" : `${target.x},${target.y}`}
      </span>
      <label className="fire-inline-number">
        <span>Fire</span>
        <input
          type="number"
          inputMode="decimal"
          name="aim-fire-seconds"
          autoComplete="off"
          min={intervalSeconds}
          max={maxShots * intervalSeconds}
          step={intervalSeconds}
          value={Number(fireSeconds.toFixed(3))}
          onChange={(event) =>
            onShotsChange(
              Math.max(
                1,
                Math.min(
                  maxShots,
                  Math.round(
                    (Number(event.currentTarget.value) * TICKS_PER_SECOND) / firingIntervalTicks,
                  ),
                ),
              ),
            )
          }
        />
      </label>
      <small className="fire-inline-shots">
        {shots} shot{shots === 1 ? "" : "s"}
      </small>
      <button
        type="button"
        className="fire-inline-primary"
        disabled={!canReview}
        onClick={onReview}
      >
        Review
      </button>
      <button
        type="button"
        className="fire-inline-cancel"
        aria-label="Cancel Aim & Fire"
        onClick={onCancel}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

export interface ScanFireControlsProps extends SharedControlsProps {
  readonly maxDistance: number;
  readonly seconds: number;
  readonly onDistanceChange: (distance: number) => void;
  readonly onSecondsChange: (seconds: number) => void;
  readonly onConfirm: () => void;
}

/**
 * Compact Scan & Fire controls that take over the entry buttons' slot:
 * `⌖ distance · seconds · Add · ✕`.
 */
export function ScanFireControls({
  weapon,
  maxDistance,
  seconds,
  onDistanceChange,
  onSecondsChange,
  onCancel,
  onConfirm,
}: ScanFireControlsProps) {
  return (
    <div className="fire-inline" aria-label="Scan and Fire controls">
      <span className="fire-inline-mode" title={`Scan & Fire · ${WEAPON_LABELS[weapon]}`}>
        <Radar size={15} aria-hidden="true" />
      </span>
      <label className="fire-inline-number">
        <span>Dist</span>
        <input
          type="number"
          inputMode="numeric"
          name="scan-maximum-distance"
          autoComplete="off"
          min={1}
          max={PLANNER_WEAPON_RANGE[weapon]}
          value={maxDistance}
          onChange={(event) =>
            onDistanceChange(
              Math.max(
                1,
                Math.min(PLANNER_WEAPON_RANGE[weapon], Number(event.currentTarget.value)),
              ),
            )
          }
        />
      </label>
      <label className="fire-inline-number">
        <span>Secs</span>
        <input
          type="number"
          inputMode="numeric"
          name="scan-seconds"
          autoComplete="off"
          min={1}
          max={40}
          value={seconds}
          onChange={(event) =>
            onSecondsChange(Math.max(1, Math.min(40, Number(event.currentTarget.value))))
          }
        />
      </label>
      <button type="button" className="fire-inline-primary" onClick={onConfirm}>
        Add
      </button>
      <button
        type="button"
        className="fire-inline-cancel"
        aria-label="Cancel Scan & Fire"
        onClick={onCancel}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
