/** Short-lived textured effects for movie playback (Foundry Plate effect sprites).
 *
 * Every texture used here must be preloaded (MoviePlayer awaits
 * EFFECT_ASSET_URLS + MARKER_ASSET_URLS) because effect spawning happens
 * inside the synchronous per-tick render pass via `Assets.get`.
 *
 * Two timing rules keep effects honest against the movie clock:
 *
 *  - Durations scale with playback speed. Beats shrink at 2x and 4x, so fixed
 *    seconds meant a missile was still mid-flight when its beat ended, and
 *    every effect hung dead in the air at 0.5x.
 *  - The layer is only cleared on a seek. `docs/implementation-plan.md` §5
 *    states that an animation outrunning its tick budget simply keeps
 *    rendering; clearing on every advance truncated exactly those effects.
 */

import { gsap } from "gsap";
import { Assets, Sprite } from "pixi.js";
import type { Container, Graphics, Texture } from "pixi.js";
import type { TileCoord } from "../../engine/types";
import type { ParticipantResolutionEvent } from "../../lib/net/protocol";
import { EFFECT_ASSETS, MARKER_ASSETS } from "../assets";
import { MOVIE_TILE_SIZE } from "../RobotSprite";

const EXPLOSIVE_WEAPONS: ReadonlySet<string> = new Set(["missile-launcher", "grenade-launcher"]);

const center = (tile: TileCoord) => ({
  x: tile.x * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2,
  y: tile.y * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2,
});

/** Effect art points N at rotation 0. */
const rotationToward = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;

/** Rescales an authored duration onto the current playback speed. */
type Clock = (seconds: number) => number;

const spawn = (
  layer: Container,
  url: string,
  at: { x: number; y: number },
  width: number,
): Sprite | undefined => {
  const texture = Assets.get<Texture>(url);
  if (texture === undefined) return undefined;
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.position.set(at.x, at.y);
  sprite.width = width;
  sprite.height = width * (texture.height / texture.width);
  layer.addChild(sprite);
  return sprite;
};

const removeAfter = (target: Sprite | Graphics, duration: number) => {
  gsap.to(target, {
    alpha: 0,
    duration,
    ease: "power2.out",
    onComplete: () => target.destroy(),
  });
};

const pop = (sprite: Sprite, fromScale: number, toScale: number, duration: number) => {
  gsap.fromTo(
    sprite.scale,
    { x: sprite.scale.x * fromScale, y: sprite.scale.y * fromScale },
    { x: sprite.scale.x * toScale, y: sprite.scale.y * toScale, duration },
  );
};

const explosion = (layer: Container, at: { x: number; y: number }, big: boolean, secs: Clock) => {
  const blast = spawn(
    layer,
    big ? EFFECT_ASSETS.explosionLarge : EFFECT_ASSETS.explosionSmall,
    at,
    MOVIE_TILE_SIZE * (big ? 2.1 : 0.95),
  );
  if (blast !== undefined) {
    pop(blast, 0.3, 1.25, secs(big ? 0.5 : 0.25));
    removeAfter(blast, secs(big ? 0.6 : 0.32));
  }
  if (big) {
    const ring = spawn(layer, EFFECT_ASSETS.blastRing, at, MOVIE_TILE_SIZE * 2.4);
    if (ring !== undefined) {
      pop(ring, 0.35, 1.5, secs(0.5));
      removeAfter(ring, secs(0.5));
    }
    const smoke = spawn(layer, EFFECT_ASSETS.smokePuff, at, MOVIE_TILE_SIZE * 1.3);
    if (smoke !== undefined) {
      gsap.to(smoke.position, { y: at.y - MOVIE_TILE_SIZE * 0.5, duration: secs(0.7) });
      removeAfter(smoke, secs(0.75));
    }
  }
};

/** A Time Bomb: the large blast plus a ring that reaches its four-tile radius. */
const bombBlast = (layer: Container, at: { x: number; y: number }, secs: Clock) => {
  explosion(layer, at, true, secs);
  const core = spawn(layer, EFFECT_ASSETS.explosionLarge, at, MOVIE_TILE_SIZE * 3.4);
  if (core !== undefined) {
    pop(core, 0.25, 1.2, secs(0.6));
    removeAfter(core, secs(0.8));
  }
  const ring = spawn(layer, EFFECT_ASSETS.blastRing, at, MOVIE_TILE_SIZE * 9);
  if (ring !== undefined) {
    ring.alpha = 0.7;
    pop(ring, 0.15, 1, secs(0.55));
    removeAfter(ring, secs(0.7));
  }
};

/** Zap: two crossed blue-white crackles on the zapper's tile. */
const zapCrackle = (layer: Container, at: { x: number; y: number }, secs: Clock) => {
  for (const [index, rotation] of [0, Math.PI / 3].entries()) {
    const spark = spawn(layer, EFFECT_ASSETS.hitSpark, at, MOVIE_TILE_SIZE * (1.1 - index * 0.2));
    if (spark === undefined) continue;
    spark.tint = 0x8fe9ff;
    spark.rotation = rotation;
    pop(spark, 0.5, 1.2, secs(0.2));
    removeAfter(spark, secs(0.3 + index * 0.1));
  }
};

const clearLayer = (layer: Container) => {
  layer.removeChildren().forEach((child) => {
    gsap.killTweensOf([child, child.scale, child.position]);
    child.destroy();
  });
};

