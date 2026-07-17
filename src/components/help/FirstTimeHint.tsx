"use client";

import { Lightbulb, X } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "roboarena:help:planner-basics:v1";

export function FirstTimeHint() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(KEY) !== "dismissed");
    } catch {
      setVisible(true);
    }
  }, []);
  if (!visible) return null;
  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(KEY, "dismissed");
    } catch {
      /* In-memory dismissal still works. */
    }
  };
  return (
    <aside className="first-time-hint" aria-label="Planning basics">
      <Lightbulb aria-hidden="true" />
      <div>
        <strong>Program, then watch.</strong>
        <p>
          Select a robot, tap a movement destination, set posture, scan, or fire actions, review the
          timeline, then lock. Opponents never see your draft.
        </p>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss planning basics">
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
