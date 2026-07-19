"use client";

import type { CSSProperties } from "react";
import type { Posture } from "../../engine/types";
import type { PlannerTargetingOverlay } from "./ArenaCanvas";
import type { HitChanceBand } from "../../planner/firingHelpers";
import { TARGETING_PALETTE, type TargetingCategory } from "../../planner/targetingPalette";

const targetingSwatchStyle = (category: TargetingCategory): CSSProperties => {
  const { css, pattern } = TARGETING_PALETTE[category];
  if (pattern === "hatch")
    return { background: `repeating-linear-gradient(135deg, ${css} 0 3px, #0b0b0b 3px 6px)` };
  if (pattern === "reverse-hatch")
    return { background: `repeating-linear-gradient(45deg, ${css} 0 3px, #0b0b0b 3px 6px)` };
  return { background: css };
};

const BANDS: readonly [HitChanceBand, string][] = [
  ["excellent", "Excellent 75–94%"],
  ["good", "Good 50–74%"],
  ["risky", "Risky 25–49%"],
  ["poor", "Poor 1–24%"],
  ["zero", "0%"],
];

const BLOCKED: readonly [TargetingCategory, string][] = [
  ["sight-blocked", "Wall"],
  ["angle-blocked", "Behind cone"],
  ["out-of-range", "Out of range"],
];

const POSTURES: readonly Posture[] = ["upright", "ducking", "crouching"];

export function TargetingLegend({
  overlay,
  onAssumedPosture,
  onBlockBoardHover,
}: {
  readonly overlay: PlannerTargetingOverlay;
  readonly onAssumedPosture: (posture: Posture) => void;
  readonly onBlockBoardHover: () => void;
}) {
  return (
    <section
      className="targeting-map-tools"
      aria-label="Targeting overlay legend"
      onPointerEnter={(event) => {
        event.stopPropagation();
        onBlockBoardHover();
      }}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <fieldset className="targeting-map-posture">
        <legend>Preview target posture</legend>
        <div>
          {POSTURES.map((posture) => (
            <button
              type="button"
              key={posture}
              aria-pressed={posture === overlay.assumedPosture}
              onClick={() => onAssumedPosture(posture)}
            >
              {posture}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="targeting-map-legend">
        <strong>{overlay.mode === "aim" ? "Fixed tile" : "Auto-acquire"}</strong>
        <span>{overlay.maxDistance} tiles</span>
        {overlay.resolution === "blast" ? (
          <span>Legal impact and blast coverage</span>
        ) : (
          <>
            {BANDS.map(([band, label]) => (
              <span key={band}>
                <i style={targetingSwatchStyle(band)} /> {label}
              </span>
            ))}
            {BLOCKED.map(([status, label]) => (
              <span key={status}>
                <i style={targetingSwatchStyle(status)} /> {label}
              </span>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
