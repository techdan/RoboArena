"use client";

import { Pause, Play } from "lucide-react";
import { useMemo } from "react";
import type { RobotState, TurnOrders } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import { timelineForRobot, timelineTiming } from "../../planner/segments";
import { timelineTrackWidthPercent, TimelineLane } from "./Timeline";

export interface TurnTrackProps {
  readonly robots: readonly RobotState[];
  readonly names: ReadonlyMap<string, string>;
  readonly orders: TurnOrders;
  readonly selectedRobotId: string;
  readonly budgetTicks: number;
  readonly previewTick: number;
  readonly rehearsing: boolean;
  readonly onPreviewTick: (tick: number) => void;
  readonly onRehearse: () => void;
  readonly onSelectRobot: (robotId: string) => void;
  readonly onSelectCommand: (robotId: string, segmentIndex: number, endTick: number) => void;
  readonly onRemoveFrom: (robotId: string, segmentIndex: number) => void;
}

/**
 * The squad's shared clock: one lane per robot on a single time axis with one
 * playhead. Dragging the playhead moves every robot on the board to where its
 * orders put it at that moment; Rehearse plays the whole turn.
 */
export function TurnTrack({
  robots,
  names,
  orders,
  selectedRobotId,
  budgetTicks,
  previewTick,
  rehearsing,
  onPreviewTick,
  onRehearse,
  onSelectRobot,
  onSelectCommand,
  onRemoveFrom,
}: TurnTrackProps) {
  const endTicks = useMemo(
    () =>
      new Map(
        robots.map((robot) => [
          robot.id,
          timelineTiming(robot, timelineForRobot(orders, robot.id).segments, budgetTicks).at(-1)
            ?.endTick ?? 0,
        ]),
      ),
    [budgetTicks, orders, robots],
  );
  const programEndTick = Math.max(budgetTicks, ...endTicks.values());
  const axisTicks = Math.ceil(programEndTick / 60) * 60;
  const rulerSeconds = axisTicks / 60;
  const rulerMarks = Array.from({ length: rulerSeconds + 1 }, (_, second) => second);
  const trackWidthPercent = timelineTrackWidthPercent(axisTicks, budgetTicks);

  return (
    <section className="turn-track" aria-label="Turn track">
      <header className="turn-track-head">
        <button
          type="button"
          className="turn-track-rehearse cursor-pointer"
          aria-pressed={rehearsing}
          onClick={onRehearse}
          title="Rehearse — R"
        >
          {rehearsing ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
          {rehearsing ? "Pause" : "Rehearse"}
        </button>
        <span className="turn-track-caption">
          {rehearsing
            ? `Rehearsing · ${formatGameTime(previewTick)}`
            : "Drag the playhead to preview every robot at once"}
        </span>
      </header>
      <div className="all-programs-body turn-track-body">
        <div className="all-programs-names">
          {robots.map((robot) => {
            const used = endTicks.get(robot.id) ?? 0;
            const destroyed = robot.hp <= 0;
            return (
              <button
                type="button"
                className="all-programs-name turn-track-name cursor-pointer"
                data-selected={robot.id === selectedRobotId}
                data-over={used > budgetTicks}
                disabled={destroyed}
                onClick={() => onSelectRobot(robot.id)}
                key={robot.id}
              >
                <span>{names.get(robot.id) ?? robot.definition.class}</span>
                <small>
                  {destroyed
                    ? "Destroyed"
                    : used > budgetTicks
                      ? `${formatGameTime(used - budgetTicks)} over`
                      : `${formatGameTime(budgetTicks - used)} free`}
                </small>
              </button>
            );
          })}
        </div>
        <div className="all-programs-track-scroll">
          <div className="all-programs-track" style={{ width: `${trackWidthPercent}%` }}>
            <div className="all-programs-axis" aria-hidden="true">
              {rulerMarks.map((second) => (
                <span
                  key={second}
                  data-major={second % 5 === 0}
                  style={{ left: `${(second / rulerSeconds) * 100}%` }}
                >
                  {second % 5 === 0 ? `${second}s` : ""}
                </span>
              ))}
            </div>
            <div className="all-programs-rows">
              {robots.map((robot) => (
                <div className="all-programs-row" key={robot.id}>
                  <TimelineLane
                    robot={robot}
                    orders={orders}
                    longestTick={axisTicks}
                    selected={robot.id === selectedRobotId}
                    budgetTicks={budgetTicks}
                    onSelectCommand={onSelectCommand}
                    onRemoveFrom={onRemoveFrom}
                  />
                </div>
              ))}
            </div>
            <div className="all-programs-playhead">
              <input
                type="range"
                className="all-programs-scrub"
                aria-label={`Preview time ${formatGameTime(previewTick)}`}
                min={0}
                max={axisTicks}
                value={previewTick}
                onChange={(event) => onPreviewTick(Number(event.currentTarget.value))}
              />
              <div
                className="all-programs-marker"
                style={{ left: `${(previewTick / Math.max(1, axisTicks)) * 100}%` }}
                aria-hidden="true"
              >
                <output>{formatGameTime(previewTick)}</output>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
