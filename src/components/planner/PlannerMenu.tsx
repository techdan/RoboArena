"use client";

import { Menu } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Slim-header overflow menu (disclosure pattern). Holds the informational and
 * rarely used header items so the primary Save/Lock actions and the board keep
 * the space. Closes on Escape or any pointer press outside the menu.
 */
export function PlannerMenu({
  alert = false,
  children,
}: {
  readonly alert?: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target))
        setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="planner-menu" ref={rootRef}>
      <button
        type="button"
        className="planner-menu-button"
        aria-expanded={open}
        aria-label="Planner menu"
        data-alert={alert ? "true" : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Menu size={16} aria-hidden="true" />
      </button>
      {open ? <div className="planner-menu-dropdown">{children}</div> : null}
    </div>
  );
}
