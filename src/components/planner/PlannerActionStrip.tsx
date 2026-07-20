"use client";

import { Crosshair, Radar } from "lucide-react";
import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import type { Heading, Posture, WeaponId } from "../../engine/types";
import { HEADINGS, headingFromVector, rotateHeading } from "../../planner/presentation";
import { WEAPON_LABELS } from "../../planner/firingHelpers";
import { HelpButton } from "../help/HelpProvider";
import { PostureIcon } from "./PostureIcon";

const POSTURES: readonly Posture[] = ["upright", "ducking", "crouching"];
const HEADING_ROTATION: Readonly<Record<Heading, number>> = {
  N: -90,
  NE: -45,
  E: 0,
  SE: 45,
  S: 90,
  SW: 135,
  W: 180,
  NW: 225,
};

export interface PlannerActionStripProps {
  readonly posture: Posture;
  readonly heading: Heading;
  readonly weapons: readonly WeaponId[];
  readonly selectedWeapon: WeaponId;
  readonly missileAmmo: number | null;
  readonly disabled: boolean;
  readonly aimActive: boolean;
  readonly scanActive: boolean;
  /**
   * When a fire mode is active this replaces the Aim & Fire / Scan & Fire entry
   * buttons in place, keeping the strip height and every other group fixed.
   */
  readonly fireControls?: ReactNode;
  readonly onPosture: (posture: Posture) => void;
  readonly onHeadingPreview: (heading: Heading | null) => void;
  readonly onHeading: (heading: Heading) => void;
  readonly onWeapon: (weapon: WeaponId) => void;
  readonly onAim: () => void;
  readonly onScan: () => void;
}

export function PlannerActionStrip({
  posture,
  heading,
  weapons,
  selectedWeapon,
  missileAmmo,
  disabled,
  aimActive,
  scanActive,
  fireControls,
  onPosture,
  onHeadingPreview,
  onHeading,
  onWeapon,
  onAim,
  onScan,
}: PlannerActionStripProps) {
  const [keyboardHeading, setKeyboardHeading] = useState(heading);
  useEffect(() => setKeyboardHeading(heading), [heading]);
  const preview = (next: Heading) => {
    setKeyboardHeading(next);
    onHeadingPreview(next);
  };
  const headingAtPointer = (event: PointerEvent<HTMLDivElement>): Heading => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return headingFromVector(
      event.clientX - (bounds.left + bounds.width / 2),
      event.clientY - (bounds.top + bounds.height / 2),
    );
  };
  const resetPreview = () => {
    setKeyboardHeading(heading);
    onHeadingPreview(null);
  };

  return (
    <section className="planner-action-strip" aria-label="Robot actions">
      <fieldset className="action-posture-group">
        <legend>
          <span className="action-caption">Posture</span>
          <b>{posture}</b>
          <HelpButton topic="action:posture" label="Posture" />
        </legend>
        <div>
          {POSTURES.map((choice) => (
            <button
              type="button"
              key={choice}
              title={`${choice} posture`}
              aria-label={`${choice} posture`}
              aria-pressed={choice === posture}
              data-active={choice === posture}
              disabled={disabled}
              onClick={() => onPosture(choice)}
            >
              <PostureIcon posture={choice} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="action-heading-group">
        <legend>
          <span className="action-caption">Scan</span>
          <HelpButton topic="action:scan-direction" label="Scan direction" />
        </legend>
        <div
          className="scan-direction-control"
          role="slider"
          aria-label="Scan direction"
          aria-valuemin={0}
          aria-valuemax={HEADINGS.length - 1}
          aria-valuenow={HEADINGS.indexOf(keyboardHeading)}
          aria-valuetext={keyboardHeading}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onBlur={resetPreview}
          onPointerDown={(event) => {
            if (disabled) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            preview(headingAtPointer(event));
          }}
          onPointerMove={(event) => {
            if (
              disabled ||
              (event.pointerType !== "mouse" &&
                !event.currentTarget.hasPointerCapture(event.pointerId))
            )
              return;
            preview(headingAtPointer(event));
          }}
          onPointerUp={(event) => {
            if (disabled) return;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            // Releasing with the pointer dragged outside the dial cancels the
            // gesture instead of committing the previewed heading.
            const bounds = event.currentTarget.getBoundingClientRect();
            const inside =
              event.clientX >= bounds.left &&
              event.clientX <= bounds.right &&
              event.clientY >= bounds.top &&
              event.clientY <= bounds.bottom;
            if (!inside) {
              resetPreview();
              return;
            }
            const next = headingAtPointer(event);
            setKeyboardHeading(next);
            onHeading(next);
            onHeadingPreview(null);
          }}
          onPointerCancel={resetPreview}
          onPointerLeave={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) resetPreview();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              event.preventDefault();
              preview(rotateHeading(keyboardHeading, -1));
            } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              event.preventDefault();
              preview(rotateHeading(keyboardHeading, 1));
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onHeading(keyboardHeading);
              onHeadingPreview(null);
            } else if (event.key === "Home") {
              event.preventDefault();
              preview("N");
            } else if (event.key === "End") {
              event.preventDefault();
              preview("NW");
            }
          }}
        >
          <span
            className="scan-direction-rear"
            style={{ transform: `rotate(${HEADING_ROTATION[keyboardHeading] + 270}deg)` }}
            aria-hidden="true"
          />
          <span
            className="scan-direction-forward"
            style={{ transform: `rotate(${HEADING_ROTATION[keyboardHeading] + 90}deg)` }}
            aria-hidden="true"
          />
          <span
            className="scan-direction-arrow"
            style={{ transform: `rotate(${HEADING_ROTATION[keyboardHeading]}deg)` }}
            aria-hidden="true"
          />
          {HEADINGS.map((choice, index) => {
            const angle = index * 45 - 90;
            return (
              <span
                className="scan-direction-choice"
                key={choice}
                data-active={choice === heading}
                aria-hidden="true"
                style={{
                  transform: `rotate(${angle}deg) translateX(1.55rem) rotate(${-angle}deg) translate(-50%, -50%)`,
                }}
              >
                {choice}
              </span>
            );
          })}
          <strong>{keyboardHeading}</strong>
        </div>
      </fieldset>

      {/* Single-weapon robots show no weapon control at all; the Missile robot
          keeps the plan-aware Missile Launcher · N / Rifle choice. */}
      {weapons.length > 1 ? (
        <div className="action-weapon-group">
          <span className="action-caption">Weapon</span>
          <select
            aria-label="Weapon"
            value={selectedWeapon}
            disabled={disabled}
            onChange={(event) => onWeapon(event.currentTarget.value as WeaponId)}
          >
            {weapons.map((weapon) => (
              <option key={weapon} value={weapon}>
                {WEAPON_LABELS[weapon]}
                {weapon === "missile-launcher" && missileAmmo !== null ? ` · ${missileAmmo}` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="action-fire-group">
        {fireControls ?? (
          <>
            <button
              type="button"
              aria-pressed={aimActive}
              data-active={aimActive}
              disabled={disabled}
              onClick={onAim}
            >
              <Crosshair size={17} aria-hidden="true" /> Aim &amp; Fire
            </button>
            <button
              type="button"
              aria-pressed={scanActive}
              data-active={scanActive}
              disabled={disabled}
              onClick={onScan}
            >
              <Radar size={17} aria-hidden="true" /> Scan &amp; Fire
            </button>
          </>
        )}
      </div>
    </section>
  );
}
