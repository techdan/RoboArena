import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { makeRobot } from "../../engine/__fixtures__/match";
import type { TurnOrders } from "../../engine/types";
import { PlannerActionStrip } from "./PlannerActionStrip";
import { RobotSelector } from "./RobotSelector";
import { Timeline } from "./Timeline";
import { robotDisplayNames } from "../../planner/presentation";
import { HelpProvider } from "../help/HelpProvider";

const noop = vi.fn();

describe("Phase 11.8.1 planner controls", () => {
  it("shows a weapon selector only when multiple weapons are available", () => {
    const shared = {
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
    const multiple = renderToStaticMarkup(
      <HelpProvider>
        <PlannerActionStrip
          {...shared}
          weapons={["missile-launcher", "rifle"]}
          selectedWeapon="missile-launcher"
        />
      </HelpProvider>,
    );
    expect(multiple).toContain('<select aria-label="Weapon"');
    expect(multiple).toContain('role="slider"');
    expect(multiple).toContain('aria-label="Scan direction"');
    expect(multiple).toContain('aria-valuetext="E"');
    expect(multiple).not.toContain("Face E");
    expect(multiple).toContain("Missile Launcher · 2");
    expect(multiple).toContain("Missiles 2");

    const fallback = renderToStaticMarkup(
      <HelpProvider>
        <PlannerActionStrip
          {...shared}
          weapons={["rifle"]}
          selectedWeapon="rifle"
          missileAmmo={0}
        />
      </HelpProvider>,
    );
    expect(fallback).not.toContain("<select");
    expect(fallback).toContain("Rifle");
    expect(fallback).toContain("Missiles 0");
  });

  it("uses duplicate-aware robot names and renders one compact selected timeline", () => {
    const robots = [
      makeRobot("r1", "t1", "rifle", { x: 0, y: 0 }),
      makeRobot("r2", "t1", "rifle", { x: 1, y: 0 }),
      makeRobot("b1", "t1", "burst", { x: 2, y: 0 }),
    ];
    const names = robotDisplayNames(robots);
    const selector = renderToStaticMarkup(
      <RobotSelector robots={robots} names={names} selectedRobotId="r1" onSelect={noop} />,
    );
    expect(selector).toContain("Rifle 1");
    expect(selector).toContain("Rifle 2");
    expect(selector).toContain("Burst");

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
    const timeline = renderToStaticMarkup(
      <Timeline
        robots={robots}
        names={names}
        orders={orders}
        selectedRobotId="r1"
        budgetTicks={900}
        previewTick={15}
        remainingTicks={885}
        onPreviewTick={noop}
        onSelectRobot={noop}
        onSelectCommand={noop}
        onRemoveLast={noop}
        onClear={noop}
      />,
    );
    expect(timeline).toContain("Rifle 1 program");
    expect(timeline).toContain("All Programs");
    expect(timeline).toContain("Change posture to ducking");
    expect(timeline).toContain("Set scan direction to NE");
    expect(timeline).not.toContain("Rifle 2 program");
  });
});
