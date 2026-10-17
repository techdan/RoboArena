import Link from "next/link";
import type { ReactNode } from "react";

/** Wordmark bar shared by every page outside the planner and movie. */
export function SiteHeader({
  label,
  rail = false,
  children,
}: {
  /** Page name shown beside the wordmark, e.g. "Arena atlas". */
  readonly label?: string;
  /** Draw the amber stand-rail line under the header. */
  readonly rail?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <header className="site-header" data-rail={rail ? "true" : "false"}>
      <Link href="/" className="site-wordmark" aria-label="RoboArena home">
        <span className="site-wordmark-glyph" aria-hidden="true">
          RA
        </span>
        <span aria-hidden="true">RoboArena</span>
      </Link>
      {label === undefined ? null : <span className="site-header-label">{label}</span>}
      {children === undefined ? null : <nav className="site-header-nav">{children}</nav>}
    </header>
  );
}
