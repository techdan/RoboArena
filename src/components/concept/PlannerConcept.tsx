"use client";

/** Design-review mock of the 3D turn planner (debug route /planner-concept).
 *  The arena, robots and every overlay are the real 3D renderer; the HTML chrome
 *  is a static mock of the proposed layout. `?shot=` picks a scene:
 *  overview | command | aim | rehearse. Not wired to a room.
 */

import { useEffect, useRef, useState } from "react";
import type { Heading } from "../../engine/types";
import type { PlannerConcept as Concept, ConceptRobot } from "../../lib/replays/plannerConcept";
import { buildMovieTimeline } from "../../renderer/animations";
import type { BattleScene3D } from "../../renderer3d/BattleScene3D";
import { headingYaw } from "../../renderer3d/kinematics";
import type { ArenaThemeId } from "../../renderer3d/themes";

export type ConceptShot = "overview" | "command" | "aim" | "rehearse";

const CLASS_LABEL: Record<string, string> = {
  rifle: "Rifle",
  burst: "Burst",
  auto: "Machine gun",
  missile: "Missile",
};
const CHASSIS: Record<string, string> = {
  rifle: "Strider",
  burst: "Hound",
  auto: "Crab",
  missile: "Titan",
};
const SELECTED: Record<ConceptShot, string> = {
  overview: "red-rifle",
  command: "red-burst",
  aim: "red-rifle",
  rehearse: "red-rifle",
};

const CAMERAS: Record<
  ConceptShot,
  { from: [number, number, number]; to: [number, number, number] }
> = {
  overview: { from: [12.5, 21, 37], to: [12.5, 0, 14.5] },
  command: { from: [12.5, 11, 31], to: [12, 0, 19.5] },
  aim: { from: [12, 13.5, 29], to: [11.5, 0, 13.5] },
  rehearse: { from: [12.5, 21, 37], to: [12.5, 0, 14.5] },
};

