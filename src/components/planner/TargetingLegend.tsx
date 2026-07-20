"use client";

import { ChevronDown, PanelBottomOpen } from "lucide-react";
import {
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import type { Posture } from "../../engine/types";
import type { PlannerTargetingOverlay } from "./ArenaCanvas";
import type { HitChanceBand } from "../../planner/firingHelpers";
import { TARGETING_PALETTE, type TargetingCategory } from "../../planner/targetingPalette";
import { PostureIcon } from "./PostureIcon";

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
  const [collapsed, setCollapsed] = useState(false);
  // The whole tool set stops board hover/clicks only under its own (now
  // smaller) bounds; every board gesture is swallowed here so a tap on the
  // legend never drops a command on the tile beneath it.
  const swallow = {
    onPointerEnter: (event: PointerEvent) => {
      event.stopPropagation();
      onBlockBoardHover();
    },
    onPointerMove: (event: PointerEvent) => event.stopPropagation(),
    onPointerDown: (event: PointerEvent) => event.stopPropagation(),
    onPointerUp: (event: PointerEvent) => event.stopPropagation(),
    onPointerCancel: (event: PointerEvent) => event.stopPropagation(),
    onClick: (event: MouseEvent) => event.stopPropagation(),
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    },
    onWheel: (event: WheelEvent) => event.stopPropagation(),
    onKeyDown: (event: KeyboardEvent) => event.stopPropagation(),
  };

  if (collapsed)
    return (
      <button
        type="button"
        className="targeting-map-pill"
        aria-label="Show targeting legend"
        {...swallow}
        onClick={(event) => {
          event.stopPropagation();
          setCollapsed(false);
        }}
      >
        <PanelBottomOpen size={14} aria-hidden="true" /> Legend
      </button>
    );

  return (
    <section className="targeting-map-tools" aria-label="Targeting overlay legend" {...swallow}>
      <fieldset className="targeting-map-posture">
        <legend>Posture</legend>
        <div>
          {POSTURES.map((posture) => (
            <button
              type="button"
              key={posture}
              title={`Preview ${posture} target`}
              aria-label={`Preview ${posture} target`}
              aria-pressed={posture === overlay.assumedPosture}
              onClick={() => onAssumedPosture(posture)}
            >
              <PostureIcon posture={posture} />
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
      <button
        type="button"
        className="targeting-map-collapse"
        aria-label="Collapse targeting legend"
        onClick={(event) => {
          event.stopPropagation();
          setCollapsed(true);
        }}
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </section>
  );
}
