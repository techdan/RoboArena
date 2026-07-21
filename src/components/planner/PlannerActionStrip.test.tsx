import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { makeRobot } from "../../engine/__fixtures__/match";
import type { TurnOrders } from "../../engine/types";
import { PlannerActionStrip } from "./PlannerActionStrip";
import { RobotSelector } from "./RobotSelector";
import { Timeline } from "./Timeline";
import { AllProgramsOverlay } from "./AllProgramsOverlay";
import { robotDisplayNames } from "../../planner/presentation";
import { HelpProvider } from "../help/HelpProvider";

const noop = vi.fn();

const stripShared = {
  posture: "upright" as const,
  heading: "E" as const,
  missileAmmo: 2,
  disabled: false,
  aimActive: false,
  scanActive: false,
  onPosture: noop,
  onHeadingPreview: noop,
  onHeading: noop,
  onWeapon: noop,
  onAim: noop,
  onScan: noop,
};

describe("Phase 11.8.2 action strip", () => {
  it("shows a weapon selector only when multiple weapons are available", () => {
    const multiple = renderToStaticMarkup(
      <HelpProvider>
        <PlannerActionStrip
          {...stripShared}
          weapons={["missile-launcher", "rifle"]}
          selectedWeapon="missile-launcher"
        />
      </HelpProvider>,
    );
    expect(multiple).toContain('<select aria-label="Weapon"');
    expect(multiple).toContain('role="slider"');
    expect(multiple).toContain('aria-valuetext="E"');
    expect(multiple).toContain("Missile Launcher · 2");
  });

  it("hides the weapon group entirely for single-weapon robots", () => {
    const single = renderToStaticMarkup(
      <HelpProvider>
        <PlannerActionStrip
          {...stripShared}
          weapons={["rifle"]}
          selectedWeapon="rifle"
          missileAmmo={null}
        />
      </HelpProvider>,
    );
    expect(single).not.toContain("<select");
    expect(single).not.toContain("action-weapon-group");
    expect(single).not.toContain("Missiles");
  });

  it("keeps posture buttons icon-only with the posture in each accessible name", () => {
    const strip = renderToStaticMarkup(
      <HelpProvider>
        <PlannerActionStrip {...stripShared} weapons={["rifle"]} selectedWeapon="rifle" />
      </HelpProvider>,
    );
    // No fixed posture text: each button carries an accessible name/tooltip
    // (hover or long-press) instead, so the strip stays short.
    expect(strip).not.toContain("<b>upright</b>");
    expect(strip).toContain('title="crouching posture"');
    expect(strip).toContain('aria-label="ducking posture"');
    expect(strip).toContain("posture-silhouette");
    // The active posture is still conveyed to assistive tech via aria-pressed.
    expect(strip).toContain('aria-pressed="true"');
    expect(strip).toContain('data-active="true"');
  });

  it("takes the fire slot over in place, replacing the entry buttons", () => {
    const withEntry = renderToStaticMarkup(
      <HelpProvider>
        <PlannerActionStrip {...stripShared} weapons={["rifle"]} selectedWeapon="rifle" />
      </HelpProvider>,
    );
    expect(withEntry).toContain("Aim &amp; Fire");
    expect(withEntry).toContain("Scan &amp; Fire");

    const takenOver = renderToStaticMarkup(
      <HelpProvider>
        <PlannerActionStrip
          {...stripShared}
          weapons={["rifle"]}
          selectedWeapon="rifle"
          aimActive
          fireControls={<div className="fire-inline">taken over</div>}
        />
      </HelpProvider>,
    );
    // Same fire-group slot now hosts the controls; the entry buttons are gone.
    expect(takenOver).toContain("action-fire-group");
    expect(takenOver).toContain("fire-inline");
    expect(takenOver).not.toContain("Aim &amp; Fire");
    expect(takenOver).not.toContain("Scan &amp; Fire");
  });
});

