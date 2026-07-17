"use client";

import { Pencil, ScanLine, Trash2 } from "lucide-react";
import type { RobotState, TurnOrders } from "../../engine/types";
import { timelineForRobot, timelineTiming } from "../../planner/segments";

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
  readonly editing: { readonly robotId: string; readonly index: number } | null;
  readonly onPreviewTick: (tick: number) => void;
  readonly onSelectRobot: (robotId: string) => void;
  readonly onEdit: (robotId: string, segmentIndex: number) => void;
  readonly onDelete: (robotId: string, segmentIndex: number) => void;
}

export function Timeline({
  robots,
  orders,
  selectedRobotId,
  budgetTicks,
  previewTick,
  editing,
  onPreviewTick,
  onSelectRobot,
  onEdit,
  onDelete,
}: TimelineProps) {
  const longestTick = robots.reduce((maximum, robot) => {
    const timing = timelineTiming(robot, timelineForRobot(orders, robot.id).segments, budgetTicks);
    return Math.max(maximum, timing.at(-1)?.endTick ?? 0);
  }, budgetTicks);
  return (
    <section className="planner-timeline" aria-label="Command timelines">
      <div className="timeline-heading">
        <div>
          <p className="eyebrow">Program horizon</p>
          <strong>
            {(previewTick / 60).toFixed(2)}s / {(budgetTicks / 60).toFixed(2)}s
          </strong>
        </div>
        <label className="timeline-scrubber-label">
          Preview tick {previewTick}
          <input
            className="movie-scrubber"
            type="range"
            min={0}
            max={longestTick}
            value={previewTick}
            onChange={(event) => onPreviewTick(Number(event.currentTarget.value))}
          />
        </label>
      </div>
      <div className="timeline-rows">
        {robots.map((robot, robotIndex) => {
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
              <div className="timeline-segments">
                {timing.length === 0 ? (
                  <span className="timeline-empty">No commands</span>
                ) : (
                  timing.map((entry) => (
                    <div
                      className="timeline-segment"
                      data-over-budget={entry.overBudget}
                      data-editing={editing?.robotId === robot.id && editing.index === entry.index}
                      key={`${robot.id}-${entry.index}`}
                      title={`${entry.startTick}–${entry.endTick} ticks`}
                    >
                      <span>
                        <strong>{commandLabel(entry.segment.kind)}</strong>
                        <small>
                          {entry.startTick} → {entry.endTick} · {entry.durationTicks}t
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
