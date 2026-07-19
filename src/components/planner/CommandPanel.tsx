"use client";

import { ArrowDown, ArrowUp, Minus, X } from "lucide-react";
import type { Heading, Posture } from "../../engine/types";
import { HelpButton } from "../help/HelpProvider";
import { FireBox } from "./FireBox";
import { usePlannerDialogFocus } from "./usePlannerDialogFocus";

const POSTURES: readonly Posture[] = ["upright", "ducking", "crouching"];
const HEADINGS: readonly Heading[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export interface CommandPanelProps {
  readonly robotLabel: string;
  readonly posture: Posture;
  readonly heading: Heading;
  readonly editingCommandNumber: number | null;
  readonly onPosture: (posture: Posture) => void;
  readonly onHeading: (heading: Heading) => void;
  readonly onCancelEdit: () => void;
  readonly onClose: () => void;
  readonly fireDisabled: boolean;
  readonly aimActive: boolean;
  readonly onAim: () => void;
  readonly onScanFire: () => void;
}

export function CommandPanel({
  robotLabel,
  posture,
  heading,
  editingCommandNumber,
  onPosture,
  onHeading,
  onCancelEdit,
  onClose,
  fireDisabled,
  aimActive,
  onAim,
  onScanFire,
}: CommandPanelProps) {
  const dialogRef = usePlannerDialogFocus<HTMLElement>(onClose);
  const closeAfter = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div className="planner-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="planner-dialog robot-command-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="robot-command-dialog-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">Robot commands</p>
            <h2 id="robot-command-dialog-title">{robotLabel}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close robot commands">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {editingCommandNumber === null ? null : (
          <div className="planner-editing" role="status">
            <span>Replacing command {editingCommandNumber}</span>
            <button
              type="button"
              onClick={() => closeAfter(onCancelEdit)}
              aria-label="Cancel command edit"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="robot-command-sections">
          <section className="robot-command-section">
            <h3>
              Posture <HelpButton topic="action:posture" label="Posture" />
            </h3>
            <div className="posture-grid posture-icon-grid">
              {POSTURES.map((choice) => (
                <button
                  type="button"
                  key={choice}
                  title={choice}
                  aria-label={`${choice} posture`}
                  aria-pressed={choice === posture}
                  data-active={choice === posture}
                  data-dialog-initial-focus={choice === posture ? "" : undefined}
                  onClick={() => closeAfter(() => onPosture(choice))}
                >
                  {choice === "upright" ? (
                    <ArrowUp size={21} aria-hidden="true" />
                  ) : choice === "ducking" ? (
                    <Minus size={21} aria-hidden="true" />
                  ) : (
                    <ArrowDown size={21} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </section>

          <section className="robot-command-section">
            <h3>
              Scan direction <HelpButton topic="action:scan-direction" label="Scan direction" />
            </h3>
            <div className="heading-grid">
              {HEADINGS.map((choice) => (
                <button
                  type="button"
                  key={choice}
                  aria-pressed={choice === heading}
                  data-active={choice === heading}
                  onClick={() => closeAfter(() => onHeading(choice))}
                >
                  {choice}
                </button>
              ))}
            </div>
          </section>

          <section className="robot-command-section">
            <h3>Fire</h3>
            <FireBox
              disabled={fireDisabled}
              aimActive={aimActive}
              onAim={() => closeAfter(onAim)}
              onScan={() => closeAfter(onScanFire)}
            />
          </section>
        </div>
      </section>
    </div>
  );
}
