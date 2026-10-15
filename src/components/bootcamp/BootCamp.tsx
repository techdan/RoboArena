"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Clapperboard,
  Crosshair,
  GraduationCap,
  ListChecks,
  Mountain,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { rememberBootCamp } from "../../lib/help/bootCampStorage";
import { useHelp } from "../help/HelpProvider";
import { firstTurnChecklist, SquadStep, TerrainStep, TurnStep, WeaponsStep } from "./BootCampSteps";

interface Step {
  readonly id: string;
  readonly nav: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  readonly icon: typeof Users;
}

const STEPS: readonly Step[] = [
  {
    id: "turn",
    nav: "How a turn works",
    eyebrow: "The loop",
    title: "Plan in secret. Watch it all happen at once.",
    lede: "RoboArena is simultaneous: every player programs their squad, then all orders resolve together as a movie of that turn.",
    icon: Clapperboard,
  },
  {
    id: "squad",
    nav: "Meet your squad",
    eyebrow: "Robot classes",
    title: "Four robots, four jobs.",
    lede: "Every squad mixes these classes. Knowing what each is good at tells you who leads, who covers, and who stays back.",
    icon: Users,
  },
  {
    id: "weapons",
    nav: "Weapons & damage",
    eyebrow: "Combat",
    title: "Bullets roll to hit. Missiles don't.",
    lede: "Guns trade accuracy, speed, and damage. Cover and distance change both whether you hit and how much it hurts.",
    icon: Crosshair,
  },
  {
    id: "terrain",
    nav: "Terrain & posture",
    eyebrow: "Positioning",
    title: "Get low, get behind something.",
    lede: "Posture decides where you can walk and how hard you are to hit. The same robot is far safer ducking behind a low wall.",
    icon: Mountain,
  },
  {
    id: "checklist",
    nav: "First turn checklist",
    eyebrow: "Go time",
    title: "Your first turn, in five moves.",
    lede: "A simple plan that works on turn one. Tick them off — then go start a room.",
    icon: ListChecks,
  },
];

const LAST = STEPS.length - 1;

function Checklist({
  checked,
  onToggle,
}: {
  readonly checked: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
}) {
  return (
    <ol className="bc-checklist">
      {firstTurnChecklist().map((item, index) => {
        const done = checked.has(item.id);
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={done}
              data-done={done}
              onClick={() => onToggle(item.id)}
            >
              <span className="bc-check-box" aria-hidden="true">
                {done ? <Check size={16} /> : index + 1}
              </span>
              <span>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function BootCamp({ returnTo }: { readonly returnTo: string }) {
  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const { openGuide } = useHelp();
  const current = STEPS[step] ?? STEPS[0]!;
  const returnLabel = returnTo.startsWith("/room/") ? "Back to room" : "Start playing";

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    if (step === LAST) rememberBootCamp("completed");
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, select, textarea, dialog"))
        return;
      if (event.key === "ArrowRight") setStep((value) => Math.min(LAST, value + 1));
      else if (event.key === "ArrowLeft") setStep((value) => Math.max(0, value - 1));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (id: string) =>
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  let body: ReactNode;
  switch (current.id) {
    case "turn":
      body = <TurnStep />;
      break;
    case "squad":
      body = <SquadStep />;
      break;
    case "weapons":
      body = <WeaponsStep />;
      break;
    case "terrain":
      body = <TerrainStep />;
      break;
    default:
      body = <Checklist checked={checked} onToggle={toggle} />;
  }

  return (
    <main className="boot-camp">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="boot-camp-shell">
        <header className="boot-camp-header">
          <div className="boot-camp-brand">
            <span aria-hidden="true">
              <GraduationCap />
            </span>
            <div>
              <p className="eyebrow">RoboArena Boot Camp</p>
              <p className="boot-camp-sub">About two minutes · {STEPS.length} quick steps</p>
            </div>
          </div>
          <div className="boot-camp-header-actions">
            <button type="button" className="field-guide-button" onClick={() => openGuide()}>
              <BookOpen size={15} aria-hidden="true" /> Field Guide
            </button>
            <Link
              className="secondary-link"
              href={returnTo}
              onClick={() => rememberBootCamp("dismissed")}
            >
              <X className="size-4" aria-hidden="true" />
              Exit
            </Link>
          </div>
        </header>

        <nav className="boot-camp-steps" aria-label="Boot Camp steps">
          <ol>
            {STEPS.map((entry, index) => {
              const Icon = entry.icon;
              const state = index === step ? "current" : index < step ? "done" : "todo";
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    data-state={state}
                    aria-current={index === step ? "step" : undefined}
                    onClick={() => setStep(index)}
                  >
                    <span className="boot-camp-step-dot" aria-hidden="true">
                      {state === "done" ? <Check size={14} /> : <Icon size={14} />}
                    </span>
                    <span className="boot-camp-step-label">
                      <small>Step {index + 1}</small>
                      {entry.nav}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div
            className="boot-camp-progress"
            role="progressbar"
            aria-label="Boot Camp progress"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={step + 1}
          >
            <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </nav>

        <section className="boot-camp-stage" aria-labelledby="boot-camp-title" key={current.id}>
          <div className="boot-camp-intro">
            <p className="eyebrow">
              {current.eyebrow} · {step + 1}/{STEPS.length}
            </p>
            <h1 id="boot-camp-title" ref={headingRef} tabIndex={-1}>
              {current.title}
            </h1>
            <p>{current.lede}</p>
          </div>
          {body}
        </section>

        <footer className="boot-camp-footer">
          <button
            type="button"
            className="secondary-action"
            disabled={step === 0}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </button>
          <p className="boot-camp-keys" aria-hidden="true">
            <kbd>←</kbd> <kbd>→</kbd> to move between steps
          </p>
          {step < LAST ? (
            <button
              type="button"
              className="primary-action"
              onClick={() => setStep((value) => Math.min(LAST, value + 1))}
            >
              Next: {STEPS[step + 1]?.nav}
              <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <Link
              className="primary-action"
              href={returnTo}
              onClick={() => rememberBootCamp("completed")}
            >
              {returnLabel}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </footer>
      </div>
    </main>
  );
}
