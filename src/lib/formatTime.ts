import { TICKS_PER_SECOND } from "../engine/constants";

/** Format engine time for players without exposing the underlying tick clock. */
export const formatGameTime = (ticks: number): string =>
  `${(ticks / TICKS_PER_SECOND).toFixed(2)}s`;