describe("Phase 11.8.2 selector + summary band", () => {
  const bandShared = {
    selectedRobotId: "r1",
    selectedName: "Rifle 1",
    usedTicks: 120,
    budgetTicks: 900,
    showAllPrograms: false,
    onSelect: noop,
    onToggleAllPrograms: noop,
    onClear: noop,
  };

  it("renders duplicate-aware chips, the program summary, and band controls", () => {
    const robots = [
      makeRobot("r1", "t1", "rifle", { x: 0, y: 0 }),
      makeRobot("r2", "t1", "rifle", { x: 1, y: 0 }),
      makeRobot("b1", "t1", "burst", { x: 2, y: 0 }),
    ];
    const markup = renderToStaticMarkup(
      <RobotSelector {...bandShared} robots={robots} names={robotDisplayNames(robots)} />,
    );
    expect(markup).toContain("Rifle 1");
    expect(markup).toContain("Rifle 2");
    expect(markup).toContain("Burst");
    // Thin HP bar (HP conveyed via its accessible label) rather than a "140 HP" text node.
    expect(markup).toContain("planner-robot-hp");
    expect(markup).toContain('aria-label="140 of 140 HP"');
    expect(markup).not.toContain("<small>140 HP");
    // All Programs toggle + band-local overflow trigger (Clear lives inside it).
    expect(markup).toContain("All Programs");
    expect(markup).toContain('aria-label="More robot actions"');
    expect(markup).toContain("planner-program-summary");
  });

  it("renders an 8-robot roster without horizontal scroll fallback", () => {
    const robots = Array.from({ length: 8 }, (_, index) =>
      makeRobot(`r${index}`, "t1", "rifle", { x: index, y: 0 }),
    );
    const markup = renderToStaticMarkup(
      <RobotSelector
        {...bandShared}
        selectedRobotId="r0"
        robots={robots}
        names={robotDisplayNames(robots)}
      />,
    );
    // Every chip renders; wrapping (not scroll) is the CSS fallback.
    expect((markup.match(/planner-robot-shortcut/g) ?? []).length).toBe(8);
  });
});

describe("Phase 11.8.2 glyph timeline", () => {
  const orders: TurnOrders = {
    turnNumber: 1,
    timelines: [
      {
        robotId: "r1",
        segments: [
          { kind: "set-posture", posture: "ducking" },
          { kind: "set-scan-direction", heading: "NE" },
        ],
      },
    ],
  };
  const robots = [
    makeRobot("r1", "t1", "rifle", { x: 0, y: 0 }),
    makeRobot("r2", "t1", "rifle", { x: 1, y: 0 }),
  ];
  const names = robotDisplayNames(robots);

  it("renders glyph-only cells that keep full command detail in the accessible label", () => {
    const markup = renderToStaticMarkup(
      <Timeline
        robots={robots}
        orders={orders}
        selectedRobotId="r1"
        budgetTicks={900}
        previewTick={15}
        remainingTicks={885}
        onPreviewTick={noop}
        onSelectCommand={noop}
        onRemoveFrom={noop}
      />,
    );
    // Full detail stays in the accessible label...
    expect(markup).toContain("Change posture to ducking");
    expect(markup).toContain("Set scan direction to NE");
    // ...but the block itself is glyph-only (no command name/param text spans).
    expect(markup).toContain("timeline-cell");
    expect(markup).not.toContain("timeline-command-detail");
    // The single band owns the playhead + remaining; All Programs moved to the selector band.
    expect(markup).toContain("timeline-scrub");
    expect(markup).toContain("left</span>");
    expect(markup).not.toContain("All Programs");
    expect(markup).not.toContain("Rifle 1 program");
  });

  it("All Programs overlay renders every robot lane on the shared axis", () => {
    const markup = renderToStaticMarkup(
      <AllProgramsOverlay
        robots={robots}
        names={names}
        orders={orders}
        selectedRobotId="r1"
        budgetTicks={900}
        previewTick={15}
        onPreviewTick={noop}
        onSelectRobot={noop}
        onSelectCommand={noop}
        onRemoveFrom={noop}
        onClose={noop}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Rifle 1");
    expect(markup).toContain("Rifle 2");
    expect(markup).toContain("all-programs-scrub");
  });
});
