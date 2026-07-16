"use client";

import dynamic from "next/dynamic";
import type { MoviePlayerProps } from "../renderer/MoviePlayer";

const MoviePlayer = dynamic(
  () => import("../renderer/MoviePlayer").then((module) => module.MoviePlayer),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-[560px] place-items-center rounded-3xl border border-white/8 bg-white/[0.025]">
        <p className="eyebrow">Loading movie system…</p>
      </div>
    ),
  },
);

export function MovieExperience(props: MoviePlayerProps) {
  return <MoviePlayer {...props} />;
}
