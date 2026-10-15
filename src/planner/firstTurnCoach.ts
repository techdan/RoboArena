/**
 * First-turn coach: the ordered steps that walk a new player through planning
 * a real turn, and the rule that decides which step is current.
 *
 * Steps advance only on things the player actually did (orders in the draft,
 * the orders ring opening, Rehearse running), never on a timer, so the guide
 * cannot run ahead of the player. Pure data; the planner supplies the facts.
 */

import type { RobotCommandSegment } from "../engine/types";

export type CoachStepId = "deploy" | "move" | "orders" | "aim" | "squad" | "rehearse" | "lock";

export interface CoachStep {
  readonly id: CoachStepId;
  readonly title: string;
  readonly body: string;
  /** Steps a player may reasonably be unable to do right now (no shot in sight). */
  readonly skippable: boolean;
}

export const COACH_STEPS: readonly CoachStep[] = [
  {
    id: "deploy",
    title: "Drop in your first robot",
    body: "Your robots start off the field. Tap a lit tile in your home corner to deploy the selected robot there.",
    skippable: false,
  },
  {
    id: "move",
    title: "Give it somewhere to go",
    body: "Tap any open floor tile. The robot plots the quickest route, drawn as light on the floor. Moving uses part of its {seconds} seconds.",
    skippable: false,
  },
  {
    id: "orders",
    title: "Open its orders",
    body: "Tap the robot itself. Its orders open around it: move, aim, scan & fire, posture and facing.",
    skippable: false,
  },
  {
    id: "aim",
    title: "Line up a shot",
    body: "Choose Aim. Lit tiles can be hit, and brighter means better odds. Tap one to see the exact chance, then Confirm.",
    skippable: true,
  },
  {
    id: "squad",
    title: "Plan the rest of the squad",
    body: "Pick each robot in the left rail (or press 1–4) and give it orders. Every robot acts at the same time.",
    skippable: true,
  },
  {
    id: "rehearse",
    title: "Rehearse the turn",
    body: "Press Rehearse to watch your whole squad play out its {seconds} seconds. Drag the playhead to check any moment.",
    skippable: false,
  },
  {
    id: "lock",
    title: "Lock your orders",
    body: "Happy with the plan? Lock orders. Once every player has locked, the turn plays as a movie for everyone.",
    skippable: false,
  },
];

/** What the planner has seen the player do so far. */
export interface CoachFacts {
  /** The current draft's command segments for each robot that can still act. */
  readonly timelines: readonly (readonly RobotCommandSegment[])[];
  readonly ordersOpened: boolean;
  readonly rehearsed: boolean;
  readonly skipped: ReadonlySet<CoachStepId>;
}

const anySegment = (facts: CoachFacts, kinds: readonly RobotCommandSegment["kind"][]) =>
  facts.timelines.some((segments) => segments.some((segment) => kinds.includes(segment.kind)));

export const isCoachStepDone = (id: CoachStepId, facts: CoachFacts): boolean => {
  if (facts.skipped.has(id)) return true;
  switch (id) {
    case "deploy":
      return anySegment(facts, ["deploy"]);
    case "move":
      return anySegment(facts, ["move"]);
    case "orders":
      return facts.ordersOpened;
    case "aim":
      return anySegment(facts, ["aim-and-fire", "scan-and-fire"]);
    case "squad":
      return facts.timelines.length > 0 && facts.timelines.every((segments) => segments.length > 0);
    case "rehearse":
      return facts.rehearsed;
    case "lock":
      // Locking leaves the planner; the last step is dismissed by the player.
      return false;
  }
};

/**
 * The first step not yet done, in order. Earlier steps stay the gate: a
 * player who aims before moving is still asked to move first, because undo
 * can take orders back out of the draft.
 */
export const currentCoachStep = (facts: CoachFacts): CoachStep =>
  COACH_STEPS.find((step) => !isCoachStepDone(step.id, facts)) ?? COACH_STEPS.at(-1)!;

export const COACH_STORAGE_KEY = "roboarena.firstTurnCoach";

export const coachFinished = (storage: Pick<Storage, "getItem"> | undefined): boolean => {
  try {
    return storage?.getItem(COACH_STORAGE_KEY) === "done";
  } catch {
    return false;
  }
};

export const rememberCoach = (
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  finished: boolean,
): void => {
  try {
    if (finished) storage?.setItem(COACH_STORAGE_KEY, "done");
    else storage?.removeItem(COACH_STORAGE_KEY);
  } catch {
    // Storage blocked: the guide simply shows again next time.
  }
};