export function PlannerConcept({
  concept,
  shot,
  theme,
}: {
  readonly concept: Concept;
  readonly shot: ConceptShot;
  readonly theme: ArenaThemeId;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const selectedId = SELECTED[shot];
  const selected = concept.robots.find((robot) => robot.id === selectedId)!;

  useEffect(() => {
    let disposed = false;
    let scene: BattleScene3D | undefined;
    const host = hostRef.current;
    if (host === null) return;
    void (async () => {
      const { BattleScene3D } = await import("../../renderer3d/BattleScene3D");
      const rehearse = shot === "rehearse";
      const state = {
        ...concept.state,
        teams: concept.state.teams.map((team, index) =>
          index !== 0
            ? team
            : {
                ...team,
                robots: team.robots.map((robot) => {
                  const plan = concept.robots.find((r) => r.id === robot.id)!;
                  return { ...robot, position: rehearse ? plan.rehearsal : plan.start };
                }),
              },
        ),
      };
      const capture = new URLSearchParams(window.location.search).has("capture");
      scene = await BattleScene3D.create(host, state, buildMovieTimeline(state, []), {
        manualClock: capture,
        theme,
      });
      if (disposed) {
        scene.dispose();
        return;
      }
      scene.render(0, { animate: false, speed: 1, reducedMotion: false });
      decorate(scene, concept, shot, selected);
      const camera = CAMERAS[shot];
      scene.lookFrom(
        { x: camera.from[0], y: camera.from[1], z: camera.from[2] },
        { x: camera.to[0], y: camera.to[1], z: camera.to[2] },
      );
      scene.resize();
      if (capture) scene.advance(1.2);
      setAnchor(scene.screenOf(shot === "command" ? selected.start : selected.end, 0.9));
      (window as unknown as { __planner3d?: unknown }).__planner3d = scene;
      setReady(true);
    })();
    return () => {
      disposed = true;
      scene?.dispose();
    };
  }, [concept, shot, selected, theme]);

  const seconds = (ticks: number) => (ticks / 60).toFixed(1).replace(/\.0$/, "");
  const budget = concept.budgetTicks;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#06080b] text-white" data-ready={ready}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* Top bar: turn, budget summary, rehearse and lock. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent px-6 pb-10 pt-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/45">
            Turn 3 · Your orders
          </p>
          <h1 className="text-2xl font-black tracking-[-0.04em]">Plan your 15 seconds</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-white/60 backdrop-blur">
            3 of 4 robots fully planned
          </span>
          <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold backdrop-blur">
            ▶ Rehearse
          </span>
          <span className="rounded-full bg-lime-300 px-5 py-2 text-sm font-black text-black shadow-[0_0_30px_rgba(190,242,100,0.45)]">
            Lock orders
          </span>
        </div>
      </header>

      {/* Squad rail. */}
      <aside className="absolute left-4 top-24 w-[214px] space-y-2">
        {concept.robots.map((robot, index) => (
          <SquadCard
            key={robot.id}
            robot={robot}
            index={index}
            selected={robot.id === selectedId}
            budget={budget}
            color={concept.teamColor}
          />
        ))}
        <div className="rounded-xl border border-white/8 bg-black/45 px-3 py-2 text-[11px] leading-5 text-white/50 backdrop-blur">
          <p className="font-bold text-white/70">Intel</p>
          <p>
            <span className="text-red-300">◆</span> 2 enemies in sight
          </p>
          <p>
            <span className="text-red-300">✕</span> 1 last seen (turn 2)
          </p>
        </div>
      </aside>

      {shot === "command" && anchor !== null && <RadialMenu at={anchor} />}
      {shot === "aim" && <ShotCard concept={concept} />}
      {shot === "aim" && anchor !== null && (
        <div
          className="absolute -translate-x-1/2 -translate-y-full rounded-md bg-black/70 px-2 py-1 font-mono text-[10px] text-white/80"
          style={{ left: anchor.x, top: anchor.y - 8 }}
        >
          Lance fires from here at 5.5 s
        </div>
      )}
      {(shot === "overview" || shot === "rehearse") && anchor !== null && (
        <div
          className="absolute -translate-x-1/2 -translate-y-full rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[11px] text-white/85 backdrop-blur"
          style={{ left: anchor.x, top: anchor.y - 10 }}
        >
          Lance ends here · facing N
        </div>
      )}

      {/* Turn track. */}
      <section className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/10 bg-[#0a0d12]/80 px-4 pb-3 pt-2 backdrop-blur-md">
        <div className="mb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
          <span>Turn track · all robots</span>
          <span>
            {shot === "rehearse"
              ? `Rehearsing · ${seconds(concept.rehearsalTick)} s`
              : "Drag the playhead to rehearse"}
          </span>
        </div>
        <div className="relative pl-[86px]">
          <div className="relative mb-1 h-4">
            {Array.from({ length: 16 }, (_, s) => (
              <span
                key={s}
                className="absolute -translate-x-1/2 font-mono text-[9px] text-white/35"
                style={{ left: `${(s / 15) * 100}%` }}
              >
                {s}
              </span>
            ))}
          </div>
          {concept.robots.map((robot) => (
            <Lane
              key={robot.id}
              robot={robot}
              budget={budget}
              selected={robot.id === selectedId}
              color={concept.teamColor}
            />
          ))}
          <div
            className="absolute bottom-0 top-4 w-0.5 bg-white shadow-[0_0_12px_white]"
            style={{
              left: `calc(86px + (100% - 86px) * ${shot === "rehearse" ? concept.rehearsalTick / budget : 0})`,
            }}
          >
            <span className="absolute -left-[5px] -top-1.5 size-3 rounded-full bg-white" />
          </div>
        </div>
      </section>
    </main>
  );
}

function decorate(
  scene: BattleScene3D,
  concept: Concept,
  shot: ConceptShot,
  selected: ConceptRobot,
) {
  const overlays = scene.overlays;
  const color = concept.teamColor;
  for (const robot of concept.robots)
    scene.faceRobot(
      robot.id,
      headingYaw(shot === "rehearse" ? robot.endHeading : robot.startHeading),
    );
  for (const contact of concept.contacts) scene.faceRobot(contact.id, headingYaw("S"));
  if (shot === "aim") {
    overlays.heatmap(concept.heat);
    overlays.wedge(
      concept.shot.from,
      headingYaw(concept.shot.heading),
      Math.PI / 2,
      concept.shot.range,
      "#fef08a",
    );
    overlays.aim(concept.shot.from, concept.shot.target, "#fde047");
  }
  for (const robot of concept.robots) {
    const isSelected = robot.id === selected.id;
    const emphasis = isSelected ? "selected" : shot === "aim" ? "dim" : "normal";
    overlays.route({ tiles: robot.route, color, secondMarks: robot.secondMarks, emphasis });
    if (robot.route.length > 1 || shot !== "command")
      scene.addGhost(
        robot.robotClass,
        color,
        robot.end,
        headingYaw(robot.endHeading as Heading),
        robot.endPosture,
        isSelected ? 0.42 : shot === "aim" ? 0.12 : 0.24,
      );
    if (shot !== "aim" && robot.aimAt !== undefined)
      overlays.aim(robot.end, robot.aimAt, "#fbbf24", robot.robotClass === "missile");
  }
  if (shot === "command") overlays.selection(selected.start, color);
  else overlays.selection(shot === "rehearse" ? selected.rehearsal : selected.end, color);
  for (const contact of concept.contacts) overlays.contact(contact.tile);
  for (const tile of concept.lastKnown) overlays.lastKnown(tile);
}

function SquadCard({
  robot,
  index,
  selected,
  budget,
  color,
}: {
  readonly robot: ConceptRobot;
  readonly index: number;
  readonly selected: boolean;
  readonly budget: number;
  readonly color: string;
}) {
  const used = Math.min(1, robot.usedTicks / budget);
  return (
    <div
      className={`rounded-xl border px-3 py-2 backdrop-blur ${selected ? "border-white/40 bg-white/12" : "border-white/8 bg-black/45"}`}
      style={selected ? { boxShadow: `0 0 0 1px ${color}, 0 0 24px ${color}55` } : undefined}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-black">
          <span className="mr-1.5 font-mono text-[10px] text-white/40">{index + 1}</span>
          {robot.name}
        </p>
        <p className="font-mono text-[10px] uppercase text-white/45">
          {CHASSIS[robot.robotClass]} · {CLASS_LABEL[robot.robotClass]}
        </p>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full"
            style={{ width: `${used * 100}%`, background: color }}
          />
        </div>
        <span className="font-mono text-[10px] text-white/60">
          {(robot.usedTicks / 60).toFixed(1)}/{budget / 60}s
        </span>
      </div>
    </div>
  );
}

const BLOCK_STYLE: Record<string, string> = {
  move: "",
  "set-posture": "bg-slate-400/70 text-black",
  "set-scan-direction": "bg-slate-400/70 text-black",
  "aim-and-fire": "bg-amber-300 text-black",
  "scan-and-fire": "bg-cyan-300/80 text-black",
  deploy: "bg-slate-300 text-black",
};

function Lane({
  robot,
  budget,
  selected,
  color,
}: {
  readonly robot: ConceptRobot;
  readonly budget: number;
  readonly selected: boolean;
  readonly color: string;
}) {
  return (
    <div className="relative flex h-7 items-center">
      <span
        className={`absolute -left-[86px] w-[80px] truncate text-xs font-bold ${selected ? "text-white" : "text-white/50"}`}
      >
        {robot.name}
      </span>
      <div
        className={`relative h-5 w-full rounded-md ${selected ? "bg-white/10" : "bg-white/[0.04]"}`}
      >
        {robot.lane.map((block, i) => (
          <span
            key={i}
            className={`absolute top-0 flex h-5 items-center overflow-hidden rounded-[4px] px-1.5 text-[10px] font-bold ${BLOCK_STYLE[block.kind] ?? ""}`}
            style={{
              left: `${(block.startTick / budget) * 100}%`,
              width: `calc(${((block.endTick - block.startTick) / budget) * 100}% - 2px)`,
              ...(block.kind === "move" ? { background: `${color}cc`, color: "white" } : {}),
            }}
          >
            {block.label}
          </span>
        ))}
        {robot.usedTicks < budget && (
          <span
            className="absolute top-0 flex h-5 items-center px-2 text-[10px] text-white/30"
            style={{ left: `${(robot.usedTicks / budget) * 100}%` }}
          >
            {((budget - robot.usedTicks) / 60).toFixed(1)} s free
          </span>
        )}
      </div>
    </div>
  );
}

function RadialMenu({ at }: { readonly at: { x: number; y: number } }) {
  const items = [
    { label: "Move", key: "M", angle: -90, hot: true },
    { label: "Aim", key: "A", angle: -30 },
    { label: "Scan & fire", key: "S", angle: 30 },
    { label: "Duck / Prone", key: "D", angle: 90 },
    { label: "Face", key: "F", angle: 150 },
    { label: "Wait", key: "W", angle: 210 },
  ];
  const radius = 92;
  return (
    <div className="pointer-events-none absolute" style={{ left: at.x, top: at.y }}>
      <div className="absolute -left-[60px] -top-[60px] size-[120px] rounded-full border border-white/15 bg-black/20" />
      {items.map((item) => {
        const rad = (item.angle * Math.PI) / 180;
        return (
          <div
            key={item.label}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-bold backdrop-blur ${item.hot ? "border-lime-300 bg-lime-300 text-black" : "border-white/20 bg-black/70 text-white"}`}
            style={{ left: Math.cos(rad) * radius, top: Math.sin(rad) * radius }}
          >
            {item.label}
            <kbd className="rounded bg-black/20 px-1 font-mono text-[9px] opacity-60">
              {item.key}
            </kbd>
          </div>
        );
      })}
    </div>
  );
}

function ShotCard({ concept }: { readonly concept: Concept }) {
  const shot = concept.shot;
  return (
    <aside className="absolute right-4 top-24 w-[250px] rounded-2xl border border-amber-200/25 bg-black/65 p-4 backdrop-blur-md">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/70">
        Aim · Lance
      </p>
      <p className="mt-1 text-sm font-bold">Blue Rifle at {shot.distance} tiles</p>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-5xl font-black tracking-[-0.06em] text-amber-200">
          {shot.chancePercent}%
        </span>
        <span className="pb-2 text-xs text-white/50">to hit, per shot</span>
      </div>
      <dl className="mt-3 space-y-1.5 text-xs">
        <Row label="Damage if hit" value={shot.damage} />
        <Row label="Cover" value={shot.coverNote} />
        <Row label="Range" value={`${shot.distance} of ${shot.range} tiles`} />
        <Row label="Time" value="2 shots · 2.0 s" />
      </dl>
      <div className="mt-4 flex items-center gap-2">
        <span className="flex-1 rounded-lg border border-white/15 px-3 py-2 text-center text-xs font-bold">
          − 2 shots +
        </span>
        <span className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-black text-black">
          Confirm
        </span>
      </div>
      <div className="mt-4 border-t border-white/10 pt-3">
        <p className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-white/40">
          Floor shows hit chance
        </p>
        <div className="flex h-2 overflow-hidden rounded-full">
          {["#fde725", "#5ec962", "#21918c", "#3b528b", "#2d1140"].map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-white/40">
          <span>75%+</span>
          <span>0%</span>
        </div>
      </div>
    </aside>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-white/45">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
