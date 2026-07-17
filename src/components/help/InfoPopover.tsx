"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { helpTopic, type HelpTopicId } from "../../lib/help/content";

export interface PopoverAnchor {
  readonly x: number;
  readonly y: number;
}

export function InfoPopover({
  topicId,
  anchor,
  onClose,
}: {
  readonly topicId: HelpTopicId;
  readonly anchor: PopoverAnchor;
  readonly onClose: () => void;
}) {
  const topic = helpTopic(topicId);
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    const bounds = dialog?.getBoundingClientRect();
    if (bounds === undefined) return;
    setPosition({
      x: Math.max(12, Math.min(anchor.x, window.innerWidth - bounds.width - 12)),
      y: Math.max(12, Math.min(anchor.y, window.innerHeight - bounds.height - 12)),
    });
  }, [anchor, topicId]);
  useEffect(() => {
    const dialog = ref.current;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (dialog?.open) dialog.close();
    };
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className="info-popover"
      aria-labelledby="info-popover-title"
      style={{ left: position.x, top: position.y }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDownCapture={(event) => {
        const closeBounds = closeRef.current?.getBoundingClientRect();
        if (
          closeBounds !== undefined &&
          event.clientX >= closeBounds.left &&
          event.clientX <= closeBounds.right &&
          event.clientY >= closeBounds.top &&
          event.clientY <= closeBounds.bottom
        ) {
          event.preventDefault();
          onClose();
        }
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <button
        ref={closeRef}
        className="info-popover-close"
        type="button"
        onClick={onClose}
        aria-label={`Close ${topic.title} details`}
      >
        <X size={16} aria-hidden="true" />
      </button>
      <header>
        <div>
          <p className="eyebrow">{topic.tab}</p>
          <h2 id="info-popover-title">{topic.title}</h2>
        </div>
      </header>
      <p>{topic.summary}</p>
      {topic.facts.length === 0 ? null : (
        <dl>
          {topic.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul>
        {topic.details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
    </dialog>
  );
}
