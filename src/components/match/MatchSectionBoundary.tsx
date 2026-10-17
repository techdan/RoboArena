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
      <div className="site-center">
        <section className="site-panel site-message" role="alert">
          <TriangleAlert className="site-message-icon" aria-hidden="true" />
          <p className="site-label" data-tone="rail">
            Something went wrong
          </p>
          <h1 className="site-display site-message-title">The {label} stopped unexpectedly</h1>
          <p>
            Your match is safe on the server. Reload this section to carry on.
            {this.props.section === "planner"
              ? " This also clears the local draft that may have caused the problem."
              : ""}
          </p>
          <div className="site-confirm-actions">
            <button
              type="button"
              className="site-button"
              data-variant="go"
              data-size="lg"
              onClick={() => {
                this.setState({ error: null });
                this.props.onRecover();
              }}
            >
              <RefreshCw size={16} aria-hidden="true" /> Reload the {label}
            </button>
          </div>
        </section>
      </div>
    );
  }
}
