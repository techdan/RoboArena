"use client";

import {
  ArrowLeft,
  Bomb,
  Compass,
  Crosshair,
  Footprints,
  PersonStanding,
  Radar,
  Skull,
  X,
  Zap,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Heading, Posture } from "../../engine/types";
import { HEADINGS } from "../../planner/presentation";

export interface RadialOrdersProps {
  readonly name: string;
  readonly posture: Posture;
  readonly heading: Heading;
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
  readonly onClose: () => void;
}

const RADIUS = 86;
const POSTURE_LABELS: Readonly<Record<Posture, string>> = {
  upright: "Stand",
  ducking: "Duck",
  crouching: "Crouch",
};

interface Item {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: ReactNode;
  readonly angle: number;
  readonly active?: boolean;
  readonly primary?: boolean;
  readonly onClick: () => void;
  readonly onHover?: (on: boolean) => void;
}

/**
 * Root ring: Move, Aim, Scan & fire, Posture, Face, then Zap, Bomb and Self
 * destruct when the robot may program them. Items share the circle evenly with the close button,
 * which keeps the original 60-degree layout when only the five base orders show.
 */
const rootItems = (
  props: RadialOrdersProps,
  openPosture: () => void,
  openFace: () => void,
): readonly Item[] => {
  const entries: Omit<Item, "angle">[] = [
    {
      key: "move",
      label: "Move",
      hint: "tap floor",
      icon: <Footprints size={14} aria-hidden="true" />,
      primary: true,
      onClick: props.onMove,
    },
    {
      key: "aim",
      label: "Aim",
      hint: "A",
      icon: <Crosshair size={14} aria-hidden="true" />,
      onClick: props.onAim,
    },
    {
      key: "scan",
      label: "Scan & fire",
      hint: "S",
      icon: <Radar size={14} aria-hidden="true" />,
      onClick: props.onScan,
    },
    {
      key: "posture",
      label: POSTURE_LABELS[props.posture],
      hint: "D",
      icon: <PersonStanding size={14} aria-hidden="true" />,
      onClick: openPosture,
    },
    {
      key: "face",
      label: `Face ${props.heading}`,
      hint: "F",
      icon: <Compass size={14} aria-hidden="true" />,
      onClick: openFace,
    },
  ];
  if (props.onZap !== undefined)
    entries.push({
      key: "zap",
      label: "Zap",
      hint: "Z",
      icon: <Zap size={14} aria-hidden="true" />,
      onClick: props.onZap,
    });
  if (props.onPlaceBomb !== undefined)
    entries.push({
      key: "bomb",
      label: "Bomb",
      hint: "B",
      icon: <Bomb size={14} aria-hidden="true" />,
      onClick: props.onPlaceBomb,
    });
  if (props.onSelfDestruct !== undefined)
    entries.push({
      key: "self-destruct",
      label: "Self destruct",
      hint: "X",
      icon: <Skull size={14} aria-hidden="true" />,
      onClick: props.onSelfDestruct,
    });
  const step = 360 / (entries.length + 1);
  return entries.map((entry, index) => ({ ...entry, angle: -90 + index * step }));
};

/**
 * Orders open around the selected robot, where the player is already looking.
 * Every item is a real button (keyboard and touch reachable) with a one-key
 * shortcut shown beside it; Posture and Face open a second ring in place.
 */
export function RadialOrders(props: RadialOrdersProps) {
  const [ring, setRing] = useState<"root" | "posture" | "face">("root");
  const back = () => {
    props.onHeadingPreview(null);
    setRing("root");
  };
  const items: readonly Item[] =
    ring === "posture"
      ? (["upright", "ducking", "crouching"] as const).map((posture, index) => ({
          key: posture,
          label: POSTURE_LABELS[posture],
          angle: -90 + (index - 1) * 50,
          active: props.posture === posture,
          onClick: () => {
            props.onPosture(posture);
            setRing("root");
          },
        }))
      : ring === "face"
        ? HEADINGS.map((heading, index) => ({
            key: heading,
            label: heading,
            angle: -90 + index * 45,
            active: props.heading === heading,
            onClick: () => {
              props.onHeadingPreview(null);
              props.onHeading(heading);
              setRing("root");
            },
            onHover: (on: boolean) => props.onHeadingPreview(on ? heading : null),
          }))
        : rootItems(
            props,
            () => setRing("posture"),
            () => setRing("face"),
          );
  const closeAngle = ring === "root" ? -90 + (360 / (items.length + 1)) * items.length : 210;
  return (
    <div
      className="radial-orders"
      role="menu"
      aria-label={`Orders for ${props.name}`}
      data-ring={ring}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <span className="radial-orders-ring" aria-hidden="true" />
      {items.map((item) => {
        const rad = (item.angle * Math.PI) / 180;
        const radius = ring === "face" ? RADIUS * 0.82 : RADIUS;
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className="radial-orders-item cursor-pointer"
            data-primary={item.primary === true}
            data-active={item.active === true}
            style={{ left: Math.cos(rad) * radius, top: Math.sin(rad) * radius }}
            onClick={item.onClick}
            onPointerEnter={() => item.onHover?.(true)}
            onPointerLeave={() => item.onHover?.(false)}
            onFocus={() => item.onHover?.(true)}
            onBlur={() => item.onHover?.(false)}
          >
            {item.icon}
            {item.label}
            {item.hint === undefined ? null : <kbd>{item.hint}</kbd>}
          </button>
        );
      })}
      <button
        type="button"
        className="radial-orders-close cursor-pointer"
        aria-label={ring === "root" ? "Close orders" : "Back"}
        style={{
          left: Math.cos((closeAngle * Math.PI) / 180) * RADIUS,
          top: Math.sin((closeAngle * Math.PI) / 180) * RADIUS,
        }}
        onClick={ring === "root" ? props.onClose : back}
      >
        {ring === "root" ? (
          <X size={14} aria-hidden="true" />
        ) : (
          <ArrowLeft size={14} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
