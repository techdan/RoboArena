"use client";

import { Crosshair, Minus, Plus, X } from "lucide-react";
import { useMemo } from "react";
import type { Arena, Posture, RobotState, TileCoord, WeaponId } from "../../engine/types";
import { blastDamagePresentation, fireActionCount } from "../../planner/combatPresentation";
import {
  PLANNER_WEAPON_RANGE,
  previewAim,
  WEAPON_LABELS,
  type AuthorizedContact,
} from "../../planner/firingHelpers";

export interface ShotCardProps {
  readonly arena: Arena;
  readonly shooter: RobotState;
  readonly shooterName: string;
  /** The locked target, or the hovered tile while choosing. */
  readonly target: TileCoord | null;
  readonly locked: boolean;
  readonly weapon: WeaponId;
  readonly weapons: readonly WeaponId[];
  readonly shots: number;
  readonly maxShots: number;
  readonly firingIntervalTicks: number;
  readonly assumedPosture: Posture;
  readonly authorizedContacts: readonly AuthorizedContact[];
  readonly onWeapon: (weapon: WeaponId) => void;
  readonly onShots: (shots: number) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const STATUS_COPY = {
  "shooter-docked": "Deploy this robot before aiming.",
  "out-of-range": "Out of range for this weapon.",
  "angle-blocked": "Outside the scan arc. Face this way first.",
  "sight-blocked": "A wall blocks the line of fire.",
} as const;

const COVER_COPY = {
  none: "Target in the open",
  "target-bush": "Target in a bush",
  "adjacent-bush": "Bush beside target",
  "target-low-wall": "Target behind a low wall",
  "adjacent-low-wall": "Low wall beside target",
} as const;

/**
 * Aim in place: the floor shows the odds everywhere, and this card gives the
 * exact numbers for the chosen tile before anything is committed.
 */
export function ShotCard(props: ShotCardProps) {
  const { arena, shooter, target, weapon, authorizedContacts } = props;
  const preview = useMemo(
    () =>
      target === null ? null : previewAim({ arena, shooter, target, weapon, authorizedContacts }),
    [arena, authorizedContacts, shooter, target, weapon],
  );
  const estimate =
    preview?.estimates.find((entry) =>
      preview.authorizedContact === null
        ? entry.posture === props.assumedPosture
        : entry.posture === preview.authorizedContact.posture,
    ) ?? preview?.estimates[0];
  const blast = blastDamagePresentation(weapon);
  const count = fireActionCount(weapon, props.shots);
  const seconds = (props.shots * props.firingIntervalTicks) / 60;
  const eligible = preview?.status === "eligible";
  return (
    <aside className="tactical-card shot-card" aria-label="Aim and fire">
      <header>
        <p className="eyebrow">
          <Crosshair size={12} aria-hidden="true" /> Aim · {props.shooterName}
        </p>
        <button
          type="button"
          className="cursor-pointer"
          onClick={props.onCancel}
          aria-label="Cancel aim"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      {props.weapons.length > 1 ? (
        <div className="shot-card-weapons" role="group" aria-label="Weapon">
          {props.weapons.map((option) => (
            <button
              key={option}
              type="button"
              className="cursor-pointer"
              aria-pressed={option === weapon}
              onClick={() => props.onWeapon(option)}
            >
              {WEAPON_LABELS[option]}
            </button>
          ))}
        </div>
      ) : null}
      {target === null || preview === null ? (
        <p className="shot-card-empty">Tap any lit tile to aim. Brighter tiles are better shots.</p>
      ) : (
        <>
          <p className="shot-card-target">
            {preview.authorizedContact?.label ?? `Tile ${target.x},${target.y}`}
            <span> · {preview.distance} tiles</span>
            {props.locked ? null : <span className="shot-card-hover"> · hovering</span>}
          </p>
          {eligible ? (
            preview.resolution === "blast" ? (
              <div className="shot-card-big">
                <strong>Blast</strong>
                <span>radius {blast?.radius ?? 0}, no hit roll</span>
              </div>
            ) : (
              <div className="shot-card-big">
                <strong>{estimate?.chancePercent ?? 0}%</strong>
                <span>to hit, per shot</span>
              </div>
            )
          ) : (
            <p className="shot-card-blocked">
              {STATUS_COPY[preview.status as keyof typeof STATUS_COPY] ??
                "This tile can't be targeted."}
            </p>
          )}
          {eligible ? (
            <dl className="shot-card-facts">
              <div>
                <dt>Damage if hit</dt>
                <dd>
                  {preview.resolution === "blast"
                    ? (blast?.bands.split(" · ")[0] ?? "–")
                    : estimate?.damageRange === null || estimate?.damageRange === undefined
                      ? "–"
                      : `${estimate.damageRange.minimum}–${estimate.damageRange.maximum}`}
                </dd>
              </div>
              {estimate === undefined || preview.resolution === "blast" ? null : (
                <div>
                  <dt>Cover</dt>
                  <dd>{COVER_COPY[estimate.coverSource]}</dd>
                </div>
              )}
              <div>
                <dt>Range</dt>
                <dd>
                  {preview.distance} of {PLANNER_WEAPON_RANGE[weapon]} tiles
                </dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>
                  {count.primary} · {seconds.toFixed(1)}s
                </dd>
              </div>
              {preview.authorizedContact === null && preview.resolution !== "blast" ? (
                <div>
                  <dt>Assumes</dt>
                  <dd>Target {props.assumedPosture}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </>
      )}
      <footer>
        <div className="shot-card-stepper" role="group" aria-label="Shots">
          <button
            type="button"
            className="cursor-pointer"
            aria-label="Fewer shots"
            disabled={props.shots <= 1}
            onClick={() => props.onShots(props.shots - 1)}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <output aria-live="polite">{count.primary}</output>
          <button
            type="button"
            className="cursor-pointer"
            aria-label="More shots"
            disabled={props.shots >= props.maxShots}
            onClick={() => props.onShots(props.shots + 1)}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="shot-card-confirm cursor-pointer"
          disabled={!props.locked || !eligible}
          onClick={props.onConfirm}
        >
          Confirm
        </button>
      </footer>
    </aside>
  );
}
