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
    <section className="fire-control-strip" aria-label="Aim and Fire controls">
      <div className="fire-strip-mode">
        <Crosshair size={16} aria-hidden="true" />
        <span>
          <strong>Aim &amp; Fire</strong>
          <small>{WEAPON_LABELS[weapon]}</small>
        </span>
      </div>
      <div className="fire-strip-target" aria-live="polite">
        <span>Target</span>
        <strong>{target === null ? "Choose tile" : `${target.x},${target.y}`}</strong>
      </div>
      <label className="fire-strip-number">
        <span>Fire time</span>
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
        <small>
          {shots} shot{shots === 1 ? "" : "s"}
        </small>
      </label>
      <div className="fire-strip-actions">
        <button type="button" className="fire-strip-cancel" onClick={onCancel}>
          <X size={15} aria-hidden="true" /> Cancel
        </button>
        <button
          type="button"
          className="fire-strip-primary"
          disabled={!canReview}
          onClick={onReview}
        >
          Review Shot
        </button>
      </div>
    </section>
  );
}

export interface ScanFireControlsProps extends SharedControlsProps {
  readonly maxDistance: number;
  readonly seconds: number;
  readonly onDistanceChange: (distance: number) => void;
  readonly onSecondsChange: (seconds: number) => void;
  readonly onConfirm: () => void;
}

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
    <section className="fire-control-strip" aria-label="Scan and Fire controls">
      <div className="fire-strip-mode">
        <Radar size={16} aria-hidden="true" />
        <span>
          <strong>Scan &amp; Fire</strong>
          <small>{WEAPON_LABELS[weapon]}</small>
        </span>
      </div>
      <label className="fire-strip-number">
        <span>Distance</span>
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
      <label className="fire-strip-number">
        <span>Seconds</span>
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
      <div className="fire-strip-actions">
        <button type="button" className="fire-strip-cancel" onClick={onCancel}>
          <X size={15} aria-hidden="true" /> Cancel
        </button>
        <button type="button" className="fire-strip-primary" onClick={onConfirm}>
          Add Scan &amp; Fire
        </button>
      </div>
    </section>
  );
}
