/**
 * Stepped heading and posture changes (re-map/commands.md §9).
 *
 * The original planner (seg80:0x0422, seg80:0x0352) and AI (seg30:0x13A2,
 * seg30:0x12DD) never jump straight to a new heading or posture. A heading
 * change emits one record per octant, the shortest way round, and
 * Upright↔Crouching emits Ducking first. Type-only imports keep this module
 * usable from the client planner.
 */

import type { Heading, Posture } from "./types.js";

const HEADING_ORDER: readonly Heading[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const POSTURE_ORDER: readonly Posture[] = ["upright", "ducking", "crouching"];

/**
 * Headings passed through when turning, ending with `to`. A half turn goes
 * clockwise: the step is +1 when 0 ≤ Δ ≤ 4 or Δ ≤ −4, else −1.
 */
export const headingTurnSteps = (from: Heading, to: Heading): Heading[] => {
  const start = HEADING_ORDER.indexOf(from);
  const end = HEADING_ORDER.indexOf(to);
  const delta = end - start;
  if (delta === 0) return [];
  const step = (delta >= 0 && delta <= 4) || delta <= -4 ? 1 : -1;
  const steps: Heading[] = [];
  for (let index = start; index !== end;) {
    index = (index + step + 8) % 8;
    steps.push(HEADING_ORDER[index]!);
  }
  return steps;
};

/** Postures passed through, ending with `to`; Upright↔Crouching goes via Ducking. */
export const postureChangeSteps = (from: Posture, to: Posture): Posture[] => {
  const delta = POSTURE_ORDER.indexOf(to) - POSTURE_ORDER.indexOf(from);
  if (delta === 0) return [];
  return Math.abs(delta) < 2 ? [to] : ["ducking", to];
};
