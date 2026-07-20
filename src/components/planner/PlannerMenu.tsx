"use client";

import { Menu } from "lucide-react";
import { type ReactNode } from "react";
import { useDisclosure } from "./useDisclosure";

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
  const { open, setOpen, rootRef } = useDisclosure();

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
