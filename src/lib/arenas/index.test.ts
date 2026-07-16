import { describe, expect, it } from "vitest";
import rubbleThree from "./rubble-three.json";
import rubbleTwo from "./rubble-two.json";
import { arenaProvenance, loadArena, validateArenaData } from "./index.js";

describe("Phase 6 arena library", () => {
  it.each([
    ["Rubble Two", rubbleTwo, 24, 24],
    ["Rubble Three", rubbleThree, 32, 32],
  ] as const)("validates the source-locked %s export", (_name, data, width, height) => {
    expect(() => validateArenaData(data)).not.toThrow();
    expect(data).toMatchObject({ width, height, metadata: { unknownTiles: [] } });
  });

  it("loads Rubble Two with generated 8×8 corner homes", async () => {
    const arena = await loadArena("rubble-two");

    expect(arena).toMatchObject({ type: "rubble", sizeName: "Rubble Two", width: 24, height: 24 });
    expect(arena.homeAreas).toHaveLength(4);
    expect(arena.homeAreas[0]?.tiles).toHaveLength(64);
  });

  it("retains the verified source checksum", () => {
    expect(arenaProvenance("rubble-three").sourceSha256).toBe(
      "3c74ab044de7ab98073a893b58f2949dad2206c5b3d84bc6445a20d9587203a2",
    );
  });

  it("rejects malformed dimensions and unknown terrain", () => {
    expect(() => validateArenaData({ ...rubbleTwo, width: 25 })).toThrow("row 0");
    expect(() =>
      validateArenaData({
        ...rubbleTwo,
        tiles: [[{ terrain: "lava" }], ...rubbleTwo.tiles.slice(1)],
      }),
    ).toThrow("row 0");
  });
});
