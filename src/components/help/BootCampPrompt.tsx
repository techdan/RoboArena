"use client";

import { ArrowRight, GraduationCap, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  bootCampHref,
  rememberBootCamp,
  shouldShowBootCampPrompt,
} from "../../lib/help/bootCampStorage";
import { RobotPortrait } from "./RobotPortrait";

/** First-visit invitation to Boot Camp; dismissal is remembered per browser. */
export function BootCampPrompt({ returnTo }: { readonly returnTo?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(shouldShowBootCampPrompt());
  }, []);
  if (!visible) return null;
  return (
    <aside className="boot-camp-prompt" aria-label="New player Boot Camp">
      <div className="boot-camp-prompt-art" aria-hidden="true">
        <RobotPortrait robotClass="rifle" size={52} />
        <RobotPortrait robotClass="burst" size={52} />
        <RobotPortrait robotClass="auto" size={52} />
        <RobotPortrait robotClass="missile" size={52} />
      </div>
      <div className="boot-camp-prompt-copy">
        <p className="eyebrow">
          <GraduationCap size={13} aria-hidden="true" /> New to RoboArena?
        </p>
        <p>
          <strong>Take the two-minute Boot Camp:</strong> your four robot classes, weapons and
          cover, and a plan for your first turn.
        </p>
      </div>
      <Link className="primary-action" href={bootCampHref(returnTo)}>
        Start Boot Camp
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
      <button
        type="button"
        className="boot-camp-prompt-close"
        aria-label="Dismiss Boot Camp invitation"
        onClick={() => {
          setVisible(false);
          rememberBootCamp("dismissed");
        }}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

/** Always-available way back into Boot Camp. */
export function BootCampLink({
  returnTo,
  newTab = false,
}: {
  readonly returnTo?: string;
  readonly newTab?: boolean;
}) {
  return (
    <Link
      className="field-guide-button boot-camp-link"
      href={bootCampHref(returnTo)}
      {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
    >
      <GraduationCap size={15} aria-hidden="true" /> Boot Camp
      {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </Link>
  );
}
