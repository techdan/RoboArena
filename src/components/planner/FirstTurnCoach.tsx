"use client";

import { GraduationCap, X } from "lucide-react";
import { COACH_STEPS, type CoachStep } from "../../planner/firstTurnCoach";

export interface FirstTurnCoachProps {
  readonly step: CoachStep;
  readonly turnSeconds: number;
  readonly onSkipStep: () => void;
  readonly onFinish: () => void;
}

/**
 * The coach card for a player's first planning turn. It sits where the board
 * hint normally sits, says one thing to do, and moves on when the player does it.
 */
export function FirstTurnCoach({ step, turnSeconds, onSkipStep, onFinish }: FirstTurnCoachProps) {
  const index = COACH_STEPS.findIndex((candidate) => candidate.id === step.id);
  const last = index === COACH_STEPS.length - 1;
  return (
    <aside className="first-turn-coach" aria-label="First turn guide" aria-live="polite">
      <header>
        <p className="eyebrow">
          <GraduationCap size={13} aria-hidden="true" /> First turn · Step {index + 1} of{" "}
          {COACH_STEPS.length}
        </p>
        <button
          type="button"
          className="cursor-pointer"
          onClick={onFinish}
          aria-label="Close the first turn guide"
          title="Close guide"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <h2>{step.title}</h2>
      <p>{step.body.replaceAll("{seconds}", String(turnSeconds))}</p>
      <ol className="first-turn-coach-dots" aria-hidden="true">
        {COACH_STEPS.map((candidate, dot) => (
          <li
            key={candidate.id}
            data-state={dot < index ? "done" : dot === index ? "now" : "next"}
          />
        ))}
      </ol>
      {step.skippable || last ? (
        <footer>
          {step.skippable ? (
            <button type="button" className="cursor-pointer" onClick={onSkipStep}>
              Skip this step
            </button>
          ) : null}
          {last ? (
            <button
              type="button"
              className="first-turn-coach-primary cursor-pointer"
              onClick={onFinish}
            >
              Got it
            </button>
          ) : null}
        </footer>
      ) : null}
    </aside>
  );
}
