"use client";

import {
  Bomb,
  Compass,
  Crosshair,
  Footprints,
  Radar,
  Skull,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { Heading, Posture } from "../../engine/types";

/** The order the bar shows as current; the planner's default is Move. */
export type CommandMode = "move" | "aim" | "scan" | "zap" | "place-bomb" | "self-destruct";

export interface CommandBarProps {
  readonly name: string;
  readonly detail: string;
  readonly teamColor: string;
  readonly usedSeconds: number;
  readonly budgetSeconds: number;
  /** False while the robot is still waiting to deploy: orders need it on the field. */
  readonly deployed: boolean;
  readonly mode: CommandMode;
  readonly posture: Posture;
  readonly heading: Heading;
  readonly faceOpen: boolean;
  readonly onFaceOpen: (open: boolean) => void;
  readonly onMove: () => void;
  readonly onAim: () => void;
  readonly onScan: () => void;
  /** Present only when this robot may program Zap. */
  readonly onZap?: () => void;
  /** Present only when this robot still carries a Time Bomb. */
  readonly onPlaceBomb?: () => void;
  /** Present only when this robot is its Team's last one standing. */
  readonly onSelfDestruct?: () => void;
  readonly onPosture: (posture: Posture) => void;
  readonly onHeadingPreview: (heading: Heading | null) => void;
  readonly onHeading: (heading: Heading) => void;
}

const POSTURES: readonly { readonly posture: Posture; readonly label: string }[] = [
  { posture: "upright", label: "Stand" },
  { posture: "ducking", label: "Duck" },
  { posture: "crouching", label: "Crouch" },
];

/** Compass layout for the Face picker: a 3×3 grid with the close button in the middle. */
const COMPASS: readonly (Heading | null)[] = ["NW", "N", "NE", "W", null, "E", "SW", "S", "SE"];

function Order({
  icon: Icon,
  label,
  shortcut,
  active,
  disabled,
  tone,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly shortcut?: string;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly tone?: "danger";
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="command-order cursor-pointer"
      aria-pressed={active}
      data-tone={tone}
      disabled={disabled}
      onClick={onClick}
      {...(shortcut === undefined ? {} : { "aria-keyshortcuts": shortcut })}
    >
      <Icon size={20} aria-hidden="true" />
      <span>{label}</span>
      {shortcut === undefined ? null : <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>
  );
}

/**
 * Every order for the selected robot, docked above the timeline. Nothing opens
 * on the board itself, so the robot and the tiles around it stay clickable.
 * The current order stays lit; picking another is one click with no Back step.
 */
export function CommandBar(props: CommandBarProps) {
  const faceRef = useRef<HTMLDivElement>(null);
  const { faceOpen, onFaceOpen, onHeadingPreview } = props;
  useEffect(() => {
    if (!faceOpen) return;
    const close = (event: PointerEvent) => {
      if (faceRef.current?.contains(event.target as Node) === true) return;
      onHeadingPreview(null);
      onFaceOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [faceOpen, onFaceOpen, onHeadingPreview]);

  const off = !props.deployed;
  const used = Math.min(1, props.usedSeconds / Math.max(1, props.budgetSeconds));
  return (
    <section
      className="command-bar"
      aria-label={`Orders for ${props.name}`}
      style={{ "--command-team": props.teamColor } as CSSProperties}
    >
      <div className="command-who">
        <strong>
          <span className="command-lamp" aria-hidden="true" />
          {props.name}
        </strong>
        <small>{props.detail}</small>
        <span className="command-time">
          <span className="command-budget" aria-hidden="true">
            <span style={{ width: `${Math.round(used * 100)}%` }} />
          </span>
          {props.usedSeconds.toFixed(1)} / {props.budgetSeconds.toFixed(1)} s
        </span>
      </div>
      <div className="command-orders" role="group" aria-label="Orders">
        <Order
          icon={Footprints}
          label="Move"
          shortcut="M"
          active={props.deployed && props.mode === "move"}
          disabled={off}
          onClick={props.onMove}
        />
        <Order
          icon={Crosshair}
          label="Aim & fire"
          shortcut="A"
          active={props.mode === "aim"}
          disabled={off}
          onClick={props.onAim}
        />
        <Order
          icon={Radar}
          label="Scan & fire"
          shortcut="S"
          active={props.mode === "scan"}
          disabled={off}
          onClick={props.onScan}
        />
        <span className="command-divider" aria-hidden="true" />
        <div className="command-posture" role="group" aria-label="Posture (D cycles)">
          {POSTURES.map(({ posture, label }) => (
            <button
              key={posture}
              type="button"
              className="cursor-pointer"
              aria-pressed={props.posture === posture}
              disabled={off}
              onClick={() => {
                if (props.posture !== posture) props.onPosture(posture);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="command-face" ref={faceRef}>
          <Order
            icon={Compass}
            label={`Face ${props.heading}`}
            shortcut="F"
            active={faceOpen}
            disabled={off}
            onClick={() => {
              onHeadingPreview(null);
              onFaceOpen(!faceOpen);
            }}
          />
          {faceOpen ? (
            <div className="command-compass" role="group" aria-label="Face a compass point">
              {COMPASS.map((heading) =>
                heading === null ? (
                  <button
                    key="close"
                    type="button"
                    className="cursor-pointer"
                    aria-label="Close compass"
                    onClick={() => {
                      onHeadingPreview(null);
                      onFaceOpen(false);
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    key={heading}
                    type="button"
                    className="cursor-pointer"
                    aria-pressed={props.heading === heading}
                    onPointerEnter={() => onHeadingPreview(heading)}
                    onPointerLeave={() => onHeadingPreview(null)}
                    onFocus={() => onHeadingPreview(heading)}
                    onBlur={() => onHeadingPreview(null)}
                    onClick={() => {
                      onHeadingPreview(null);
                      onFaceOpen(false);
                      props.onHeading(heading);
                    }}
                  >
                    {heading}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
        {props.onZap === undefined &&
        props.onPlaceBomb === undefined &&
        props.onSelfDestruct === undefined ? null : (
          <span className="command-divider" aria-hidden="true" />
        )}
        {props.onZap === undefined ? null : (
          <Order
            icon={Zap}
            label="Zap"
            shortcut="Z"
            active={props.mode === "zap"}
            disabled={off}
            onClick={props.onZap}
          />
        )}
        {props.onPlaceBomb === undefined ? null : (
          <Order
            icon={Bomb}
            label="Bomb"
            shortcut="B"
            active={props.mode === "place-bomb"}
            disabled={off}
            onClick={props.onPlaceBomb}
          />
        )}
        {props.onSelfDestruct === undefined ? null : (
          <Order
            icon={Skull}
            label="Self destruct…"
            shortcut="X"
            tone="danger"
            active={props.mode === "self-destruct"}
            disabled={off}
            onClick={props.onSelfDestruct}
          />
        )}
      </div>
    </section>
  );
}
