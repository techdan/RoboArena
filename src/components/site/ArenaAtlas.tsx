"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Arena } from "../../engine/types";
import {
  ARENA_CATALOG,
  ARENA_TOWNS,
  arenaProvenance,
  loadArena,
  type ArenaName,
} from "../../lib/arenas";
import { terrainCounts } from "../../lib/presentation/arenaSchematic";
import { ArenaSchematic, type SchematicHome } from "./ArenaSchematic";

// The original-tile Pixi view is optional, so it only loads when chosen.
const PixiArena = dynamic(
  () => import("../../renderer/PixiArena").then((module) => module.PixiArena),
  { ssr: false, loading: () => <p className="site-fine">Loading classic tiles…</p> },
);

const OPEN_CORNERS: Readonly<Record<"NW" | "NE" | "SE" | "SW", SchematicHome>> = {
  NW: {},
  NE: {},
  SE: {},
  SW: {},
};

const shortName = (name: string): string => name.replace(/^(Rubble|Suburb|Computer) /, "");

/** Every original map, drawn with the same illustrated view the lobby uses. */
export function ArenaAtlas({ initial = "rubble-two" }: { readonly initial?: ArenaName }) {
  const [arenas, setArenas] = useState<ReadonlyMap<ArenaName, Arena>>(new Map());
  const [selected, setSelected] = useState<ArenaName>(initial);
  const [view, setView] = useState<"illustrated" | "classic">("illustrated");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      ARENA_CATALOG.map(async (entry) => [entry.slug, await loadArena(entry.slug)] as const),
    ).then((loaded) => {
      if (!cancelled) setArenas(new Map(loaded));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const entry = ARENA_CATALOG.find((candidate) => candidate.slug === selected)!;
  const arena = arenas.get(selected);
  const counts = useMemo(() => (arena === undefined ? undefined : terrainCounts(arena)), [arena]);
  const provenance = arenaProvenance(selected);
  const townLabel = ARENA_TOWNS.find(({ town }) => town === entry.town)?.label ?? entry.town;

  return (
    <div className="site-atlas">
      <div className="site-atlas-list">
        {ARENA_TOWNS.map(({ town, label }) => {
          const maps = ARENA_CATALOG.filter((candidate) => candidate.town === town);
          return (
            <section key={town} className="site-atlas-town" aria-labelledby={`atlas-${town}`}>
              <h2 id={`atlas-${town}`} className="site-atlas-town-title">
                {label}
                <span className="site-label">{maps.length} maps</span>
              </h2>
              <ul className="site-atlas-thumbs">
                {maps.map((candidate) => {
                  const loaded = arenas.get(candidate.slug);
                  return (
                    <li key={candidate.slug}>
                      <button
                        type="button"
                        className="site-atlas-thumb"
                        aria-pressed={candidate.slug === selected}
                        aria-label={`${candidate.name}, ${candidate.width} by ${candidate.height}`}
                        onClick={() => setSelected(candidate.slug)}
                      >
                        <span className="site-atlas-thumb-art">
                          {loaded === undefined ? null : <ArenaSchematic arena={loaded} label="" />}
                        </span>
                        <span className="site-atlas-thumb-name" aria-hidden="true">
                          {shortName(candidate.name)}
                          <small>
                            {candidate.width}×{candidate.height}
                          </small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <section
        className="site-atlas-detail"
        aria-labelledby="atlas-detail-title"
        aria-live="polite"
      >
        <p className="site-label" data-tone="rail">
          {townLabel} · {entry.width} × {entry.height}
        </p>
        <h1 id="atlas-detail-title" className="site-display site-atlas-title">
          {entry.name}
        </h1>
        <div className="site-tabs site-atlas-view" role="group" aria-label="Map view">
          <button
            type="button"
            className="site-tab"
            aria-pressed={view === "illustrated"}
            onClick={() => setView("illustrated")}
          >
            Illustrated
          </button>
          <button
            type="button"
            className="site-tab"
            aria-pressed={view === "classic"}
            onClick={() => setView("classic")}
          >
            Classic tiles
          </button>
        </div>
        <div className="site-atlas-art">
          {arena === undefined ? (
            <div className="site-schematic site-schematic-placeholder" aria-hidden="true" />
          ) : view === "illustrated" ? (
            <ArenaSchematic
              arena={arena}
              homes={OPEN_CORNERS}
              label={`${entry.name} map with its four home corners`}
            />
          ) : (
            <div className="site-atlas-classic">
              <PixiArena arena={arena} />
            </div>
          )}
        </div>
        <dl className="site-stats" data-columns="5">
          <div>
            <dt className="site-label">Walls</dt>
            <dd>{counts?.walls ?? "–"}</dd>
          </div>
          <div>
            <dt className="site-label">Low walls</dt>
            <dd>{counts?.lowWalls ?? "–"}</dd>
          </div>
          <div>
            <dt className="site-label">Bushes</dt>
            <dd>{counts?.bushes ?? "–"}</dd>
          </div>
          <div>
            <dt className="site-label">Rough</dt>
            <dd>{counts?.rough ?? "–"}</dd>
          </div>
          <div>
            <dt className="site-label">Crevices</dt>
            <dd>{counts?.crevices ?? "–"}</dd>
          </div>
        </dl>
        <ul className="site-legend" aria-label="Map key">
          <li data-key="wall">Wall</li>
          <li data-key="low-wall">Low wall</li>
          <li data-key="bush">Bush</li>
          <li data-key="rough">Rough ground</li>
          <li data-key="crevice">Crevice</li>
          <li data-key="home">Home corner</li>
        </ul>
        <p className="site-fine">
          Decoded row by row from the original {provenance.source} (map {provenance.mapId}, SHA-256{" "}
          {provenance.sourceSha256.slice(0, 12)}…).
        </p>
      </section>
    </div>
  );
}
