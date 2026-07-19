import { describe, expect, it } from "vitest";
import { makeOpenArena, makeRobot } from "../engine/__fixtures__/match";
import { WEAPONS } from "../engine/catalog";
import { LIVE_FIRE_HIT_THRESHOLDS } from "../engine/constants";
import { resolveCover } from "../engine/cover";
import { calculateLiveFireScore } from "../engine/firing";
import type { Arena } from "../engine/types";
import {
  availableWeapons,
  defaultScanSettings,
  PLANNER_WEAPON_RANGE,
  previewAim,
  previewTargetingTiles,
  targetingOpportunityTicks,
} from "./firingHelpers";

describe("authorized firing previews", () => {
  it("uses each weapon's real aim and scan opportunity cadence", () => {
    expect(targetingOpportunityTicks("burst-gun", "aim")).toBe(15);
    expect(targetingOpportunityTicks("burst-gun", "scan")).toBe(20);
    expect(targetingOpportunityTicks("missile-launcher", "aim")).toBe(30);
    expect(targetingOpportunityTicks("missile-launcher", "scan")).toBe(20);
  });

  it("surfaces angle, range, and line-of-sight gates without rolling", () => {
    const base = makeOpenArena(30, 5);
    const shooter = makeRobot("r1", "t1", "rifle", { x: 5, y: 2 }, { scanHeading: "E" });
    expect(
      previewAim({
        arena: base,
        shooter,
        target: { x: 4, y: 2 },
        weapon: "rifle",
        authorizedContacts: [],
      }).status,
    ).toBe("angle-blocked");
    expect(
      previewAim({
        arena: base,
        shooter,
        target: { x: 29, y: 2 },
        weapon: "rifle",
        authorizedContacts: [],
      }).status,
    ).toBe("out-of-range");
    const tiles = base.tiles.map((row) => [...row]);
    tiles[2]![8] = { terrain: "wall" };
    const walled: Arena = { ...base, tiles };
    const blocked = previewAim({
      arena: walled,
      shooter,
      target: { x: 10, y: 2 },
      weapon: "rifle",
      authorizedContacts: [],
    });
    expect(blocked).toMatchObject({ status: "sight-blocked", stoppedAt: { x: 8, y: 2 } });
    expect(blocked).not.toHaveProperty("roll");
  });

  it("matches the engine score table and reveals only explicitly authorized contacts", () => {
    const arena = makeOpenArena(20, 5);
    const shooter = makeRobot("r1", "t1", "rifle", { x: 2, y: 2 }, { scanHeading: "E" });
    const target = { x: 7, y: 2 };
    const anonymous = previewAim({
      arena,
      shooter,
      target,
      weapon: "rifle",
      authorizedContacts: [],
    });
    expect(anonymous.authorizedContact).toBeNull();
    expect(anonymous.estimates).toHaveLength(3);
    const cover = resolveCover({
      from: shooter.position as { x: number; y: number },
      to: target,
      targetPosture: "upright",
      arenaTileAt: (tile) => arena.tiles[tile.y]?.[tile.x],
    });
    expect(cover.outcome).toBe("cover");
    if (cover.outcome !== "cover") return;
    const score = calculateLiveFireScore({
      accuracy: shooter.definition.accuracy,
      distance: 5,
      coverClass: cover.coverClass,
      targetTerrain: "open",
      weapon: WEAPONS.rifle,
      targetOnAimedTile: true,
    });
    expect(anonymous.estimates[0]).toMatchObject({
      posture: "upright",
      score,
      threshold: LIVE_FIRE_HIT_THRESHOLDS[score],
    });
    const authorized = previewAim({
      arena,
      shooter,
      target,
      weapon: "rifle",
      authorizedContacts: [
        { id: "visible", label: "Visible contact", tile: target, posture: "ducking" },
      ],
    });
    expect(authorized.authorizedContact?.label).toBe("Visible contact");
    expect(authorized.estimates.map((entry) => entry.posture)).toEqual(["ducking"]);
  });

  it("explains blast weapons without inventing a direct-fire hit score", () => {
    const arena = makeOpenArena(20, 5);
    const shooter = makeRobot("r1", "t1", "missile", { x: 2, y: 2 }, { scanHeading: "E" });
    const preview = previewAim({
      arena,
      shooter,
      target: { x: 7, y: 2 },
      weapon: "missile-launcher",
      authorizedContacts: [],
    });
    expect(preview).toMatchObject({ status: "eligible", resolution: "blast", estimates: [] });
  });

  it("projects finite ammunition and reserves runtime-dependent fire", () => {
    const robot = makeRobot("r1", "t1", "missile", { x: 1, y: 1 });
    const shot = {
      kind: "aim-and-fire",
      target: { x: 2, y: 1 },
      weapon: "missile-launcher",
      repeat: false,
    } as const;
    expect(availableWeapons(robot)).toEqual(["missile-launcher", "rifle"]);
    expect(availableWeapons(robot, [shot, shot])).toEqual(["missile-launcher", "rifle"]);
    expect(availableWeapons(robot, [shot, shot, shot])).toEqual(["rifle"]);
    expect(
      availableWeapons(robot, [
        {
          kind: "scan-and-fire",
          weapon: "missile-launcher",
          maxDistance: 18,
          seconds: 1,
        },
      ]),
    ).toEqual(["rifle"]);
  });

  it("defaults Scan & Fire to the weapon range and remaining whole-second horizon", () => {
    expect(defaultScanSettings("rifle", 685)).toEqual({ maxDistance: 18, seconds: 11 });
    expect(defaultScanSettings("rifle", 870)).toEqual({ maxDistance: 18, seconds: 14 });
    expect(defaultScanSettings("missile-launcher", 0)).toEqual({ maxDistance: 18, seconds: 1 });
    for (const [id, definition] of Object.entries(WEAPONS)) {
      expect(PLANNER_WEAPON_RANGE[id as keyof typeof PLANNER_WEAPON_RANGE]).toBe(
        definition.maxRange,
      );
    }
  });

  it("builds Scan overlays from exact sight strength and the inclusive boundary", () => {
    const open = makeOpenArena(7, 7);
    const tiles = open.tiles.map((row) => [...row]);
    tiles[3]![4] = { terrain: "bush" };
    tiles[3]![5] = { terrain: "bush" };
    const arena: Arena = { ...open, tiles };
    const shooter = makeRobot("r1", "t1", "rifle", { x: 3, y: 3 }, { scanHeading: "N" });
    const previews = previewTargetingTiles({
      arena,
      shooter,
      weapon: "rifle",
      authorizedContacts: [],
      fireMode: "scan",
      maxDistance: 4,
      assumedPosture: "upright",
    });
    const boundary = previews.find((entry) => entry.tile.x === 5 && entry.tile.y === 3);
    expect(boundary).toMatchObject({
      status: "eligible",
      onConeBoundary: true,
      scanStrength: 10,
      fireMode: "scan",
    });
    const behind = previews.find((entry) => entry.tile.x === 3 && entry.tile.y === 5);
    expect(behind?.status).toBe("angle-blocked");
    expect(boundary?.estimates).toHaveLength(1);
    expect(boundary?.estimates[0]?.posture).toBe("upright");
    expect(boundary?.chancePercent).toEqual(expect.any(Number));
    const cover = resolveCover({
      from: shooter.position as { x: number; y: number },
      to: { x: 5, y: 3 },
      targetPosture: "upright",
      arenaTileAt: (tile) => arena.tiles[tile.y]?.[tile.x],
    });
    expect(cover.outcome).toBe("cover");
    if (cover.outcome !== "cover") return;
    expect(boundary?.estimates[0]?.score).toBe(
      calculateLiveFireScore({
        accuracy: shooter.definition.accuracy,
        distance: 2,
        coverClass: cover.coverClass,
        targetTerrain: "bush",
        weapon: WEAPONS.rifle,
        targetOnAimedTile: true,
        fireMode: "scan",
        scanStrength: 10,
      }),
    );
  });

  it("uses an explicit hypothetical posture and observed posture without averaging", () => {
    const arena = makeOpenArena(8, 5);
    const shooter = makeRobot("r1", "t1", "rifle", { x: 1, y: 2 }, { scanHeading: "E" });
    const target = { x: 5, y: 2 };
    const hypothetical = previewTargetingTiles({
      arena,
      shooter,
      weapon: "rifle",
      authorizedContacts: [],
      fireMode: "aim",
      maxDistance: 18,
      assumedPosture: "crouching",
    }).find((entry) => entry.tile.x === target.x && entry.tile.y === target.y);
    expect(hypothetical?.estimates.map((entry) => entry.posture)).toEqual(["crouching"]);
    expect(hypothetical?.chancePercent).toBe(hypothetical?.estimates[0]?.chancePercent);

    const observed = previewTargetingTiles({
      arena,
      shooter,
      weapon: "rifle",
      authorizedContacts: [
        { id: "visible", label: "Visible contact", tile: target, posture: "ducking" },
      ],
      fireMode: "aim",
      maxDistance: 18,
      assumedPosture: "crouching",
    }).find((entry) => entry.tile.x === target.x && entry.tile.y === target.y);
    expect(observed?.estimates.map((entry) => entry.posture)).toEqual(["ducking"]);
    expect(observed?.authorizedContact?.label).toBe("Visible contact");
  });
});