export interface MovieEffectOptions {
  readonly reducedMotion: boolean;
  /** Playback speed; effect lifetimes scale with it so beats stay in step. */
  readonly speed: number;
  /**
   * Discard effects still in flight. True for seeks, scrubs and restarts, where
   * leftovers belong to a tick the viewer has jumped away from; false for an
   * ordinary forward advance, so a projectile may outlive its own beat.
   */
  readonly reset: boolean;
}

export const renderMovieEffects = (
  layer: Container,
  events: readonly ParticipantResolutionEvent[],
  robotPositions: Readonly<Record<string, TileCoord | "dock">>,
  options: MovieEffectOptions,
) => {
  if (options.reset || options.reducedMotion) clearLayer(layer);
  if (options.reducedMotion) return;

  const speed = Math.max(options.speed, 0.01);
  const secs: Clock = (seconds) => seconds / speed;

  const tileOf = (robotId: string): { x: number; y: number } | undefined => {
    const position = robotPositions[robotId];
    return position === undefined || position === "dock" ? undefined : center(position);
  };

  for (const event of events) {
    if (event.kind === "fired") {
      const from = tileOf(event.shooterId);
      if (from === undefined) continue;
      const to = center(event.target);
      const flash = spawn(layer, EFFECT_ASSETS.muzzleFlash, from, MOVIE_TILE_SIZE * 0.7);
      if (flash !== undefined) {
        flash.rotation = rotationToward(from, to);
        pop(flash, 0.6, 1.1, secs(0.12));
        removeAfter(flash, secs(0.16));
      }
    }
    if (event.kind === "projectile-launched") {
      const from = center(event.from);
      const to = center(event.target);
      if (event.weapon === "missile-launcher") {
        const missile = spawn(layer, EFFECT_ASSETS.projectileMissile, from, MOVIE_TILE_SIZE * 0.5);
        if (missile !== undefined) {
          missile.rotation = rotationToward(from, to);
          gsap.to(missile.position, {
            x: to.x,
            y: to.y,
            duration: secs(0.3),
            ease: "power1.in",
          });
          removeAfter(missile, secs(0.32));
        }
      } else if (event.weapon === "grenade-launcher") {
        const grenade = spawn(layer, EFFECT_ASSETS.projectileGrenade, from, MOVIE_TILE_SIZE * 0.35);
        if (grenade !== undefined) {
          gsap.to(grenade.position, { x: to.x, y: to.y, duration: secs(0.34), ease: "none" });
          // Fake lob height: swell mid-flight, settle on approach.
          gsap
            .timeline()
            .to(grenade.scale, {
              x: grenade.scale.x * 1.5,
              y: grenade.scale.y * 1.5,
              duration: secs(0.17),
            })
            .to(grenade.scale, { x: grenade.scale.x, y: grenade.scale.y, duration: secs(0.17) });
          removeAfter(grenade, secs(0.36));
        }
      } else {
        const tracer = spawn(layer, EFFECT_ASSETS.tracerBullet, from, MOVIE_TILE_SIZE * 0.22);
        if (tracer !== undefined) {
          tracer.anchor.set(0.5, 0.125);
          tracer.rotation = rotationToward(from, to);
          gsap.to(tracer.position, { x: to.x, y: to.y, duration: secs(0.18), ease: "none" });
          removeAfter(tracer, secs(0.2));
        }
      }
    }
    if (event.kind === "projectile-impacted") {
      explosion(layer, center(event.target), EXPLOSIVE_WEAPONS.has(event.weapon), secs);
    }
    if (event.kind === "shot-missed") {
      const dust = spawn(
        layer,
        EFFECT_ASSETS.dustMiss,
        center(event.target),
        MOVIE_TILE_SIZE * 0.8,
      );
      if (dust !== undefined) {
        pop(dust, 0.5, 1.1, secs(0.28));
        removeAfter(dust, secs(0.4));
      }
    }
    if (event.kind === "damaged") {
      const at = tileOf(event.targetId);
      if (at === undefined) continue;
      if (event.damageKind === "zap") {
        zapCrackle(layer, at, secs);
        continue;
      }
      if (event.damageKind === "direct") {
        const spark = spawn(layer, EFFECT_ASSETS.hitSpark, at, MOVIE_TILE_SIZE * 0.9);
        if (spark !== undefined) {
          pop(spark, 0.4, 1.15, secs(0.18));
          removeAfter(spark, secs(0.22));
        }
      }
      explosion(layer, at, false, secs);
    }
    if (event.kind === "zapped") zapCrackle(layer, center(event.at), secs);
    if (event.kind === "bomb-exploded") bombBlast(layer, center(event.at), secs);
    if (event.kind === "destroyed") {
      const at = tileOf(event.robotId);
      if (at !== undefined) explosion(layer, at, true, secs);
    }
    if (event.kind === "scan-target-acquired") {
      const at = tileOf(event.targetId);
      if (at === undefined) continue;
      const reticle = spawn(layer, MARKER_ASSETS.scanLock, at, MOVIE_TILE_SIZE * 1.1);
      if (reticle !== undefined) {
        pop(reticle, 1.4, 1, secs(0.2));
        removeAfter(reticle, secs(0.5));
      }
    }
    if (event.kind === "enemy-lost" || event.kind === "last-known-marker") {
      const tile = event.kind === "enemy-lost" ? event.lastSeenAt : event.at;
      const ghost = spawn(layer, MARKER_ASSETS.lastKnown, center(tile), MOVIE_TILE_SIZE);
      if (ghost !== undefined) {
        ghost.alpha = 0.55;
        removeAfter(ghost, secs(0.8));
      }
    }
  }
};
