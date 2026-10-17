import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FieldGuideButton } from "../../../components/help/HelpProvider";
import { MovieExperience } from "../../../components/MovieExperience";
import { SiteHeader } from "../../../components/site/SiteHeader";
import { createCannedMovie } from "../../../lib/replays/cannedMovie";
import { createLineupMovie, createShowcaseMovie } from "../../../lib/replays/showcaseMovie";

interface MoviePageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{ readonly t?: string }>;
}

const MOVIE_TITLES: Readonly<Record<string, string>> = {
  demo: "Replay demo",
  showcase: "Arena showcase",
  lineup: "Robot lineup",
};

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: MOVIE_TITLES[id] ?? "Turn movie" };
}

export default async function MoviePage({ params, searchParams }: MoviePageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (id !== "demo" && id !== "showcase" && id !== "lineup") notFound();
  const requestedTick = Number(query.t ?? 0);
  const initialTick = Number.isFinite(requestedTick) ? Math.max(0, requestedTick) : 0;
  if (id === "showcase") return <ShowcasePage initialTick={initialTick} />;
  if (id === "lineup") return <ShowcasePage initialTick={0} lineup />;
  const movie = await createCannedMovie();

  return (
    <main className="desktop-viewport-gate site-page site-dev-page">
      <SiteHeader label="Replay demo" rail>
        <FieldGuideButton />
      </SiteHeader>
      <div className="site-dev-head">
        <h1 className="site-display site-dev-title">After-action playback</h1>
        <p className="site-label">240 ticks · 12 fps · event order verified</p>
      </div>
      <div className="site-dev-grid">
        <div className="site-dev-movie">
          <MovieExperience
            initialState={movie.initialState}
            events={movie.events}
            initialTick={initialTick}
          />
        </div>
        <aside className="site-panel site-dev-brief" aria-labelledby="demo-brief-title">
          <h2 id="demo-brief-title" className="site-label">
            What to watch
          </h2>
          <ol>
            <li>Ember Rifle advances five tiles along the northern lane.</li>
            <li>A rifle hit shows the compact impact cue.</li>
            <li>The final blast uses the larger destruction effect.</li>
          </ol>
          <p className="site-fine">
            Scrubbing, idle skipping and playback speed only choose which recorded frame to show.
            They never change the result.
          </p>
        </aside>
      </div>
    </main>
  );
}

async function ShowcasePage({
  initialTick,
  lineup = false,
}: {
  readonly initialTick: number;
  readonly lineup?: boolean;
}) {
  const movie = lineup ? createLineupMovie() : createShowcaseMovie();
  return (
    <main className="site-page site-dev-page">
      <SiteHeader label={lineup ? "Robot lineup" : "Arena showcase"} rail>
        <FieldGuideButton />
      </SiteHeader>
      <div className="site-dev-head">
        <div className="site-field">
          <h1 className="site-display site-dev-title">Four-team melee</h1>
          <p className="site-fine">
            Turn {movie.turnNumber} of a seeded autoplay match on {movie.arenaName}, resolved by the
            real engine. Sixteen robots, every class, one turn.
          </p>
        </div>
        <p className="site-label">
          {movie.hits} hits · {movie.destroyed} destroyed
        </p>
      </div>
      <div className="site-dev-movie">
        <MovieExperience
          initialState={movie.initialState}
          events={movie.events}
          initialTick={initialTick}
        />
      </div>
    </main>
  );
}
