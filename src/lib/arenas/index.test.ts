import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import originalArenas from "./original-arenas.json";
import {
  ARENA_CATALOG,
  ARENA_NAMES,
  arenaProvenance,
  isArenaName,
  loadArena,
  validateCompactArena,
} from "./index.js";

const RUBBLE_SHA256 = "3c74ab044de7ab98073a893b58f2949dad2206c5b3d84bc6445a20d9587203a2";

describe("original arena library", () => {
  it("ships all 24 original maps, eight per town", () => {
    expect(ARENA_NAMES).toHaveLength(24);
    for (const town of ["rubble", "suburbs", "computer"] as const) {
      expect(ARENA_CATALOG.filter((entry) => entry.town === town)).toHaveLength(8);
    }
  });

  it("keeps the browser catalog in step with the generated terrain", () => {
    expect(
      originalArenas.arenas.map(({ slug, name, town, width, height }) => ({
        slug,
        name,
        town,
        width,
        height,
      })),
    ).toEqual(ARENA_CATALOG);
    for (const arena of originalArenas.arenas)
      expect(() => validateCompactArena(arena)).not.toThrow();
  });

  it.each(ARENA_NAMES)("loads %s with matching dimensions and four home corners", async (name) => {
    const arena = await loadArena(name);
    expect(arena.tiles).toHaveLength(arena.height);
    for (const row of arena.tiles) expect(row).toHaveLength(arena.width);
    expect(arena.homeAreas.map((home) => home.corner)).toEqual(["NW", "NE", "SE", "SW"]);
  });

  it("loads Rubble Two with generated 8×8 corner homes", async () => {
    const arena = await loadArena("rubble-two");
    expect(arena).toMatchObject({ type: "rubble", sizeName: "Rubble Two", width: 24, height: 24 });
    expect(arena.homeAreas[0]?.tiles).toHaveLength(64);
  });

  it("uses each axis's home span on long, thin maps", async () => {
    const arena = await loadArena("suburb-five");
    expect(arena).toMatchObject({ type: "suburbs", width: 52, height: 20 });
    expect(arena.homeAreas[0]?.tiles).toHaveLength(16 * 8);
  });

  it("retains the verified source checksums", () => {
    expect(arenaProvenance("rubble-three")).toEqual({
      source: "version-locked RUBBLE.TWN MAP export",
      mapId: 2,
      sourceSha256: RUBBLE_SHA256,
    });
    expect(arenaProvenance("computer-eight").source).toBe("version-locked COMPUTER.TWN MAP export");
  });

  it.each([
    ["rubble-two", "978d2832b3ea5f344ef42e0ee30269c1191a0f5de5463a6b565dd6457a1190ff"],
    ["rubble-three", "582c641242bcc199206865e97f8a4e715809cf69dde21da4bcdbeb5acf47b544"],
  ] as const)("keeps the previously pinned %s terrain byte-identical", async (name, digest) => {
    const arena = await loadArena(name);
    expect(createHash("sha256").update(JSON.stringify(arena.tiles)).digest("hex")).toBe(digest);
  });

  it("rejects malformed rows, unknown terrain and unknown names", () => {
    const rubbleTwo = originalArenas.arenas[1]!;
    expect(() => validateCompactArena({ ...rubbleTwo, width: 25 })).toThrow("row 0");
    expect(() =>
      validateCompactArena({ ...rubbleTwo, rows: ["?".repeat(24), ...rubbleTwo.rows.slice(1)] }),
    ).toThrow("row 0");
    expect(isArenaName("rubble-nine")).toBe(false);
    expect(isArenaName("computer-four")).toBe(true);
  });
});
