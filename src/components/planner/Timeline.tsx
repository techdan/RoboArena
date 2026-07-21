"use client";

import { Crosshair, MapPin, Radar, Trash2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RobotCommandSegment, RobotState, TurnOrders } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import { commandPresentation, removableSegmentIndex } from "../../planner/presentation";
import { projectRobotAtTick, timelineForRobot, timelineTiming } from "../../planner/segments";
import { PostureIcon } from "./PostureIcon";

const LONG_PRESS_MS = 500;
// Glyph cells stay recognizable even for the shortest actions; longer commands
// grow proportionally on the shared axis (hybrid-proportional duration). Kept
// small so sub-second commands barely inflate past their true width, keeping
// the block run aligned with the time axis and the playhead.
const MIN_CELL_REM = 0.9;
// A wide (long-duration) cell shows a short label so it does not read as empty;
// narrow cells stay glyph-only. ~7% of the 0–15s axis is room for a word.
const LABEL_WIDTH_THRESHOLD = 7;

const blockLabel = (segment: RobotCommandSegment): string => {
  switch (segment.kind) {
    case "deploy":
      return "Deploy";
    case "move":
      return "Move";
    case "aim-and-fire":
      return "Aim";
    case "scan-and-fire":
      return "Scan";
    case "set-posture":
      return segment.posture;
    case "set-scan-direction":
      return segment.heading;
  }
};

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
  }
};

interface TimelineLaneProps {
  readonly robot: RobotState;
  readonly orders: TurnOrders;
  readonly longestTick: number;
  readonly selected: boolean;
  readonly budgetTicks: number;
  readonly onSelectCommand: (robotId: string, segmentIndex: number, endTick: number) => void;
  readonly onRemoveLast: (robotId: string, segmentIndex: number) => void;
}

/**
 * One robot's command lane: glyph-only cells whose widths are proportional to
 * duration on the shared 0..longestTick axis. Command name, parameters, exact
 * start/end/duration and Remove Last Action live in the hover/focus/long-press
 * detail popover and each cell's accessible label — never as text inside the
 * block. Shared by the main timeline band and the All Programs overlay.
 */
export function TimelineLane({
  robot,
  orders,
  longestTick,
  selected,
  budgetTicks,
  onSelectCommand,
  onRemoveLast,
}: TimelineLaneProps) {
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailPosition, setDetailPosition] = useState({ left: 0, top: 0 });
  const longPressRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const timing = useMemo(
    () => timelineTiming(robot, timelineForRobot(orders, robot.id).segments, budgetTicks),
    [budgetTicks, orders, robot],
  );

  const clearLongPress = () => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  };
  const showDetail = (key: string, anchor: HTMLElement) => {
    const bounds = anchor.getBoundingClientRect();
    setDetailPosition({
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - 248)),
      top: Math.min(bounds.bottom + 5, window.innerHeight - 150),
    });
    setDetailKey(key);
  };

  return (
    <div className="timeline-lane" data-selected={selected}>
      {timing.length === 0 ? (
        <span className="timeline-empty">No actions yet</span>
      ) : (
        timing.map((entry) => {
          const priorSegments = timelineForRobot(orders, robot.id).segments.slice(0, entry.index);
          const presentation = commandPresentation(
            entry.segment,
            projectRobotAtTick(robot, priorSegments).position,
          );
          const key = `${robot.id}:${entry.index}`;
          const isLast = entry.index === removableSegmentIndex(timing.length);
          const widthPercent = (entry.durationTicks / Math.max(1, longestTick)) * 100;
          return (
            <div
              className="timeline-cell"
              data-over-budget={entry.overBudget}
              data-detail-open={detailKey === key}
              key={key}
              style={{ flexBasis: `${widthPercent}%`, minWidth: `${MIN_CELL_REM}rem` }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") showDetail(key, event.currentTarget);
              }}
              onPointerLeave={() => {
                clearLongPress();
                if (detailKey === key) setDetailKey(null);
              }}
            >
              <button
                type="button"
                className="timeline-command"
                aria-label={`${presentation.label}. ${presentation.detail}. ${formatGameTime(entry.startTick)} to ${formatGameTime(entry.endTick)}.`}
                onFocus={(event) => showDetail(key, event.currentTarget)}
                onBlur={(event) => {
                  const related = event.relatedTarget;
                  if (
                    !(related instanceof Node) ||
                    !event.currentTarget.parentElement?.contains(related)
                  )
                    setDetailKey(null);
                }}
                onPointerDown={(event) => {
                  if (event.pointerType !== "touch") return;
                  clearLongPress();
                  const anchor = event.currentTarget;
                  longPressRef.current = window.setTimeout(() => {
                    suppressClickRef.current = true;
                    showDetail(key, anchor);
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
                  showDetail(key, event.currentTarget);
                }}
              >
                <CommandGlyph segment={entry.segment} />
                {widthPercent >= LABEL_WIDTH_THRESHOLD ? (
                  <span className="timeline-cell-label">{blockLabel(entry.segment)}</span>
                ) : null}
              </button>
              {detailKey === key ? (
                <div className="timeline-command-detail" role="tooltip" style={detailPosition}>
                  <strong>{presentation.label}</strong>
                  <span>{presentation.detail}</span>
                  <small>
                    {formatGameTime(entry.startTick)} → {formatGameTime(entry.endTick)} ·{" "}
                    {formatGameTime(entry.durationTicks)}
                  </small>
                  {isLast ? (
                    <button type="button" onClick={() => onRemoveLast(robot.id, entry.index)}>
                      <Trash2 size={14} aria-hidden="true" /> Remove Last Action
                    </button>
                  ) : null}
                </div>
              ) : null}
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
  readonly onRemoveLast: (robotId: string, segmentIndex: number) => void;
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
  onRemoveLast,
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
  const longestTick = Math.max(
    budgetTicks,
    ...robots.map((robot) => timings.get(robot.id)?.at(-1)?.endTick ?? 0),
  );
  const rulerSeconds = Math.ceil(longestTick / 60);
  const rulerMarks = Array.from({ length: Math.floor(rulerSeconds / 5) + 1 }, (_, index) =>
    Math.min(rulerSeconds, index * 5),
  );
  if (rulerMarks.at(-1) !== rulerSeconds) rulerMarks.push(rulerSeconds);

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
        <div className="timeline-ticks" aria-hidden="true">
          {rulerMarks.map((second) => (
            <span key={second} style={{ left: `${(second / rulerSeconds) * 100}%` }}>
              {second}s
            </span>
          ))}
        </div>
        <div className="timeline-lane-scroll" ref={laneRef}>
          <TimelineLane
            robot={selectedRobot}
            orders={orders}
            longestTick={longestTick}
            selected
            budgetTicks={budgetTicks}
            onSelectCommand={onSelectCommand}
            onRemoveLast={onRemoveLast}
          />
        </div>
        <input
          type="range"
          className="timeline-scrub"
          aria-label={`Preview time ${formatGameTime(previewTick)}`}
          min={0}
          max={longestTick}
          value={previewTick}
          onChange={(event) => onPreviewTick(Number(event.currentTarget.value))}
        />
        <div
          className="timeline-marker"
          style={{ left: `${(previewTick / Math.max(1, longestTick)) * 100}%` }}
          aria-hidden="true"
        >
          <output>{formatGameTime(previewTick)}</output>
        </div>
      </div>
      <span className="timeline-remaining" data-over={remainingTicks < 0}>
        {formatGameTime(Math.max(0, remainingTicks))} left
      </span>
    </section>
  );
}
