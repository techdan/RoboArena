"use client";

import { ArrowRight, BookOpen, X } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { PRIMER_RULES, squadPrimer } from "../../lib/help/bootCamp";
import { rememberBootCamp } from "../../lib/help/bootCampStorage";
import { useHelp } from "../help/HelpProvider";
import { SiteHeader } from "../site/SiteHeader";

const SQUAD = squadPrimer();

/**
 * Boot Camp: one screen that introduces the four robots and three rules.
 * Every number lives in the Field Guide; the first-turn coach in the planner
 * teaches the controls by doing.
 */
export function BootCamp({ returnTo }: { readonly returnTo: string }) {
  const { openGuide } = useHelp();
  const returnLabel = returnTo.startsWith("/room/")
    ? "Got it, back to my room"
    : "Got it, let's play";

  // Reading the one screen counts as finishing Boot Camp, so the home prompt stops asking.
  useEffect(() => {
    rememberBootCamp("completed");
  }, []);

  return (
    <main className="site-page site-bootcamp">
      <SiteHeader label="Boot Camp" rail>
        <button type="button" className="site-button" onClick={() => openGuide()}>
          <BookOpen size={15} aria-hidden="true" /> Field Guide
        </button>
        <Link className="site-button" data-variant="ghost" href={returnTo}>
          <X size={15} aria-hidden="true" /> Exit
        </Link>
      </SiteHeader>

      <div className="site-bootcamp-body">
        <h1 className="site-display site-bootcamp-title">Meet your squad</h1>
        <p className="site-bootcamp-lede">
          Every team fields these four robots, and each one has a job. You program them in private,
          then everyone’s turn plays out at once.
        </p>

        <ul className="site-squad" aria-label="The four robots">
          {SQUAD.map((card) => (
            <li key={card.robotClass} className="site-squad-card" data-class={card.robotClass}>
              <img
                className="site-squad-portrait"
                src={`/assets/site/robots/${card.robotClass}.jpg`}
                alt={`${card.name} robot in the arena`}
                width={300}
                height={300}
              />
              <div className="site-squad-body">
                <p className="site-squad-role">{card.role}</p>
                <h2 className="site-squad-name">{card.name}</h2>
                <p className="site-squad-job">{card.job}</p>
                <dl className="site-squad-ratings">
                  {card.ratings.map((rating) => (
                    <div key={rating.label}>
                      <dt>{rating.label}</dt>
                      <dd aria-label={`${rating.label} ${rating.dots} of 5`}>
                        {Array.from({ length: 5 }, (_, index) => (
                          <span key={index} data-on={index < rating.dots} aria-hidden="true" />
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
                <span className="site-squad-weapon">{card.weapon}</span>
              </div>
            </li>
          ))}
        </ul>

        <ul className="site-rules" aria-label="Three rules">
          {PRIMER_RULES.map((rule) => (
            <li key={rule.title}>
              <strong>{rule.title}</strong>
              <p>{rule.body}</p>
            </li>
          ))}
        </ul>

        <div className="site-bootcamp-actions">
          <Link className="site-button" data-variant="go" data-size="lg" href={returnTo}>
            {returnLabel}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <button type="button" className="site-button" data-size="lg" onClick={() => openGuide()}>
            <BookOpen size={16} aria-hidden="true" /> Open the Field Guide
          </button>
          <p className="site-fine">
            Hit chances, damage, ammo and every terrain type live in the Field Guide.
          </p>
        </div>
      </div>
    </main>
  );
}
