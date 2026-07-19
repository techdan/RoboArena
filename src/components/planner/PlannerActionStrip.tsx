"use client";

import { Crosshair, Radar } from "lucide-react";
import { useEffect, useState } from "react";
import type { Heading, Posture, WeaponId } from "../../engine/types";
import { HEADINGS, rotateHeading } from "../../planner/presentation";
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

  return (
    <section className="planner-action-strip" aria-label="Robot actions">
      <fieldset className="action-posture-group">
        <legend>
          Posture <HelpButton topic="action:posture" label="Posture" />
        </legend>
        <div>
          {POSTURES.map((choice) => (
            <button
              type="button"
              key={choice}
              aria-label={`${choice} posture`}
              aria-pressed={choice === posture}
              data-active={choice === posture}
              disabled={disabled}
              onClick={() => onPosture(choice)}
            >
              <PostureIcon posture={choice} />
              <span>{choice}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="action-heading-group">
        <legend>
          Scan direction <HelpButton topic="action:scan-direction" label="Scan direction" />
        </legend>
        <div
          className="scan-direction-control"
          role="group"
          aria-label={`Scan direction ${keyboardHeading}`}
          tabIndex={disabled ? -1 : 0}
          onBlur={() => onHeadingPreview(null)}
          onPointerLeave={() => {
            setKeyboardHeading(heading);
            onHeadingPreview(null);
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
              <button
                type="button"
                key={choice}
                aria-label={`Face ${choice}`}
                aria-pressed={choice === heading}
                data-active={choice === heading}
                disabled={disabled}
                style={{
                  transform: `rotate(${angle}deg) translateX(1.55rem) rotate(${-angle}deg) translate(-50%, -50%)`,
                }}
                onPointerEnter={() => preview(choice)}
                onFocus={() => preview(choice)}
                onClick={() => {
                  setKeyboardHeading(choice);
                  onHeading(choice);
                  onHeadingPreview(null);
                }}
              >
                {choice}
              </button>
            );
          })}
          <strong>{keyboardHeading}</strong>
        </div>
      </fieldset>

      <div className="action-weapon-group">
        <span>Weapon</span>
        {weapons.length > 1 ? (
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
        ) : (
          <strong>{WEAPON_LABELS[selectedWeapon]}</strong>
        )}
        {missileAmmo === null ? null : <small>Missiles {missileAmmo}</small>}
      </div>

      <div className="action-fire-group">
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
      </div>
    </section>
  );
}
