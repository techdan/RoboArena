import { useEffect, useRef, useState } from "react";

/**
 * Disclosure state for a small popover/menu: open flag plus a root ref that
 * closes the layer on Escape or any pointer press outside it. Shared by the
 * header {@link PlannerMenu} and the selector band's overflow menu so both
 * dismiss identically instead of each re-implementing the listener dance.
 */
export function useDisclosure() {
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

  return { open, setOpen, rootRef };
}
