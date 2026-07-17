import { describe, expect, it } from "vitest";
import { makeOpenArena, makeRobot } from "../engine/__fixtures__/match";
import { WEAPONS } from "../engine/catalog";
import { LIVE_FIRE_HIT_THRESHOLDS } from "../engine/constants";
import { resolveCover } from "../engine/cover";
import { calculateLiveFireScore } from "../engine/firing";
import type { Arena } from "../engine/types";
import { defaultScanSettings, PLANNER_WEAPON_RANGE, previewAim } from "./firingHelpers";

describe("authorized firing previews", () => {
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

  it("defaults Scan & Fire to the weapon range and remaining whole-second horizon", () => {
    expect(defaultScanSettings("rifle", 685)).toEqual({ maxDistance: 18, seconds: 12 });
    expect(defaultScanSettings("missile-launcher", 0)).toEqual({ maxDistance: 18, seconds: 1 });
    for (const [id, definition] of Object.entries(WEAPONS)) {
      expect(PLANNER_WEAPON_RANGE[id as keyof typeof PLANNER_WEAPON_RANGE]).toBe(
        definition.maxRange,
      );
    }
  });
});
