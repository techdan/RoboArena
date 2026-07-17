/** Immutable bounded undo/redo history for private local planner drafts. */

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  readonly limit: number;
}

export const createHistory = <T>(present: T, limit = 50): History<T> => ({
  past: [],
  present,
  future: [],
  limit,
});

export const pushHistory = <T>(history: History<T>, next: T): History<T> => ({
  ...history,
  past: [...history.past, history.present].slice(-history.limit),
  present: next,
  future: [],
});

export const undoHistory = <T>(history: History<T>): History<T> => {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
};

export const redoHistory = <T>(history: History<T>): History<T> => {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.limit),
    present: next,
    future: history.future.slice(1),
  };
};
