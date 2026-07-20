import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AimFireControls, ScanFireControls } from "./FireControlStrip";
import { TargetingLegend } from "./TargetingLegend";

const noop = vi.fn();

describe("compact fire controls", () => {
  it("renders Scan's only inputs without a redundant weapon selector", () => {
    const html = renderToStaticMarkup(
      <ScanFireControls
        weapon="rifle"
        maxDistance={12}
        seconds={10}
        onDistanceChange={noop}
        onSecondsChange={noop}
        onCancel={noop}
        onConfirm={noop}
      />,
    );
    expect(html).toContain("Scan &amp; Fire");
    expect(html).toContain("Rifle");
    expect(html).toContain('name="scan-maximum-distance"');
    expect(html).toContain('name="scan-seconds"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Target posture");
  });

  it("keeps Aim review disabled until a legal target exists", () => {
    const html = renderToStaticMarkup(
      <AimFireControls
        weapon="rifle"
        target={null}
        shots={3}
        maxShots={12}
        firingIntervalTicks={30}
        canReview={false}
        onShotsChange={noop}
        onCancel={noop}
        onReview={noop}
      />,
    );
    expect(html).toContain("Choose tile");
    expect(html).toContain('name="aim-fire-seconds"');
    expect(html).toContain('value="1.5"');
    expect(html).toContain("3 shots");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Review<\/button>/);
  });
});

describe("targeting map legend", () => {
  it("keeps mode, range, chance bands, and blocked states over the map", () => {
    const html = renderToStaticMarkup(
      <TargetingLegend
        overlay={{
          mode: "scan",
          origin: { x: 2, y: 2 },
          heading: "E",
          maxDistance: 12,
          weapon: "rifle",
          target: null,
          seconds: 10,
          opportunityTicks: 20,
          assumedPosture: "upright",
          resolution: "direct-hit-roll",
          tiles: [],
        }}
        onAssumedPosture={noop}
        onBlockBoardHover={noop}
      />,
    );
    expect(html).toContain('aria-label="Targeting overlay legend"');
    expect(html).toContain("Auto-acquire");
    expect(html).toContain("12 tiles");
    expect(html).toContain("Excellent 75–94%");
    expect(html).toContain("Behind cone");
    // Posture trio is icon-only now: caption reads "Posture"; names live on the buttons.
    expect(html).toContain("<legend>Posture</legend>");
    expect(html).toContain('aria-label="Preview upright target"');
    expect(html).toContain("posture-silhouette");
  });
});
