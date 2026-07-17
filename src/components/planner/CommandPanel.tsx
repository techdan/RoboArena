"use client";

import { Crosshair, LocateFixed, Redo2, RotateCcw, Undo2, X } from "lucide-react";
import type { Heading, Posture } from "../../engine/types";
import { FireBox } from "./FireBox";

const POSTURES: readonly Posture[] = ["upright", "ducking", "crouching"];
const HEADINGS: readonly Heading[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export interface CommandPanelProps {
  readonly posture: Posture;
  readonly heading: Heading;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly editingCommandNumber: number | null;
  readonly remainingTicks: number;
  readonly onPosture: (posture: Posture) => void;
  readonly onHeading: (heading: Heading) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onCancelEdit: () => void;
  readonly onReset: () => void;
  readonly fireDisabled: boolean;
  readonly aimActive: boolean;
  readonly onAim: () => void;
  readonly onScanFire: () => void;
}

export function CommandPanel({
  posture,
  heading,
  canUndo,
  canRedo,
  editingCommandNumber,
  remainingTicks,
  onPosture,
  onHeading,
  onUndo,
  onRedo,
  onCancelEdit,
  onReset,
  fireDisabled,
  aimActive,
  onAim,
  onScanFire,
}: CommandPanelProps) {
  return (
    <aside className="planner-panel">
      <div className="planner-panel-heading">
        <div>
          <p className="eyebrow">Tools</p>
          <h2>Program robot</h2>
        </div>
        <div className="history-buttons">
          <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo">
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo">
            <Redo2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {editingCommandNumber === null ? null : (
        <div className="planner-editing" role="status">
          <span>Replacing command {editingCommandNumber}</span>
          <button type="button" onClick={onCancelEdit} aria-label="Cancel command edit">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <section>
        <h3>Movement</h3>
        <p className="planner-help">
          <LocateFixed size={15} aria-hidden="true" /> Choose a home tile to deploy, then choose
          destinations. Routes avoid terrain your current posture cannot cross.
        </p>
      </section>
      <section>
        <h3>Posture</h3>
        <div className="posture-grid">
          {POSTURES.map((choice) => (
            <button
              type="button"
              key={choice}
              data-active={choice === posture}
              onClick={() => onPosture(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>Scan direction</h3>
        <div className="heading-grid">
          {HEADINGS.map((choice) => (
            <button
              type="button"
              key={choice}
              data-active={choice === heading}
              onClick={() => onHeading(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
        <p className="planner-help">
          <Crosshair size={15} aria-hidden="true" /> The white heading line points through the
          center of the inclusive forward scan semicircle.
        </p>
      </section>
      <section>
        <h3>Fire</h3>
        <FireBox disabled={fireDisabled} aimActive={aimActive} onAim={onAim} onScan={onScanFire} />
      </section>
      <div className="planner-budget">
        <span>Remaining horizon</span>
        <strong data-over={remainingTicks < 0}>
          {remainingTicks >= 0 ? remainingTicks : 0} ticks
        </strong>
        {remainingTicks < 0 ? (
          <small>{Math.abs(remainingTicks)} ticks execute beyond this turn</small>
        ) : null}
      </div>
      <button type="button" className="secondary-action w-full" onClick={onReset}>
        <RotateCcw size={15} aria-hidden="true" /> Reset this draft
      </button>
    </aside>
  );
}
