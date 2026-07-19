"use client";

import { ChevronDown, ChevronUp, Pencil, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { RobotState, TurnOrders } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import { timelineForRobot, timelineTiming } from "../../planner/segments";
import { HelpButton } from "../help/HelpProvider";

const commandLabel = (kind: string): string =>
  ({
    deploy: "Deploy",
    move: "Move route",
    "set-posture": "Posture",
    "set-scan-direction": "Scan heading",
    "aim-and-fire": "Aim & Fire",
    "scan-and-fire": "Scan & Fire",
  })[kind] ?? kind;

export interface TimelineProps {
  readonly robots: readonly RobotState[];
  readonly orders: TurnOrders;
  readonly selectedRobotId: string;
  readonly budgetTicks: number;
  readonly previewTick: number;
  readonly remainingTicks: number;
  readonly editing: { readonly robotId: string; readonly index: number } | null;
  readonly onPreviewTick: (tick: number) => void;
  readonly onSelectRobot: (robotId: string) => void;
  readonly onEdit: (robotId: string, segmentIndex: number) => void;
  readonly onDelete: (robotId: string, segmentIndex: number) => void;
  readonly onReset: () => void;
}

export function Timeline({
  robots,
  orders,
  selectedRobotId,
  budgetTicks,
  previewTick,
  remainingTicks,
  editing,
  onPreviewTick,
  onSelectRobot,
  onEdit,
  onDelete,
  onReset,
}: TimelineProps) {
  const [showAllRobots, setShowAllRobots] = useState(false);
  const segmentRowsRef = useRef(new Map<string, HTMLDivElement>());
  const previousSegmentCountsRef = useRef(new Map<string, number>());
  const segmentCountKey = robots
    .map((robot) => `${robot.id}:${timelineForRobot(orders, robot.id).segments.length}`)
    .join("|");

  useLayoutEffect(() => {
    for (const robot of robots) {
      const count = timelineForRobot(orders, robot.id).segments.length;
      const previousCount = previousSegmentCountsRef.current.get(robot.id);
      const row = segmentRowsRef.current.get(robot.id);
      if (row !== undefined && (previousCount === undefined || count > previousCount)) {
        row.scrollLeft = row.scrollWidth;
      }
      previousSegmentCountsRef.current.set(robot.id, count);
    }
  }, [robots, orders, segmentCountKey]);

  const longestTick = robots.reduce((maximum, robot) => {
    const timing = timelineTiming(robot, timelineForRobot(orders, robot.id).segments, budgetTicks);
    return Math.max(maximum, timing.at(-1)?.endTick ?? 0);
  }, budgetTicks);
  const visibleRobots = showAllRobots
    ? robots
    : robots.filter((robot) => robot.id === selectedRobotId);
  return (
    <section className="planner-timeline" aria-label="Command timelines">
      <div className="timeline-heading">
        <div>
          <p className="eyebrow">
            Program horizon <HelpButton topic="action:timeline" label="Program timeline" />
          </p>
          <strong>
            {formatGameTime(previewTick)} / {formatGameTime(budgetTicks)}
          </strong>
        </div>
        <div className="timeline-heading-controls">
          <div className="timeline-robot-tabs" aria-label="Choose robot timeline">
            {robots.map((robot, robotIndex) => (
              <button
                type="button"
                key={robot.id}
                data-selected={robot.id === selectedRobotId}
                aria-pressed={robot.id === selectedRobotId}
                aria-label={`Robot ${robotIndex + 1}, ${robot.definition.class}`}
                onClick={() => onSelectRobot(robot.id)}
              >
                R{robotIndex + 1}
              </button>
            ))}
          </div>
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
            {showAllRobots ? "Selected only" : "All timelines"}
          </button>
        </div>
        <label className="timeline-scrubber-label">
          Preview time {formatGameTime(previewTick)}
          <input
            className="movie-scrubber"
            type="range"
            min={0}
            max={longestTick}
            value={previewTick}
            onChange={(event) => onPreviewTick(Number(event.currentTarget.value))}
          />
        </label>
        <div className="timeline-utilities">
          <span>
            Remaining horizon
            <strong data-over={remainingTicks < 0}>
              {formatGameTime(Math.max(0, remainingTicks))}
            </strong>
          </span>
          <button type="button" className="timeline-reset-button" onClick={onReset}>
            <RotateCcw size={15} aria-hidden="true" /> Reset this draft
          </button>
        </div>
      </div>
      <div className="timeline-rows" data-expanded={showAllRobots}>
        {visibleRobots.map((robot) => {
          const robotIndex = robots.findIndex((candidate) => candidate.id === robot.id);
          const timing = timelineTiming(
            robot,
            timelineForRobot(orders, robot.id).segments,
            budgetTicks,
          );
          return (
            <div
              className="timeline-row"
              data-selected={robot.id === selectedRobotId}
              key={robot.id}
            >
              <button
                type="button"
                className="timeline-robot"
                onClick={() => onSelectRobot(robot.id)}
              >
                <span>{robotIndex + 1}</span>
                {robot.definition.class}
              </button>
              <div
                className="timeline-segments"
                ref={(node) => {
                  if (node === null) segmentRowsRef.current.delete(robot.id);
                  else segmentRowsRef.current.set(robot.id, node);
                }}
              >
                {timing.length === 0 ? (
                  <span className="timeline-empty">No commands</span>
                ) : (
                  timing.map((entry) => (
                    <div
                      className="timeline-segment"
                      data-over-budget={entry.overBudget}
                      data-editing={editing?.robotId === robot.id && editing.index === entry.index}
                      key={`${robot.id}-${entry.index}`}
                      title={`${formatGameTime(entry.startTick)}–${formatGameTime(entry.endTick)}`}
                    >
                      <span>
                        <strong>{commandLabel(entry.segment.kind)}</strong>
                        <small>
                          {formatGameTime(entry.startTick)} → {formatGameTime(entry.endTick)} ·{" "}
                          {formatGameTime(entry.durationTicks)}
                        </small>
                      </span>
                      {entry.createsScanOpportunity ? (
                        <ScanLine size={13} aria-label="Creates a sensor refresh opportunity" />
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Edit ${commandLabel(entry.segment.kind)}`}
                        onClick={() => onEdit(robot.id, entry.index)}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${commandLabel(entry.segment.kind)}`}
                        onClick={() => onDelete(robot.id, entry.index)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
