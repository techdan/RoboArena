import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/**
 * Upper-left return path shown on standalone pages reached from the lobby
 * (Terrain lab, Replay demo). These App Router pages render without the
 * lobby's nav shell, so each needs its own inbound link home.
 */
export function LobbyBreadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <Link
        href="/"
        className="group inline-flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-white/45 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none"
      >
        <ArrowLeft
          aria-hidden="true"
          className="size-4 transition-transform group-hover:-translate-x-0.5"
        />
        <span>
          RoboArena <span className="text-white/25">/ Lobby</span>
        </span>
      </Link>
    </nav>
  );
}
