"use client";

import { useMemo, useState } from "react";
import type { ParticipantResolutionEvent } from "../../lib/net/protocol";
import { explainEvents, type EventCategory } from "../../lib/explain/events";

type Filter = "all" | EventCategory;
const FILTERS: readonly Filter[] = ["all", "combat", "movement", "contacts", "system"];

export function EventInspector({
  events,
}: {
  readonly events: readonly ParticipantResolutionEvent[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const lines = useMemo(() => explainEvents(events), [events]);
  const visible = filter === "all" ? lines : lines.filter((line) => line.category === filter);
  return (
    <section className="match-panel turn-explanation">
      <p className="eyebrow">Authorized turn log</p>
      <h2>What happened</h2>
      <div className="event-filters" aria-label="Event filters">
        {FILTERS.map((choice) => (
          <button
            key={choice}
            type="button"
            data-active={filter === choice}
            aria-pressed={filter === choice}
            onClick={() => setFilter(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p>No observable {filter === "all" ? "" : `${filter} `}events occurred this turn.</p>
      ) : (
        <ol>
          {visible.map((line) => (
            <li key={line.key} data-category={line.category}>
              <time>{line.tick}t</time>
              <span>
                <strong>{line.title}</strong>
                {line.detail}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
