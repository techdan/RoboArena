"use client";

import { ChevronDown, ChevronUp, MoreHorizontal, RotateCcw } from "lucide-react";
import type { RobotState } from "../../engine/types";
import { formatGameTime } from "../../lib/formatTime";
import { useDisclosure } from "./useDisclosure";

export interface RobotSelectorProps {
  readonly robots: readonly RobotState[];
  readonly names: ReadonlyMap<string, string>;
  readonly selectedRobotId: string;
  readonly selectedName: string;
  readonly usedTicks: number;
  readonly budgetTicks: number;
  readonly showAllPrograms: boolean;
  readonly onSelect: (robotId: string) => void;
  readonly onToggleAllPrograms: () => void;
  readonly onClear: () => void;
}

/**
 * Band-local overflow menu ("⋯"). Reuses the same dismiss-on-Escape/outside-press
 * disclosure as the header {@link PlannerMenu}; it holds the selected-robot-scoped
 * Clear action so it stays next to the chips and summary it acts on rather than
 * spending a permanent labeled button.
 */
function BandOverflowMenu({
  selectedName,
  onClear,
}: {
  readonly selectedName: string;
  readonly onClear: () => void;
}) {
  const { open, setOpen, rootRef } = useDisclosure();
  return (
    <div className="planner-band-overflow" ref={rootRef}>
      <button
        type="button"
        className="planner-band-overflow-button"
        aria-expanded={open}
        aria-label="More robot actions"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="planner-band-overflow-menu">
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            <RotateCcw size={14} aria-hidden="true" /> Clear {selectedName}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function RobotSelector({
  robots,
  names,
  selectedRobotId,
  selectedName,
  usedTicks,
  budgetTicks,
  showAllPrograms,
  onSelect,
  onToggleAllPrograms,
  onClear,
}: RobotSelectorProps) {
  return (
    <div className="planner-selector-band">
      <nav className="planner-robot-selector" aria-label="Choose robot">
        {robots.map((robot, index) => {
          const destroyed = robot.hp <= 0;
          const ratio = Math.max(0, Math.min(1, robot.hp / robot.definition.armor));
          const robotName = names.get(robot.id) ?? robot.definition.class;
          return (
            <button
              type="button"
              key={robot.id}
              aria-pressed={robot.id === selectedRobotId}
              data-selected={robot.id === selectedRobotId}
              data-destroyed={destroyed}
              disabled={destroyed}
              aria-label={destroyed ? `${robotName}, destroyed` : undefined}
              onClick={() => onSelect(robot.id)}
            >
              <span className="planner-robot-shortcut" aria-hidden="true">
                {index + 1}
              </span>
              <span className="planner-robot-meta">
                <strong>{robotName}</strong>
                <span className="planner-robot-health">
                  {destroyed ? (
                    <small className="planner-robot-destroyed-label">Destroyed</small>
                  ) : (
                    <>
                      <span
                        className="planner-robot-hp"
                        role="img"
                        aria-label={`${robot.hp} of ${robot.definition.armor} HP`}
                      >
                        <span style={{ width: `${ratio * 100}%` }} data-low={ratio <= 0.34} />
                      </span>
                      <small>
                        {robot.hp} / {robot.definition.armor}
                      </small>
                    </>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="planner-program-summary" aria-label={`${selectedName} program time`}>
        <span>
          {formatGameTime(usedTicks)} / {formatGameTime(budgetTicks)}
        </span>
        <small>used</small>
      </div>
      <div className="planner-band-actions">
        <button
          type="button"
          className="timeline-expand-button"
          aria-expanded={showAllPrograms}
          onClick={onToggleAllPrograms}
        >
          {showAllPrograms ? (
            <ChevronUp size={15} aria-hidden="true" />
          ) : (
            <ChevronDown size={15} aria-hidden="true" />
          )}
          All Programs
        </button>
        <BandOverflowMenu selectedName={selectedName} onClear={onClear} />
      </div>
    </div>
  );
}
