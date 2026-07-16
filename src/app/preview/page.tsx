import { Layers3, Radar } from "lucide-react";
import { ArenaPreview } from "../../components/ArenaPreview";
import { arenaProvenance, loadArena } from "../../lib/arenas";

export default async function PreviewPage() {
  const [rubbleTwo, rubbleThree] = await Promise.all([
    loadArena("rubble-two"),
    loadArena("rubble-three"),
  ]);
  const sourceHash = arenaProvenance("rubble-three").sourceSha256;

  return (
    <main className="min-h-screen overflow-hidden bg-[#0d100e] text-white">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1280px] px-8 py-10 2xl:px-4">
        <header className="mb-8 flex items-end justify-between gap-8 border-b border-white/8 pb-7">
          <div className="max-w-3xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/10">
                <Radar aria-hidden="true" className="size-5 text-emerald-300" />
              </span>
              <span className="eyebrow">RoboArena / Terrain lab</span>
            </div>
            <h1 className="text-5xl font-black leading-[0.95] tracking-[-0.065em] text-balance">
              Original geometry.
              <span className="block text-white/35">Modern battlefield.</span>
            </h1>
          </div>
          <div className="hidden max-w-xs items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.035] p-4 lg:flex">
            <Layers3 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-lime-300" />
            <p className="text-sm leading-6 text-white/55">
              Source-locked Rubble maps, decoded row by row and rendered as cached SVG textures.
            </p>
          </div>
        </header>

        <section aria-label="Imported arena previews" className="arena-grid">
          <ArenaPreview arena={rubbleTwo} sourceHash={sourceHash} />
          <ArenaPreview arena={rubbleThree} sourceHash={sourceHash} />
        </section>

        <footer className="mt-7 flex items-center justify-between border-t border-white/8 pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">
          <span>PixiJS static renderer / Phase 6</span>
          <span>RUBBLE.TWN · {sourceHash.slice(0, 12)}</span>
        </footer>
      </div>
    </main>
  );
}
