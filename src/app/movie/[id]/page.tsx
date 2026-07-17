import { Activity, Crosshair, Film, Gauge, MoveRight } from "lucide-react";
import { notFound } from "next/navigation";
import { MovieExperience } from "../../../components/MovieExperience";
import { createCannedMovie } from "../../../lib/replays/cannedMovie";

interface MoviePageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{ readonly t?: string }>;
}

export default async function MoviePage({ params, searchParams }: MoviePageProps) {
  const [{ id }, query, movie] = await Promise.all([params, searchParams, createCannedMovie()]);
  if (id !== "demo") notFound();
  const requestedTick = Number(query.t ?? 0);
  const initialTick = Number.isFinite(requestedTick) ? Math.max(0, requestedTick) : 0;

  return (
    <main className="min-h-screen overflow-hidden bg-[#0d100e] text-white">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1180px] px-8 py-9">
        <header className="mb-7 flex items-end justify-between border-b border-white/8 pb-6">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10">
                <Film aria-hidden="true" className="size-5 text-lime-300" />
              </span>
              <span className="eyebrow">RoboArena / Turn movie 01</span>
            </div>
            <h1 className="text-4xl font-black tracking-[-0.055em]">After-action playback</h1>
          </div>
          <div className="flex gap-7 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
            <span>
              <strong className="block text-base text-white">12</strong>FPS
            </span>
            <span>
              <strong className="block text-base text-white">240</strong>Ticks
            </span>
            <span>
              <strong className="block text-base text-emerald-300">Verified</strong>Event order
            </span>
          </div>
        </header>

        <div className="grid grid-cols-[auto_1fr] gap-6">
          <MovieExperience
            initialState={movie.initialState}
            events={movie.events}
            initialTick={initialTick}
          />
          <aside className="space-y-4">
            <section className="rounded-3xl border border-white/8 bg-white/[0.035] p-5">
              <p className="eyebrow mb-4">Sequence brief</p>
              <div className="space-y-4 text-sm leading-6 text-white/60">
                <p className="flex gap-3">
                  <MoveRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-emerald-300" />
                  Ember Rifle advances five tiles along the northern lane.
                </p>
                <p className="flex gap-3">
                  <Crosshair aria-hidden="true" className="mt-1 size-4 shrink-0 text-amber-300" />A
                  rifle hit demonstrates the compact impact cue.
                </p>
                <p className="flex gap-3">
                  <Activity aria-hidden="true" className="mt-1 size-4 shrink-0 text-red-300" />
                  The final blast uses the larger destruction treatment.
                </p>
              </div>
            </section>
            <section className="rounded-3xl border border-white/8 bg-gradient-to-br from-emerald-300/8 to-transparent p-5">
              <Gauge aria-hidden="true" className="mb-4 size-5 text-lime-300" />
              <h2 className="font-bold">Presentation is local</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">
                Scrubbing, idle compression, and playback speed only select deterministic snapshots.
                They never advance the match or alter its outcome.
              </p>
            </section>
          </aside>
        </div>
        <footer className="mt-6 flex justify-between border-t border-white/8 pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
          <span>PixiJS + GSAP / Phase 7</span>
          <span>Demo replay · Rubble Two</span>
        </footer>
      </div>
    </main>
  );
}
