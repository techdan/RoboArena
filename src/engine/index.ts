/**
 * RoboArena engine — public exports.
 *
 * The engine is pure TypeScript: no React, no DOM, no I/O. It consumes a
 * `MatchState` + `TurnOrders` and produces a `ResolvedTimeline` of
 * `ResolutionEvent`s. Every probabilistic decision goes through a seedable
 * `Rng` so replays are deterministic.
 *
 * Boundary rule (also enforced by the directory layout): the engine never
 * imports from `app/`, `components/`, or `renderer/`.
 */

export * from "./types.js";
export * from "./constants.js";
export * from "./rng.js";
export * from "./geometry.js";
export * from "./cover.js";
export * from "./catalog.js";
export * from "./movement.js";
export * from "./firing.js";
export * from "./blast.js";
