import { describe, expect, it } from "vitest";
import {
  COVER_CLASS_BULLET_DAMAGE_ADJUST,
  COVER_CLASS_HIT_SCORE,
  LIVE_FIRE_HIT_THRESHOLDS,
  MOVIE_FPS,
  MOVIE_FPS_OPTIONS,
  TICKS_PER_SECOND,
  TURN_DURATION_TICKS_DEFAULT,
  WEAPON_ACCURACY_ADDS,
} from "./constants.js";

describe("binary-derived constants", () => {
  it("uses the 60 Hz clock and 900-tick default turn", () => {
    expect(TICKS_PER_SECOND).toBe(60);
    expect(TURN_DURATION_TICKS_DEFAULT).toBe(900);
  });

  it("uses the original movie-rate choices and 12 fps default", () => {
    expect(MOVIE_FPS_OPTIONS).toEqual([20, 15, 12, 10, 6, 5, 4, 3]);
    expect(MOVIE_FPS).toBe(12);
  });

  it("transcribes the full live-fire threshold table", () => {
    expect(LIVE_FIRE_HIT_THRESHOLDS).toEqual([
      0, 4, 8, 16, 24, 32, 40, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240,
    ]);
  });

  it("keeps score 8 at 64 and score 19 at 240", () => {
    expect(LIVE_FIRE_HIT_THRESHOLDS[8]).toBe(64);
    expect(LIVE_FIRE_HIT_THRESHOLDS[19]).toBe(240);
  });

  it("transcribes cover-class hit scores", () => {
    expect(COVER_CLASS_HIT_SCORE).toEqual({ 1: 4, 2: 8, 3: 12, 4: 18 });
  });

  it("transcribes cover-class bullet adjustments", () => {
    expect(COVER_CLASS_BULLET_DAMAGE_ADJUST).toEqual({ 1: -4, 2: 0, 3: 0, 4: 4 });
  });

  it("transcribes the weapon-property add table", () => {
    expect(WEAPON_ACCURACY_ADDS).toEqual([4, 7, 6, 5, 4, 3, 2, 1]);
  });
});
