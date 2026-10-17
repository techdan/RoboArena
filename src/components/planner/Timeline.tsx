"use client";

import { Bomb, Crosshair, MapPin, Radar, Skull, Trash2, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RobotCommandSegment, RobotState, TurnOrders } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import { commandPresentation } from "../../planner/presentation";
import { projectRobotAtTick, timelineForRobot, timelineTiming } from "../../planner/segments";
import { PostureIcon } from "./PostureIcon";

const LONG_PRESS_MS = 500;
/**
 * The legal budget occupies exactly one viewport. Only a real over-budget tail
 * enlarges the shared track, so cells, ticks, and playhead retain one linear
 * tick scale without introducing within-budget scrolling.
 */
export const timelineTrackWidthPercent = (longestTick: number, budgetTicks: number): number =>
  Math.max(100, (longestTick / Math.max(1, budgetTicks)) * 100);

const weaponInitial = (
  segment: Extract<RobotCommandSegment, { readonly kind: "aim-and-fire" | "scan-and-fire" }>,
): string =>
  segment.weapon === "missile-launcher"
    ? "M"
    : segment.weapon === "grenade-launcher"
      ? "G"
      : segment.weapon === "burst-gun"
        ? "B"
        : segment.weapon === "auto-rifle"
          ? "A"
          : "R";

const CommandGlyph = ({ segment }: { readonly segment: RobotCommandSegment }) => {
  switch (segment.kind) {
    case "deploy":
      return <MapPin size={15} aria-hidden="true" />;
    case "move":
      return <span className="timeline-move-glyph">{commandPresentation(segment).compact}</span>;
    case "set-posture":
      return <PostureIcon posture={segment.posture} />;
    case "set-scan-direction":
      return (
        <span className="timeline-scan-glyph" data-heading={segment.heading} aria-hidden="true">
          <i />
        </span>
      );
    case "aim-and-fire":
      return (
        <span className="timeline-fire-glyph" aria-hidden="true">
          <Crosshair size={15} />
          <i>{weaponInitial(segment)}</i>
        </span>
      );
    case "scan-and-fire":
      return (
        <span className="timeline-fire-glyph" aria-hidden="true">
          <Radar size={15} />
          <i>{weaponInitial(segment)}</i>
        </span>
      );
    case "zap":
      return <Zap size={15} aria-hidden="true" />;
    case "place-bomb":
      return (
        <span className="timeline-fire-glyph" aria-hidden="true">
          <Bomb size={15} />
          <i>{segment.fuseSeconds}</i>
        </span>
      );
    case "self-destruct":
      return <Skull size={15} aria-hidden="true" />;
  }
};

interface TimelineLaneProps {
  readonly robot: RobotState;
  readonly orders: TurnOrders;
  readonly longestTick: number;
  readonly selected: boolean;
  readonly budgetTicks: number;
  readonly onSelectCommand: (robotId: string, segmentIndex: number, endTick: number) => void;
  readonly onRemoveFrom: (robotId: string, segmentIndex: number) => void;
}

const CLOSE_DELAY_MS = 260;
/** Space the popover needs below an action before it flips above instead. */
const DETAIL_ROOM_PX = 120;

/**
 * One robot's command lane: glyph-only cells whose widths are proportional to
 * duration on the shared 0..longestTick axis. Command name, parameters, exact
 * start/end/duration and a per-action Remove (this action to the end) live in
 * the detail popover and each cell's accessible label — never as text inside
 * the block. The popover opens on hover/focus and pins open on click/tap so it
 * survives moving the pointer onto it (and works on touch); it dismisses on a
 * hover-out delay, an outside press, or Escape. Shared by the main timeline
 * band and the All Programs overlay.
 */
