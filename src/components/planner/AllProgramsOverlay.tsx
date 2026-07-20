"use client";

import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { RobotState, TurnOrders } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import { timelineForRobot, timelineTiming } from "../../planner/segments";
import { TimelineLane } from "./Timeline";

export interface AllProgramsOverlayProps {
  readonly robots: readonly RobotState[];
  readonly names: ReadonlyMap<string, string>;
  readonly orders: TurnOrders;
  readonly selectedRobotId: string;
  readonly budgetTicks: number;
  readonly previewTick: number;
  readonly onPreviewTick: (tick: number) => void;
  readonly onSelectRobot: (robotId: string) => void;
  readonly onSelectCommand: (robotId: string, segmentIndex: number, endTick: number) => void;
  readonly onRemoveLast: (robotId: string, segmentIndex: number) => void;
  readonly onClose: () => void;
}

/**
 * Temporary turn-review panel that overlays the action strip and upper arena
 * (absolutely positioned; the layout below does not reflow). Every robot lane
 * aligns to the same axis and a single shared playhead, reusing the main
 * timeline's scrubber and glyph {@link TimelineLane}. Escape or the toggle
 * collapses it, and the preview time is preserved because it is owned by the
 * parent, not this panel.
 */
export function AllProgramsOverlay({
  robots,
  names,
  orders,
  selectedRobotId,
  budgetTicks,
  previewTick,
  onPreviewTick,
  onSelectRobot,
  onSelectCommand,
  onRemoveLast,
  onClose,
}: AllProgramsOverlayProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const longestTick = useMemo(
    () =>
      Math.max(
        budgetTicks,
        ...robots.map(
          (robot) =>
            timelineTiming(robot, timelineForRobot(orders, robot.id).segments, budgetTicks).at(-1)
              ?.endTick ?? 0,
        ),
      ),
    [budgetTicks, orders, robots],
  );
  const rulerSeconds = Math.ceil(longestTick / 60);
  const rulerMarks = Array.from({ length: Math.floor(rulerSeconds / 5) + 1 }, (_, index) =>
    Math.min(rulerSeconds, index * 5),
  );
  if (rulerMarks.at(-1) !== rulerSeconds) rulerMarks.push(rulerSeconds);

  return (
    <div className="planner-all-programs" role="dialog" aria-label="All robot programs">
      <div className="all-programs-head">
        <strong>All Programs</strong>
        <button type="button" onClick={onClose} aria-label="Close all programs">
          <X size={15} aria-hidden="true" /> Close
        </button>
      </div>
      <div className="all-programs-body">
        <div className="all-programs-axis" aria-hidden="true">
          {rulerMarks.map((second) => (
            <span key={second} style={{ left: `${(second / rulerSeconds) * 100}%` }}>
              {second}s
            </span>
          ))}
        </div>
        <div className="all-programs-rows">
          {robots.map((robot) => (
            <div className="all-programs-row" key={robot.id}>
              <button
                type="button"
                className="all-programs-name"
                data-selected={robot.id === selectedRobotId}
                onClick={() => onSelectRobot(robot.id)}
              >
                {names.get(robot.id) ?? robot.definition.class}
              </button>
              <div className="all-programs-lane-scroll">
                <TimelineLane
                  robot={robot}
                  orders={orders}
                  longestTick={longestTick}
                  selected={robot.id === selectedRobotId}
                  budgetTicks={budgetTicks}
                  onSelectCommand={onSelectCommand}
                  onRemoveLast={onRemoveLast}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="all-programs-playhead">
          <input
            type="range"
            className="all-programs-scrub"
            aria-label={`Preview time ${formatGameTime(previewTick)}`}
            min={0}
            max={longestTick}
            value={previewTick}
            onChange={(event) => onPreviewTick(Number(event.currentTarget.value))}
          />
          <div
            className="all-programs-marker"
            style={{ left: `${(previewTick / Math.max(1, longestTick)) * 100}%` }}
            aria-hidden="true"
          >
            <output>{formatGameTime(previewTick)}</output>
          </div>
        </div>
      </div>
    </div>
  );
}
