/** Phase 7 movie timeline behavior. */

import { describe, expect, it } from "vitest";
import { makeMatch, makeRobot } from "../engine/__fixtures__/match";
import type { ResolutionEvent } from "../engine/types";
import { buildMovieTimeline, presentationDelayMs, snapshotAtTick } from "./animations";

const walkEvents: readonly ResolutionEvent[] = Array.from({ length: 10 }, (_, index) => ({
  tick: index + 1,
  seq: index,
  kind: "move-step" as const,
  robotId: "r1",
  to: { x: index + 2, y: 1 },
}));

describe("movie timeline", () => {
  const state = makeMatch({
    teamOneRobots: [makeRobot("r1", "team-1", "rifle", { x: 1, y: 1 })],
  });

  it("steps forward to the authoritative final robot position", () => {
    const timeline = buildMovieTimeline(state, walkEvents);
    expect(timeline.snapshots.at(-1)?.robots.r1?.position).toEqual({ x: 11, y: 1 });
  });

  it("steps backward to an idempotent previous snapshot", () => {
    const timeline = buildMovieTimeline(state, walkEvents);
    expect(timeline.snapshots[9]?.robots.r1?.position).toEqual({ x: 10, y: 1 });
    expect(timeline.snapshots[9]).toEqual(snapshotAtTick(timeline, 9));
  });

  it("changes wall-clock pacing without changing the fired event sequence", () => {
    const events: readonly ResolutionEvent[] = [
      ...walkEvents,
      {
        tick: 10,
        seq: 20,
        kind: "fired",
        shooterId: "r1",
        commandIndex: 0,
        weapon: "rifle",
        target: { x: 4, y: 1 },
        fireMode: "aim",
      },
    ];
    const timeline = buildMovieTimeline(state, events);
    const fired = [...timeline.eventsByTick.values()]
      .flat()
      .filter((event) => event.kind === "fired");
    expect(fired).toHaveLength(1);
    expect(
      presentationDelayMs({ fromTick: 0, toTick: 10, fps: 12, speed: 4, compressIdle: false }),
    ).toBeLessThan(
      presentationDelayMs({ fromTick: 0, toTick: 10, fps: 12, speed: 1, compressIdle: false }),
    );
  });

  it("makes idle compression and scrubbing converge on the uninterrupted snapshot", () => {
    const timeline = buildMovieTimeline(state, [walkEvents[0]!, { ...walkEvents[9]!, tick: 500 }]);
    expect(snapshotAtTick(timeline, 500)).toEqual(timeline.snapshots.at(-1));
    expect(
      presentationDelayMs({ fromTick: 1, toTick: 500, fps: 12, speed: 1, compressIdle: true }),
    ).toBeLessThan(
      presentationDelayMs({ fromTick: 1, toTick: 500, fps: 12, speed: 1, compressIdle: false }),
    );
  });
});
