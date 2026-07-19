import type { RobotState } from "../../engine/types";

export interface RobotSelectorProps {
  readonly robots: readonly RobotState[];
  readonly names: ReadonlyMap<string, string>;
  readonly selectedRobotId: string;
  readonly onSelect: (robotId: string) => void;
}

export function RobotSelector({ robots, names, selectedRobotId, onSelect }: RobotSelectorProps) {
  return (
    <nav className="planner-robot-selector" aria-label="Choose robot">
      {robots.map((robot, index) => (
        <button
          type="button"
          key={robot.id}
          aria-pressed={robot.id === selectedRobotId}
          data-selected={robot.id === selectedRobotId}
          onClick={() => onSelect(robot.id)}
        >
          <span className="planner-robot-shortcut" aria-hidden="true">
            {index + 1}
          </span>
          <strong>{names.get(robot.id) ?? robot.definition.class}</strong>
          <small>{robot.hp} HP</small>
        </button>
      ))}
    </nav>
  );
}
