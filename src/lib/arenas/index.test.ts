import { createHash } from "node:crypto";
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

  it.each([
    [
      "Rubble Two",
      rubbleTwo.tiles,
      "978d2832b3ea5f344ef42e0ee30269c1191a0f5de5463a6b565dd6457a1190ff",
    ],
    [
      "Rubble Three",
      rubbleThree.tiles,
      "582c641242bcc199206865e97f8a4e715809cf69dde21da4bcdbeb5acf47b544",
    ],
  ] as const)("pins the generated %s MAP payload", (_name, tiles, expectedDigest) => {
    expect(createHash("sha256").update(JSON.stringify(tiles)).digest("hex")).toBe(expectedDigest);
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
