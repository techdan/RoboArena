/**
 * Dependency-free live-fire arithmetic for resolver and planner explanations.
 * Implements docs/spec.md §6 "Planner targeting analysis".
 */

export interface LiveFireScoreBreakdown {
  readonly fireMode: "aim" | "scan";
  readonly coverAdjustment: number;
  readonly distanceAccuracyAdjustment: number;
  readonly weaponTerrainAdjustment: number;
  readonly scanStrength: number;
  readonly scanPenalty: number;
  readonly preClampSubtotal: number;
  readonly clampedScore: number;
  readonly damageStaggered: boolean;
  readonly scoreAfterDamageStagger: number;
  readonly targetOnAimedTile: boolean;
  readonly finalScore: number;
  readonly threshold: number;
  readonly chancePercent: number;
}

export interface DirectDamageRange {
  readonly rawMinimum: number;
  readonly rawMaximum: number;
  readonly coverAdjustment: number;
  readonly distanceAdjustment: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly bulletsPerClick: number;
}

export const distanceScoreAdjustment = (distance: number, accuracyBase: number): number => {
  if (distance > 12) return Math.floor(accuracyBase / 2) - 4;
  if (distance >= 7) return accuracyBase - 2;
  if (distance >= 3) return Math.floor(accuracyBase / 2) + (6 - distance);
  return accuracyBase + 2 * (3 - distance) + 2;
};

export const calculateLiveFireBreakdownFromFactors = (input: {
  readonly fireMode: "aim" | "scan";
  readonly coverAdjustment: number;
  readonly distanceAccuracyAdjustment: number;
  readonly weaponTerrainAdjustment: number;
  readonly scanStrength: number;
  readonly damageStaggered: boolean;
  readonly targetOnAimedTile: boolean;
  readonly hitThresholds: readonly number[];
}): LiveFireScoreBreakdown => {
  const scanPenalty = input.scanStrength <= 4 ? 4 : input.scanStrength <= 8 ? 2 : 0;
  const preClampSubtotal =
    input.coverAdjustment +
    input.distanceAccuracyAdjustment +
    input.weaponTerrainAdjustment -
    scanPenalty;
  const clampedScore = Math.max(0, Math.min(19, preClampSubtotal));
  const scoreAfterDamageStagger = input.damageStaggered ? clampedScore >> 1 : clampedScore;
  const finalScore = input.targetOnAimedTile
    ? scoreAfterDamageStagger
    : scoreAfterDamageStagger >> 1;
  const threshold = input.hitThresholds[finalScore] ?? 0;
  return {
    fireMode: input.fireMode,
    coverAdjustment: input.coverAdjustment,
    distanceAccuracyAdjustment: input.distanceAccuracyAdjustment,
    weaponTerrainAdjustment: input.weaponTerrainAdjustment,
    scanStrength: input.scanStrength,
    scanPenalty,
    preClampSubtotal,
    clampedScore,
    damageStaggered: input.damageStaggered,
    scoreAfterDamageStagger,
    targetOnAimedTile: input.targetOnAimedTile,
    finalScore,
    threshold,
    chancePercent: Math.round((threshold / 256) * 100),
  };
};

export const calculateDirectDamageRangeFromFactors = (input: {
  readonly rawMinimum: number;
  readonly rawMaximum: number;
  readonly coverAdjustment: number;
  readonly distanceAdjustment: number;
  readonly bulletsPerClick: number;
}): DirectDamageRange => ({
  ...input,
  minimum: Math.max(0, input.rawMinimum + input.coverAdjustment + input.distanceAdjustment),
  maximum: Math.max(0, input.rawMaximum + input.coverAdjustment + input.distanceAdjustment),
});
