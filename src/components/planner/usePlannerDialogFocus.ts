"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "select:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Owns focus containment, Escape, and opener restoration for planner dialogs. */
export const usePlannerDialogFocus = <T extends HTMLElement>(onCancel: () => void) => {
  const dialogRef = useRef<T>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    const initial = dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]");
    (initial ?? focusable()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Outside-press dismissal is armed only after a frame. A board tap that
    // opens the dialog is followed by a touch-compatibility ghost mousedown at
    // the same point (now over the backdrop); that ghost fires before the frame
    // and must not immediately re-close the dialog. Genuine later presses do.
    let armed = false;
    const raf = requestAnimationFrame(() => {
      armed = true;
    });
    const onPointerDownOutside = (event: PointerEvent) => {
      if (!armed) return;
      if (!dialog.contains(event.target as Node)) onCancelRef.current();
    };

    dialog.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDownOutside, true);
    return () => {
      cancelAnimationFrame(raf);
      dialog.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDownOutside, true);
      opener?.focus();
    };
  }, []);

  return dialogRef;
};
