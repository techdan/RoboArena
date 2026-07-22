"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface MatchSectionBoundaryProps {
  readonly children: ReactNode;
  readonly section: "planner" | "movie";
  readonly resetKey: string;
  readonly onRecover: () => void;
}

interface MatchSectionBoundaryState {
  readonly error: Error | null;
}

/** Keeps a renderer/planner failure from replacing the entire authenticated match shell. */
export class MatchSectionBoundary extends Component<
  MatchSectionBoundaryProps,
  MatchSectionBoundaryState
> {
  override state: MatchSectionBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): MatchSectionBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.section} section failed:`, error, info.componentStack);
  }

  override componentDidUpdate(previous: MatchSectionBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const label = this.props.section === "planner" ? "planner" : "turn movie";
    return (
      <section className="match-recovery-panel" role="alert">
        <TriangleAlert aria-hidden="true" />
        <p className="eyebrow">{label} recovery</p>
        <h1>The {label} stopped unexpectedly.</h1>
        <p>
          Your canonical room state remains on the room service. Reload it to recover this section;
          planner recovery also clears the local draft that may have caused the failure.
        </p>
        <button
          type="button"
          className="primary-action"
          onClick={() => {
            this.setState({ error: null });
            this.props.onRecover();
          }}
        >
          <RefreshCw size={16} aria-hidden="true" /> Recover from room state
        </button>
      </section>
    );
  }
}
