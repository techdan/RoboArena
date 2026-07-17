/** Phase 7 movie timeline behavior. */

import { describe, expect, it } from "vitest";
import { makeMatch, makeRobot } from "../engine/__fixtures__/match";
import { resolveTurn } from "../engine/resolver";
import type { ResolutionEvent } from "../engine/types";
import type { ParticipantResolutionEvent } from "../lib/net/protocol";
import {
  ANIMATION_CUES,
  buildMovieTimeline,
  presentationDelayMs,
  snapshotAtTick,
} from "./animations";

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

  it("reconstructs the authoritative resolver next-state positions", () => {
    const resolution = resolveTurn({
      state,
      seed: "movie-authority",
      orders: {
        turnNumber: state.turnNumber,
        timelines: [
          {
            robotId: "r1",
            segments: [
              {
                kind: "move",
                posture: "upright",
                path: [{ to: { x: 2, y: 1 } }, { to: { x: 3, y: 1 } }, { to: { x: 4, y: 1 } }],
              },
            ],
          },
        ],
      },
    });
    expect(resolution.outcome).toBe("resolved");
    if (resolution.outcome !== "resolved") throw new Error(resolution.message);
    const finalSnapshot = buildMovieTimeline(state, resolution.events).snapshots.at(-1);
    for (const team of resolution.nextState.teams) {
      for (const robot of team.robots) {
        expect(finalSnapshot?.robots[robot.id]?.position).toEqual(robot.position);
      }
    }
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
      presentationDelayMs({ fromTick: 0, toTick: 60, fps: 12, speed: 1, compressIdle: false }),
    ).toBe(1000);
    expect(
      presentationDelayMs({ fromTick: 0, toTick: 60, fps: 12, speed: 4, compressIdle: false }),
    ).toBe(250);
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

  it("maps every textured movie effect to its public cue", () => {
    expect(ANIMATION_CUES.fired).toBe("muzzle");
    expect(ANIMATION_CUES["scan-target-acquired"]).toBe("target-lock");
    expect(ANIMATION_CUES["enemy-lost"]).toBe("last-known");
    expect(ANIMATION_CUES["last-known-marker"]).toBe("last-known");
    expect(ANIMATION_CUES["shot-missed"]).toBe("miss");
  });

  it("materializes, damages, and removes a participant contact", () => {
    const events: readonly ParticipantResolutionEvent[] = [
      {
        tick: 10,
        seq: 0,
        kind: "enemy-spotted",
        teamId: "team-1",
        enemyId: "contact",
        at: { x: 2, y: 1 },
        contact: {
          id: "contact",
          teamId: "team-2",
          teamColor: "blue",
          robotClass: "rifle",
          position: { x: 2, y: 1 },
          hp: 140,
          armor: 140,
          posture: "upright",
          scanHeading: "W",
          destroyed: false,
        },
      },
      {
        tick: 20,
        seq: 1,
        kind: "damaged",
        damageKind: "direct",
        targetId: "contact",
        damage: 15,
      },
      {
        tick: 30,
        seq: 2,
        kind: "enemy-lost",
        teamId: "team-1",
        enemyId: "contact",
        lastSeenAt: { x: 2, y: 1 },
      },
    ];
    const timeline = buildMovieTimeline(state, events);

    expect(snapshotAtTick(timeline, 10).robots.contact).toMatchObject({ hp: 140 });
    expect(snapshotAtTick(timeline, 20).robots.contact).toMatchObject({ hp: 125 });
    expect(snapshotAtTick(timeline, 30).robots.contact).toBeUndefined();
  });
});
