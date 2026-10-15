"use client";

import { Eraser } from "lucide-react";
import type { RobotState, TurnOrders } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import { timelineForRobot, timelineTiming } from "../../planner/segments";

const CHASSIS: Readonly<Record<string, string>> = {
  rifle: "Strider · Rifle",
  burst: "Hound · Burst",
  auto: "Crab · Machine gun",
  missile: "Titan · Missile",
};

export interface SquadRailProps {
  readonly robots: readonly RobotState[];
  readonly names: ReadonlyMap<string, string>;
  readonly orders: TurnOrders;
  readonly selectedRobotId: string;
  readonly budgetTicks: number;
  readonly onSelect: (robotId: string) => void;
  readonly onClear: () => void;
}

/** The squad at a glance: who is selected, their health, and how much of the turn each has used. */
export function SquadRail({
  robots,
  names,
  orders,
  selectedRobotId,
  budgetTicks,
  onSelect,
  onClear,
}: SquadRailProps) {
  return (
    <nav className="squad-rail" aria-label="Your squad">
      {robots.map((robot, index) => {
        const segments = timelineForRobot(orders, robot.id).segments;
        const used = timelineTiming(robot, segments, budgetTicks).at(-1)?.endTick ?? 0;
        const selected = robot.id === selectedRobotId;
        const destroyed = robot.hp <= 0;
        const hpPercent = Math.max(0, Math.min(100, (robot.hp / robot.definition.armor) * 100));
        return (
          <div
            className="squad-card"
            data-selected={selected}
            data-destroyed={destroyed}
            key={robot.id}
          >
            <button
              type="button"
              className="squad-card-select cursor-pointer"
              aria-pressed={selected}
              disabled={destroyed}
              onClick={() => onSelect(robot.id)}
            >
              <span className="squad-card-key" aria-hidden="true">
                {index + 1}
              </span>
              <span className="squad-card-name">
                {names.get(robot.id) ?? robot.definition.class}
              </span>
              <span className="squad-card-class">
                {CHASSIS[robot.definition.class] ?? robot.definition.class}
              </span>
              <span className="squad-card-bars">
                <span
                  className="squad-card-bar"
                  data-kind="hp"
                  aria-label={`Health ${robot.hp} of ${robot.definition.armor}`}
                >
                  <i style={{ width: `${hpPercent}%` }} />
                </span>
                <span
                  className="squad-card-bar"
                  data-kind="time"
                  data-over={used > budgetTicks}
                  aria-label={`${formatGameTime(used)} of ${formatGameTime(budgetTicks)} planned`}
                >
                  <i style={{ width: `${Math.min(100, (used / budgetTicks) * 100)}%` }} />
                </span>
              </span>
              <span className="squad-card-time">
                {destroyed
                  ? "Destroyed"
                  : robot.position === "dock" && segments.length === 0
                    ? "Waiting to deploy"
                    : `${formatGameTime(used)} / ${formatGameTime(budgetTicks)}`}
              </span>
            </button>
            {selected && segments.length > 0 ? (
              <button
                type="button"
                className="squad-card-clear cursor-pointer"
                onClick={onClear}
                aria-label={`Clear ${names.get(robot.id) ?? "robot"}'s plan`}
                title="Clear plan"
              >
                <Eraser size={13} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
