import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { makeOpenArena, makeRobot } from "../../engine/__fixtures__/match";
import { AimAndFireDialog } from "./AimAndFireDialog";

const noop = vi.fn();
const shared = {
  arena: makeOpenArena(),
  target: { x: 3, y: 1 },
  fireSeconds: 0.5,
  assumedPosture: "upright" as const,
  authorizedContacts: [],
  onConfirm: noop,
  onBack: noop,
};

describe("Aim & Fire review teaching", () => {
  it("counts Burst actions as bursts, one hit roll each", () => {
    const html = renderToStaticMarkup(
      <AimAndFireDialog
        {...shared}
        shooter={makeRobot("b1", "team-1", "burst", { x: 1, y: 1 })}
        weapon="burst-gun"
        shots={2}
      />,
    );

    expect(html).toContain("2 bursts");
    expect(html).not.toContain("bullets");
    expect(html).toContain("Add 2 bursts");
    expect(html).not.toContain("Shots <strong>2");
  });

  it("makes Missile radius, damage bands, scarcity, and friendly fire explicit", () => {
    const html = renderToStaticMarkup(
      <AimAndFireDialog
        {...shared}
        shooter={makeRobot("m1", "team-1", "missile", { x: 1, y: 1 })}
        weapon="missile-launcher"
        shots={1}
      />,
    );

    expect(html).toContain("Blast radius 2");
    expect(html).toContain("including allies");
    expect(html).toContain("Friendly fire:");
    expect(html).toContain("scarce ammunition");
    expect(html).toContain("impact 60–91");
    expect(html).toContain("Add 1 missile");
  });
});
