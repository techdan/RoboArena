"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, GraduationCap, X } from "lucide-react";
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
 * Back (or a tap on an earlier progress segment) rereads a finished step without
 * undoing it; the card returns to the live step when the player catches up.
 */
export function FirstTurnCoach({ step, turnSeconds, onSkipStep, onFinish }: FirstTurnCoachProps) {
  const liveIndex = COACH_STEPS.findIndex((candidate) => candidate.id === step.id);
  const [review, setReview] = useState<{ readonly live: string; readonly index: number } | null>(
    null,
  );
  // A review belongs to the live step it started from; progress ends it.
  const index = review !== null && review.live === step.id ? review.index : liveIndex;
  const reviewing = index < liveIndex;
  const shown = COACH_STEPS[index]!;
  const last = liveIndex === COACH_STEPS.length - 1;
  const goTo = (target: number) =>
    setReview(target >= liveIndex ? null : { live: step.id, index: Math.max(0, target) });

  return (
    <aside className="first-turn-coach" aria-label="First turn guide" aria-live="polite">
      <header>
        <p className="eyebrow">
          <GraduationCap size={13} aria-hidden="true" /> First turn · Step {index + 1} of{" "}
          {COACH_STEPS.length}
          {reviewing ? <span className="first-turn-coach-done">Done</span> : null}
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
      <h2>{shown.title}</h2>
      <p>{shown.body.replaceAll("{seconds}", String(turnSeconds))}</p>
      <ol className="first-turn-coach-dots">
        {COACH_STEPS.map((candidate, dot) => (
          <li
            key={candidate.id}
            data-state={dot < liveIndex ? "done" : dot === liveIndex ? "now" : "next"}
            data-shown={dot === index ? "" : undefined}
          >
            {dot <= liveIndex ? (
              <button
                type="button"
                className="cursor-pointer"
                onClick={() => goTo(dot)}
                aria-label={`Show step ${dot + 1}: ${candidate.title}`}
                aria-current={dot === index ? "step" : undefined}
              />
            ) : null}
          </li>
        ))}
      </ol>
      {index > 0 || reviewing || step.skippable || last ? (
        <footer>
          {index > 0 ? (
            <button
              type="button"
              className="first-turn-coach-back cursor-pointer"
              onClick={() => goTo(index - 1)}
            >
              <ChevronLeft size={14} aria-hidden="true" /> Back
            </button>
          ) : null}
          <span className="first-turn-coach-spacer" />
          {reviewing ? (
            <button
              type="button"
              className="first-turn-coach-primary cursor-pointer"
              onClick={() => goTo(index + 1)}
            >
              {index + 1 === liveIndex ? `Return to step ${liveIndex + 1}` : "Next"}
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ) : (
            <>
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
            </>
          )}
        </footer>
      ) : null}
    </aside>
  );
}
