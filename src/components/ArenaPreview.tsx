"use client";

import dynamic from "next/dynamic";
import { Grid3X3, MapPinned, ScanLine, ShieldCheck } from "lucide-react";
import type { Arena } from "../engine/types";

const PixiArena = dynamic(
  () => import("../renderer/PixiArena").then((module) => module.PixiArena),
  { ssr: false },
);

export interface ArenaPreviewProps {
  readonly arena: Arena;
  readonly sourceHash: string;
}

export function ArenaPreview({ arena, sourceHash }: ArenaPreviewProps) {
  const homeSize = arena.homeAreas[0]?.tiles.length ?? 0;

  return (
    <article className="arena-card">
      <header className="flex items-start justify-between gap-6 px-1 pb-4">
        <div>
          <p className="eyebrow">Verified town map</p>
          <h2 className="mt-1 text-2xl font-black tracking-[-0.045em] text-white">
            {arena.sizeName}
          </h2>
        </div>
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200">
          Row-major
        </span>
      </header>

      <div className="overflow-auto rounded-[20px] border border-white/5 bg-black/20 p-2">
        <PixiArena arena={arena} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Metric icon={Grid3X3} label="Grid" value={`${arena.width} × ${arena.height}`} />
        <Metric icon={MapPinned} label="Tiles" value={String(arena.width * arena.height)} />
        <Metric icon={ShieldCheck} label="Home tiles" value={String(homeSize)} />
        <Metric icon={ScanLine} label="MAP hash" value={sourceHash.slice(0, 8)} mono />
      </dl>
    </article>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  readonly icon: typeof Grid3X3;
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.035] p-3">
      <dt className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
        <Icon aria-hidden="true" className="size-3.5 text-emerald-300/70" />
        {label}
      </dt>
      <dd className={`mt-1.5 text-sm font-semibold text-white/85 ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
