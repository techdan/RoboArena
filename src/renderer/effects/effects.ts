/** Short-lived Pixi projectile, impact, hit, and destruction effects. */

import { gsap } from "gsap";
import { Graphics } from "pixi.js";
import type { Container } from "pixi.js";
import type { ResolutionEvent, TileCoord } from "../../engine/types";
import { MOVIE_TILE_SIZE } from "../RobotSprite";

const center = (tile: TileCoord) => ({
  x: tile.x * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2,
  y: tile.y * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2,
});

const removeAfter = (graphic: Graphics, duration: number) => {
  gsap.to(graphic, {
    alpha: 0,
    duration,
    ease: "power2.out",
    onComplete: () => graphic.destroy(),
  });
};

export const renderMovieEffects = (
  layer: Container,
  events: readonly ResolutionEvent[],
  robotPositions: Readonly<Record<string, TileCoord | "dock">>,
) => {
  layer.removeChildren().forEach((child) => child.destroy());
  for (const event of events) {
    if (event.kind === "projectile-launched") {
      const from = center(event.from);
      const to = center(event.target);
      const tracer = new Graphics()
        .moveTo(from.x, from.y)
        .lineTo(to.x, to.y)
        .stroke({
          color: event.weapon.includes("missile") ? 0xffc65c : 0xe8ffb7,
          alpha: 0.9,
          width: 2,
        });
      layer.addChild(tracer);
      removeAfter(tracer, 0.28);
    }
    if (event.kind === "projectile-impacted") {
      const at = center(event.target);
      const explosive = event.weapon === "missile-launcher" || event.weapon === "grenade-launcher";
      const impact = new Graphics()
        .circle(0, 0, explosive ? 14 : 6)
        .fill({ color: explosive ? 0xff7a38 : 0xffdf75, alpha: 0.9 })
        .stroke({ color: 0xffffff, alpha: 0.8, width: 2 });
      impact.position.set(at.x, at.y);
      layer.addChild(impact);
      gsap.fromTo(
        impact.scale,
        { x: 0.3, y: 0.3 },
        { x: 1.6, y: 1.6, duration: explosive ? 0.5 : 0.25 },
      );
      removeAfter(impact, explosive ? 0.55 : 0.3);
    }
    if (event.kind === "damaged" || event.kind === "destroyed") {
      const robotId = event.kind === "damaged" ? event.targetId : event.robotId;
      const position = robotPositions[robotId];
      if (position === undefined || position === "dock") continue;
      const at = center(position);
      const destroyed = event.kind === "destroyed";
      const burst = new Graphics()
        .star(0, 0, destroyed ? 10 : 7, destroyed ? 18 : 9, destroyed ? 7 : 4)
        .fill({ color: destroyed ? 0xff4f2f : 0xffcf52, alpha: 0.95 });
      burst.position.set(at.x, at.y);
      layer.addChild(burst);
      gsap.to(burst, {
        rotation: destroyed ? Math.PI : Math.PI / 3,
        duration: destroyed ? 0.55 : 0.25,
      });
      gsap.fromTo(
        burst.scale,
        { x: 0.25, y: 0.25 },
        { x: 1.25, y: 1.25, duration: destroyed ? 0.45 : 0.2 },
      );
      removeAfter(burst, destroyed ? 0.65 : 0.32);
    }
  }
};