export function TimelineLane({
  robot,
  orders,
  longestTick,
  selected,
  budgetTicks,
  onSelectCommand,
  onRemoveFrom,
}: TimelineLaneProps) {
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailPosition, setDetailPosition] = useState<{
    left: number;
    top: number;
    transform?: string;
  }>({ left: 0, top: 0 });
  const laneRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const longPressRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const pinnedRef = useRef(false);
  const timing = useMemo(
    () => timelineTiming(robot, timelineForRobot(orders, robot.id).segments, budgetTicks),
    [budgetTicks, orders, robot],
  );
  const presentations = useMemo(() => {
    const segments = timelineForRobot(orders, robot.id).segments;
    return timing.map((entry) =>
      commandPresentation(
        entry.segment,
        projectRobotAtTick(robot, segments.slice(0, entry.index)).position,
      ),
    );
  }, [timing, orders, robot]);
  useEffect(
    () => () => {
      if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const clearLongPress = () => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  };
  const cancelClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const closeDetail = () => {
    cancelClose();
    pinnedRef.current = false;
    setDetailKey(null);
  };
  const scheduleClose = () => {
    if (pinnedRef.current) return;
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setDetailKey(null), CLOSE_DELAY_MS);
  };
  const openDetail = (key: string, anchor: HTMLElement, pinned: boolean) => {
    cancelClose();
    const bounds = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - 260));
    // Open above the action when there is no room below (the turn track sits
    // at the bottom of the screen), so the popover never covers its own cell.
    setDetailPosition(
      bounds.bottom + 5 + DETAIL_ROOM_PX <= window.innerHeight
        ? { left, top: bounds.bottom + 5 }
        : { left, top: bounds.top - 5, transform: "translateY(-100%)" },
    );
    pinnedRef.current = pinned;
    setDetailKey(key);
  };

  // A pinned popover dismisses on an outside press or Escape.
  useEffect(() => {
    if (detailKey === null) return;
    const onDown = (event: Event) => {
      if (
        laneRef.current !== null &&
        event.target instanceof Node &&
        !laneRef.current.contains(event.target) &&
        !(detailRef.current?.contains(event.target) ?? false)
      ) {
        cancelClose();
        pinnedRef.current = false;
        setDetailKey(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelClose();
        pinnedRef.current = false;
        setDetailKey(null);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [detailKey]);

  return (
    <div className="timeline-lane" data-selected={selected} ref={laneRef}>
      {timing.length === 0 ? (
        <span className="timeline-empty">No actions yet</span>
      ) : (
        timing.map((entry, timingIndex) => {
          const presentation = presentations[timingIndex]!;
          const key = `${robot.id}:${entry.index}`;
          const widthPercent = (entry.durationTicks / Math.max(1, longestTick)) * 100;
          return (
            <div
              className="timeline-cell"
              data-over-budget={entry.overBudget}
              data-detail-open={detailKey === key}
              key={key}
              style={{ flexBasis: `${widthPercent}%` }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch" && !pinnedRef.current)
                  openDetail(key, event.currentTarget, false);
              }}
              onPointerLeave={() => {
                clearLongPress();
                scheduleClose();
              }}
            >
              <button
                type="button"
                className="timeline-command"
                aria-label={`${presentation.label}. ${presentation.detail}. ${formatGameTime(entry.startTick)} to ${formatGameTime(entry.endTick)}.`}
                onFocus={(event) => openDetail(key, event.currentTarget, false)}
                onBlur={(event) => {
                  const related = event.relatedTarget;
                  if (
                    !(related instanceof Node) ||
                    !(
                      (event.currentTarget.parentElement?.contains(related) ?? false) ||
                      (detailRef.current?.contains(related) ?? false)
                    )
                  )
                    closeDetail();
                }}
                onPointerDown={(event) => {
                  if (event.pointerType !== "touch") return;
                  clearLongPress();
                  const anchor = event.currentTarget;
                  longPressRef.current = window.setTimeout(() => {
                    suppressClickRef.current = true;
                    openDetail(key, anchor, true);
                  }, LONG_PRESS_MS);
                }}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  onSelectCommand(robot.id, entry.index, entry.endTick);
                  // Click/tap pins the popover open so it can be interacted with;
                  // clicking the same pinned cell again closes it.
                  if (detailKey === key && pinnedRef.current) closeDetail();
                  else openDetail(key, event.currentTarget, true);
                }}
              >
                <CommandGlyph segment={entry.segment} />
              </button>
              {/* Portaled to <body>: the track's backdrop-filter would otherwise
                  become the containing block for this position: fixed popover
                  and push it below the viewport. */}
              {detailKey === key
                ? createPortal(
                    <div
                      ref={detailRef}
                      className="timeline-command-detail"
                      role="tooltip"
                      style={detailPosition}
                      onPointerEnter={cancelClose}
                      onPointerLeave={scheduleClose}
                    >
                      <strong>{presentation.label}</strong>
                      <span>{presentation.detail}</span>
                      <small>
                        {formatGameTime(entry.startTick)} → {formatGameTime(entry.endTick)} ·{" "}
                        {formatGameTime(entry.durationTicks)}
                      </small>
                      <button
                        type="button"
                        className="timeline-remove"
                        aria-label={`Remove ${presentation.label} and every later action`}
                        title="Remove this action and everything after it"
                        onClick={() => {
                          closeDetail();
                          onRemoveFrom(robot.id, entry.index);
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
          );
        })
      )}
    </div>
  );
}

export interface TimelineProps {
  readonly robots: readonly RobotState[];
  readonly orders: TurnOrders;
  readonly selectedRobotId: string;
  readonly budgetTicks: number;
  readonly previewTick: number;
  readonly remainingTicks: number;
  readonly onPreviewTick: (tick: number) => void;
  readonly onSelectCommand: (robotId: string, segmentIndex: number, endTick: number) => void;
  readonly onRemoveFrom: (robotId: string, segmentIndex: number) => void;
}

/**
 * Single-band command timeline for the selected robot. The ruler ticks render
 * inside the lane background, the playhead rides directly on the lane (a
 * transparent range input for scrubbing plus a marker line), the current time
 * shows only at the playhead, and the right edge shows remaining time. No
 * separate ruler row, no detached scrubber, no duplicated time text.
 */
export function Timeline({
  robots,
  orders,
  selectedRobotId,
  budgetTicks,
  previewTick,
  remainingTicks,
  onPreviewTick,
  onSelectCommand,
  onRemoveFrom,
}: TimelineProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const previousSegmentCountRef = useRef(0);
  const selectedRobot = robots.find((robot) => robot.id === selectedRobotId) ?? robots[0];
  const timings = useMemo(
    () =>
      new Map(
        robots.map((robot) => [
          robot.id,
          timelineTiming(robot, timelineForRobot(orders, robot.id).segments, budgetTicks),
        ]),
      ),
    [budgetTicks, orders, robots],
  );
  const programEndTick = Math.max(
    budgetTicks,
    ...robots.map((robot) => timings.get(robot.id)?.at(-1)?.endTick ?? 0),
  );
  const axisTicks = Math.ceil(programEndTick / 60) * 60;
  const rulerSeconds = axisTicks / 60;
  const rulerMarks = Array.from({ length: Math.floor(rulerSeconds / 5) + 1 }, (_, index) =>
    Math.min(rulerSeconds, index * 5),
  );
  if (rulerMarks.at(-1) !== rulerSeconds) rulerMarks.push(rulerSeconds);
  const trackWidthPercent = timelineTrackWidthPercent(axisTicks, budgetTicks);

  // Keep the newest command in view when the selected lane overflows (over budget).
  const selectedCount = selectedRobot
    ? timelineForRobot(orders, selectedRobot.id).segments.length
    : 0;
  useLayoutEffect(() => {
    const lane = laneRef.current;
    if (lane !== null && selectedCount > previousSegmentCountRef.current)
      lane.scrollLeft = lane.scrollWidth;
    previousSegmentCountRef.current = selectedCount;
  }, [selectedCount]);

  if (selectedRobot === undefined) return null;

  return (
    <section className="planner-timeline" aria-label="Command timeline">
      <div className="timeline-band">
        <div className="timeline-track-scroll" ref={laneRef}>
          <div className="timeline-track" style={{ width: `${trackWidthPercent}%` }}>
            <div className="timeline-ticks" aria-hidden="true">
              {rulerMarks.map((second) => (
                <span key={second} style={{ left: `${(second / rulerSeconds) * 100}%` }}>
                  {second}s
                </span>
              ))}
            </div>
            <TimelineLane
              robot={selectedRobot}
              orders={orders}
              longestTick={axisTicks}
              selected
              budgetTicks={budgetTicks}
              onSelectCommand={onSelectCommand}
              onRemoveFrom={onRemoveFrom}
            />
            <input
              type="range"
              className="timeline-scrub"
              aria-label={`Preview time ${formatGameTime(previewTick)}`}
              min={0}
              max={axisTicks}
              value={previewTick}
              onChange={(event) => onPreviewTick(Number(event.currentTarget.value))}
            />
            <div
              className="timeline-marker"
              style={{ left: `${(previewTick / Math.max(1, axisTicks)) * 100}%` }}
              aria-hidden="true"
            >
              <output>{formatGameTime(previewTick)}</output>
            </div>
          </div>
        </div>
      </div>
      <span className="timeline-remaining" data-over={remainingTicks < 0}>
        {formatGameTime(Math.max(0, remainingTicks))} left
      </span>
    </section>
  );
}
