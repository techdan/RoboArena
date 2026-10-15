/**
 * Pure helpers for rules revision 4, the original combat timing
 * (docs/re-map/timing.md, docs/spec.md §8).
 *
 * The resolver owns the 5-tick movie loop; this module holds the pieces that
 * do not need its state: the projectile queue order.
 */

/** Anything with an impact time that waits in the projectile queue. */
export interface QueuedImpact {
  readonly impactsAt: number;
}

/**
 * Queue insert, seg6:0x1AD3: records are kept sorted by impact time and a new
 * record goes before existing records with the same time (the walk at
 * seg6:0x1B31 only continues while `old < new`), so equal times land newest
 * first. Mutates and returns `queue`.
 */
export const insertImpact = <Impact extends QueuedImpact>(
  queue: Impact[],
  impact: Impact,
): Impact[] => {
  let index = 0;
  while (index < queue.length && queue[index]!.impactsAt < impact.impactsAt) index += 1;
  queue.splice(index, 0, impact);
  return queue;
};

/**
 * Removes and returns every queued impact due at `tick`, in queue order
 * (seg6:0x556F pops while the head's time is `<= now`, seg6:0x1CF6).
 */
export const takeDueImpacts = <Impact extends QueuedImpact>(
  queue: Impact[],
  tick: number,
): Impact[] => {
  let count = 0;
  while (count < queue.length && queue[count]!.impactsAt <= tick) count += 1;
  return queue.splice(0, count);
};
