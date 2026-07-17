/** Planner draft reducer. Authoritative refreshes never silently replace dirty local work. */

import type { TurnOrders } from "../engine/types";
import { createHistory, pushHistory, redoHistory, undoHistory, type History } from "./history";

export interface PlannerState {
  readonly history: History<TurnOrders>;
  readonly authoritativeRevision: string;
  readonly dirty: boolean;
  readonly conflictRevision: string | null;
  readonly conflictOrders: TurnOrders | null;
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
  | { readonly type: "keep-local" }
  | { readonly type: "recover-conflict"; readonly orders: TurnOrders; readonly revision: string };

export const createPlannerState = (
  orders: TurnOrders,
  authoritativeRevision: string,
  conflictOrders: TurnOrders | null = null,
): PlannerState => ({
  history: createHistory(orders),
  authoritativeRevision,
  dirty: false,
  conflictRevision: conflictOrders === null ? null : authoritativeRevision,
  conflictOrders,
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
      if (state.dirty) {
        if (state.history.present.turnNumber !== action.orders.turnNumber) {
          return {
            ...createPlannerState(action.orders, action.revision, state.history.present),
            conflictRevision: action.revision,
          };
        }
        return {
          ...state,
          conflictRevision: action.revision,
          conflictOrders: state.history.present,
        };
      }
      return createPlannerState(action.orders, action.revision);
    case "accept-authoritative":
      return createPlannerState(action.orders, action.revision);
    case "keep-local":
      if (
        state.conflictOrders !== null &&
        state.conflictOrders.turnNumber !== state.history.present.turnNumber
      ) {
        return state;
      }
      return {
        ...state,
        authoritativeRevision: state.conflictRevision ?? state.authoritativeRevision,
        conflictRevision: null,
        conflictOrders: null,
      };
    case "recover-conflict":
      return {
        ...createPlannerState(action.orders, action.revision),
        dirty: true,
      };
  }
};
