"use client";

import {
  Bot,
  ChevronDown,
  ChevronUp,
  Crosshair,
  MapPin,
  Radar,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RobotCommandSegment, RobotState, TurnOrders } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import { commandPresentation, removableSegmentIndex } from "../../planner/presentation";
import { projectRobotAtTick, timelineForRobot, timelineTiming } from "../../planner/segments";
import { PostureIcon } from "./PostureIcon";

const LONG_PRESS_MS = 500;

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
      return <Crosshair size={15} aria-hidden="true" />;
    case "scan-and-fire":
      return <Radar size={15} aria-hidden="true" />;
  }
};

export interface TimelineProps {
  readonly robots: readonly RobotState[];
  readonly names: ReadonlyMap<string, string>;
  readonly orders: TurnOrders;
  readonly selectedRobotId: string;
  readonly budgetTicks: number;
  readonly previewTick: number;
  readonly remainingTicks: number;
  readonly onPreviewTick: (tick: number) => void;
  readonly onSelectRobot: (robotId: string) => void;
  readonly onSelectCommand: (robotId: string, segmentIndex: number, endTick: number) => void;
  readonly onRemoveLast: (robotId: string, segmentIndex: number) => void;
  readonly onClear: () => void;
}

export function Timeline({
  robots,
  names,
  orders,
  selectedRobotId,
  budgetTicks,
  previewTick,
  remainingTicks,
  onPreviewTick,
  onSelectRobot,
  onSelectCommand,
  onRemoveLast,
  onClear,
}: TimelineProps) {
  const [showAllRobots, setShowAllRobots] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const segmentRowsRef = useRef(new Map<string, HTMLDivElement>());
  const previousSegmentCountsRef = useRef(new Map<string, number>());
  const longPressRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const segmentCountKey = robots
    .map((robot) => `${robot.id}:${timelineForRobot(orders, robot.id).segments.length}`)
    .join("|");

  useLayoutEffect(() => {
    for (const robot of robots) {
      const count = timelineForRobot(orders, robot.id).segments.length;
      const previousCount = previousSegmentCountsRef.current.get(robot.id);
      const row = segmentRowsRef.current.get(robot.id);
      if (row !== undefined && previousCount !== undefined && count > previousCount)
        row.scrollLeft = row.scrollWidth;
      previousSegmentCountsRef.current.set(robot.id, count);
    }
  }, [robots, orders, segmentCountKey]);

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
  const visibleRobots = showAllRobots
    ? robots
    : robots.filter((robot) => robot.id === selectedRobotId);
  const selectedName = names.get(selectedRobotId) ?? "selected robot";
  const rulerSeconds = Math.ceil(longestTick / 60);
  const rulerMarks = Array.from({ length: Math.floor(rulerSeconds / 5) + 1 }, (_, index) =>
    Math.min(rulerSeconds, index * 5),
  );
  if (rulerMarks.at(-1) !== rulerSeconds) rulerMarks.push(rulerSeconds);

  const clearLongPress = () => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  };

  return (
    <section className="planner-timeline" aria-label="Command timelines">
      <div className="timeline-topline">
        <strong>{selectedName} program</strong>
        <span>
          {formatGameTime(previewTick)} / {formatGameTime(budgetTicks)}
        </span>
        <span data-over={remainingTicks < 0}>
          {formatGameTime(Math.max(0, remainingTicks))} remaining
        </span>
        <button
          type="button"
          className="timeline-expand-button"
          aria-expanded={showAllRobots}
          onClick={() => setShowAllRobots((current) => !current)}
        >
          {showAllRobots ? (
            <ChevronUp size={15} aria-hidden="true" />
          ) : (
            <ChevronDown size={15} aria-hidden="true" />
          )}
          {showAllRobots ? "Selected only" : "All Programs"}
        </button>
        <button type="button" className="timeline-reset-button" onClick={onClear}>
          <RotateCcw size={14} aria-hidden="true" /> Clear {selectedName}
        </button>
      </div>

      <div className="timeline-ruler" aria-hidden="true">
        {rulerMarks.map((second) => (
          <span key={second} style={{ left: `${(second / rulerSeconds) * 100}%` }}>
            {second}s
          </span>
        ))}
      </div>

      <div className="timeline-rows" data-expanded={showAllRobots}>
        {visibleRobots.map((robot, visibleIndex) => {
          const timing = timings.get(robot.id) ?? [];
          const robotName = names.get(robot.id) ?? robot.definition.class;
          return (
            <div
              className="timeline-row"
              data-selected={robot.id === selectedRobotId}
              key={robot.id}
            >
              {showAllRobots ? (
                <button
                  type="button"
                  className="timeline-robot"
                  onClick={() => onSelectRobot(robot.id)}
                >
                  <Bot size={14} aria-hidden="true" /> {robotName}
                </button>
              ) : null}
              <div
                className="timeline-segments"
                ref={(node) => {
                  if (node === null) segmentRowsRef.current.delete(robot.id);
                  else segmentRowsRef.current.set(robot.id, node);
                }}
              >
                {timing.length === 0 ? (
                  <span className="timeline-empty">No actions yet</span>
                ) : (
                  timing.map((entry) => {
                    const priorSegments = timelineForRobot(orders, robot.id).segments.slice(
                      0,
                      entry.index,
                    );
                    const presentation = commandPresentation(
                      entry.segment,
                      projectRobotAtTick(robot, priorSegments).position,
                    );
                    const key = `${robot.id}:${entry.index}`;
                    const isLast = entry.index === removableSegmentIndex(timing.length);
                    const widthPercent = Math.max(
                      7,
                      (entry.durationTicks / Math.max(1, longestTick)) * 100,
                    );
                    return (
                      <div
                        className="timeline-segment"
                        data-over-budget={entry.overBudget}
                        data-detail-open={detailKey === key}
                        key={key}
                        style={{ width: `${widthPercent}%` }}
                        onPointerEnter={(event) => {
                          if (event.pointerType !== "touch") setDetailKey(key);
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
                          onFocus={() => setDetailKey(key)}
                          onPointerDown={(event) => {
                            if (event.pointerType !== "touch") return;
                            clearLongPress();
                            longPressRef.current = window.setTimeout(() => {
                              suppressClickRef.current = true;
                              setDetailKey(key);
                            }, LONG_PRESS_MS);
                          }}
                          onPointerUp={clearLongPress}
                          onPointerCancel={clearLongPress}
                          onClick={() => {
                            if (suppressClickRef.current) {
                              suppressClickRef.current = false;
                              return;
                            }
                            onSelectCommand(robot.id, entry.index, entry.endTick);
                            setDetailKey(key);
                          }}
                        >
                          <CommandGlyph segment={entry.segment} />
                          <span>
                            <strong>{presentation.label}</strong>
                            <small>{presentation.compact}</small>
                          </span>
                        </button>
                        {detailKey === key ? (
                          <div
                            className="timeline-command-detail"
                            role="tooltip"
                            data-row={visibleIndex}
                          >
                            <strong>{presentation.label}</strong>
                            <span>{presentation.detail}</span>
                            <small>
                              {formatGameTime(entry.startTick)} → {formatGameTime(entry.endTick)} ·{" "}
                              {formatGameTime(entry.durationTicks)}
                            </small>
                            {isLast ? (
                              <button
                                type="button"
                                onClick={() => onRemoveLast(robot.id, entry.index)}
                              >
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
            </div>
          );
        })}
      </div>

      <label className="timeline-playhead">
        <span className="sr-only">Preview time {formatGameTime(previewTick)}</span>
        <input
          type="range"
          min={0}
          max={longestTick}
          value={previewTick}
          onChange={(event) => onPreviewTick(Number(event.currentTarget.value))}
        />
        <output style={{ left: `${(previewTick / Math.max(1, longestTick)) * 100}%` }}>
          {formatGameTime(previewTick)}
        </output>
      </label>
    </section>
  );
}
