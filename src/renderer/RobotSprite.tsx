/** Textured Foundry Plate robot visuals: posture-aware body swap + rotating class turret. */

import { gsap } from "gsap";
import { Container, Sprite } from "pixi.js";
import type { Heading, Posture } from "../engine/types";
import type { MovieRobotSnapshot } from "./animations";
import { ROBOT_SPRITE_GEOMETRY } from "./assets";
import type { RobotTextureSet } from "./robotTextures";

/** 28px tiles: 20px (Phase 6/7 placeholder size) proved too small to read
 *  robot stances on a desktop display; 24×24 and 32×32 arenas still fit. */
export const MOVIE_TILE_SIZE = 28;

/** Slightly over one tile so the chassis fills its footprint on the board. */
const bodySize = (tileSize: number) => tileSize * 1.15;
const turretSize = (tileSize: number) =>
  bodySize(tileSize) * (ROBOT_SPRITE_GEOMETRY.turretBox / ROBOT_SPRITE_GEOMETRY.bodyBox);

const HEADING_RADIANS: Readonly<Record<Heading, number>> = {
  N: -Math.PI / 2,
  NE: -Math.PI / 4,
  E: 0,
  SE: Math.PI / 4,
  S: Math.PI / 2,
  SW: (3 * Math.PI) / 4,
  W: Math.PI,
  NW: (-3 * Math.PI) / 4,
};

/** Turret art points N at rotation 0; headings are E-based angles. */
const headingRotation = (heading: Heading) => HEADING_RADIANS[heading] + Math.PI / 2;

/** The turret mount drops as the hull hunkers; offset from the body center. */
const turretOffsetY = (posture: Posture, tileSize: number) =>
  ((ROBOT_SPRITE_GEOMETRY.turretPivotY[posture] - ROBOT_SPRITE_GEOMETRY.bodyBox / 2) /
    ROBOT_SPRITE_GEOMETRY.bodyBox) *
  bodySize(tileSize);

export interface RobotVisual {
  readonly container: Container;
  readonly body: Sprite;
  readonly turret: Sprite;
  readonly textures: RobotTextureSet;
  readonly tileSize: number;
  destroyed: boolean;
}

export const createRobotSprite = (
  robot: MovieRobotSnapshot,
  textures: RobotTextureSet,
  tileSize = MOVIE_TILE_SIZE,
): RobotVisual => {
  const container = new Container();
  container.label = `robot:${robot.id}`;

  const body = new Sprite(robot.destroyed ? textures.wreck : textures.bodies[robot.posture]);
  body.anchor.set(0.5);
  body.width = bodySize(tileSize);
  body.height = bodySize(tileSize);

  const turret = new Sprite(textures.turret);
  turret.anchor.set(0.5);
  turret.width = turretSize(tileSize);
  turret.height = turretSize(tileSize);
  turret.position.set(0, turretOffsetY(robot.posture, tileSize));
  turret.rotation = headingRotation(robot.scanHeading);
  turret.visible = !robot.destroyed;

  container.addChild(body, turret);
  placeRobot(container, robot, tileSize);
  return { container, body, turret, textures, tileSize, destroyed: robot.destroyed };
};

const placeRobot = (container: Container, robot: MovieRobotSnapshot, tileSize: number) => {
  if (robot.position === "dock") {
    container.visible = false;
    return;
  }
  container.visible = true;
  container.position.set(
    robot.position.x * tileSize + tileSize / 2,
    robot.position.y * tileSize + tileSize / 2,
  );
};

export const updateRobotSprite = (
  visual: RobotVisual,
  robot: MovieRobotSnapshot,
  animate: boolean,
) => {
  if (robot.position === "dock") {
    visual.container.visible = false;
    return;
  }
  visual.container.visible = true;
  const x = robot.position.x * visual.tileSize + visual.tileSize / 2;
  const y = robot.position.y * visual.tileSize + visual.tileSize / 2;
  const turretY = turretOffsetY(robot.posture, visual.tileSize);
  const turretRotation = headingRotation(robot.scanHeading);

  visual.body.texture = robot.destroyed
    ? visual.textures.wreck
    : visual.textures.bodies[robot.posture];
  visual.turret.visible = !robot.destroyed;
  visual.destroyed = robot.destroyed;

  gsap.killTweensOf([visual.container.position, visual.turret.position, visual.turret]);
  if (animate) {
    gsap.to(visual.container.position, { x, y, duration: 0.18, ease: "power1.inOut" });
    gsap.to(visual.turret.position, { y: turretY, duration: 0.16 });
    gsap.to(visual.turret, { rotation: turretRotation, duration: 0.16 });
  } else {
    visual.container.position.set(x, y);
    visual.turret.position.set(0, turretY);
    visual.turret.rotation = turretRotation;
  }
};
