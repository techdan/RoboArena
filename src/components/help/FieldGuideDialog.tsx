"use client";

import { BookOpen, Bot, Footprints, Map } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { helpTopicsForTab, type HelpTab, type HelpTopicId } from "../../lib/help/content";

const TABS: readonly { readonly id: HelpTab; readonly label: string; readonly icon: typeof Bot }[] =
  [
    { id: "robots", label: "Robots", icon: Bot },
    { id: "terrain", label: "Terrain", icon: Map },
    { id: "actions", label: "Actions", icon: Footprints },
  ];

export function FieldGuideDialog({
  initialTab,
  onClose,
  onTopic,
}: {
  readonly initialTab: HelpTab;
  readonly onClose: () => void;
  readonly onTopic: (id: HelpTopicId, trigger: HTMLElement) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div
      className="help-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="field-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-guide-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header>
          <div>
            <p className="eyebrow">Reference</p>
            <h2 id="field-guide-title">
              <BookOpen aria-hidden="true" /> Field Guide
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close Field Guide">
            ×
          </button>
        </header>
        <div className="field-guide-tabs" role="tablist" aria-label="Field Guide sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-active={tab === id}
              onClick={() => setTab(id)}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <div className="field-guide-list" role="tabpanel">
          {helpTopicsForTab(tab).map((topic) => (
            <article key={topic.id}>
              <div>
                <h3>{topic.title}</h3>
                <p>{topic.summary}</p>
              </div>
              <button type="button" onClick={(event) => onTopic(topic.id, event.currentTarget)}>
                Details
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
