/** Planner draft reducer. Authoritative refreshes never silently replace dirty local work. */

import type { TurnOrders } from "../engine/types";
import { createHistory, pushHistory, redoHistory, undoHistory, type History } from "./history";

export interface PlannerState {
  readonly history: History<TurnOrders>;
  readonly authoritativeRevision: string;
  readonly dirty: boolean;
  readonly conflictRevision: string | null;
}

export type PlannerAction =
  | { readonly type: "edit"; readonly orders: TurnOrders }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | {
      readonly type: "authoritative-refresh";
      readonly revision: string;
      readonly orders: TurnOrders;
    }
  | {
      readonly type: "accept-authoritative";
      readonly orders: TurnOrders;
      readonly revision: string;
    }
  | { readonly type: "keep-local" };

export const createPlannerState = (
  orders: TurnOrders,
  authoritativeRevision: string,
): PlannerState => ({
  history: createHistory(orders),
  authoritativeRevision,
  dirty: false,
  conflictRevision: null,
});

export const plannerReducer = (state: PlannerState, action: PlannerAction): PlannerState => {
  switch (action.type) {
    case "edit":
      return { ...state, history: pushHistory(state.history, action.orders), dirty: true };
    case "undo":
      return { ...state, history: undoHistory(state.history), dirty: true };
    case "redo":
      return { ...state, history: redoHistory(state.history), dirty: true };
    case "authoritative-refresh":
      if (action.revision === state.authoritativeRevision) return state;
      if (state.dirty) return { ...state, conflictRevision: action.revision };
      return createPlannerState(action.orders, action.revision);
    case "accept-authoritative":
      return createPlannerState(action.orders, action.revision);
    case "keep-local":
      return {
        ...state,
        authoritativeRevision: state.conflictRevision ?? state.authoritativeRevision,
        conflictRevision: null,
      };
  }
};
