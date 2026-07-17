"use client";

import type { ReactElement } from "react";

export function Tooltip({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactElement;
}) {
  return (
    <span className="help-tooltip" data-tooltip={label}>
      {children}
    </span>
  );
}
