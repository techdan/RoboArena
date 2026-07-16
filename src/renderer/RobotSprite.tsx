/** Layered Pixi robot visuals: one compact equivalent to the 12 planned posture SVGs. */

import { gsap } from "gsap";
import { Container, Graphics, Text } from "pixi.js";
import type { Heading, Posture } from "../engine/types";
import type { MovieRobotSnapshot } from "./animations";

export const MOVIE_TILE_SIZE = 20;

const TEAM_COLORS: Readonly<Record<string, number>> = {
  red: 0xf05252,
  blue: 0x4c8dff,
  green: 0x42c77a,
  yellow: 0xf2c94c,
};

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

const POSTURE_SCALE: Readonly<Record<Posture, number>> = {
  upright: 1,
  ducking: 0.86,
  crouching: 0.72,
};

const CLASS_LABEL = { rifle: "R", burst: "B", auto: "A", missile: "M", stealth: "S" } as const;

export interface RobotVisual {
  readonly container: Container;
  readonly body: Graphics;
  readonly scanNeedle: Graphics;
  destroyed: boolean;
}

export const createRobotSprite = (robot: MovieRobotSnapshot): RobotVisual => {
  const container = new Container();
  container.label = `robot:${robot.id}`;

  const shadow = new Graphics().ellipse(0, 6, 7, 3).fill({ color: 0x000000, alpha: 0.35 });
  const body = new Graphics()
    .roundRect(-7, -7, 14, 14, 4)
    .fill({ color: TEAM_COLORS[robot.teamColor] ?? 0xe8e8e8 })
    .stroke({ color: 0xffffff, alpha: 0.5, width: 1 });
  const core = new Graphics().circle(0, 0, 3).fill({ color: 0x111914 });
  const label = new Text({
    text: CLASS_LABEL[robot.robotClass],
    style: { fill: 0xffffff, fontFamily: "monospace", fontSize: 7, fontWeight: "700" },
  });
  label.anchor.set(0.5);
  const scanNeedle = new Graphics()
    .moveTo(5, 0)
    .lineTo(10, 0)
    .stroke({ color: 0xb7ff79, alpha: 0.9, width: 2 });

  container.addChild(shadow, body, core, label, scanNeedle);
  placeRobot(container, robot);
  container.scale.set(POSTURE_SCALE[robot.posture]);
  scanNeedle.rotation = HEADING_RADIANS[robot.scanHeading];
  return { container, body, scanNeedle, destroyed: robot.destroyed };
};

const placeRobot = (container: Container, robot: MovieRobotSnapshot) => {
  if (robot.position === "dock") {
    container.visible = false;
    return;
  }
  container.visible = true;
  container.position.set(
    robot.position.x * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2,
    robot.position.y * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2,
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
  const x = robot.position.x * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2;
  const y = robot.position.y * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2;
  const scale = POSTURE_SCALE[robot.posture];
  gsap.killTweensOf([visual.container.position, visual.container.scale, visual.scanNeedle]);
  if (animate) {
    gsap.to(visual.container.position, { x, y, duration: 0.18, ease: "power1.inOut" });
    gsap.to(visual.container.scale, { x: scale, y: scale, duration: 0.16 });
    gsap.to(visual.scanNeedle, { rotation: HEADING_RADIANS[robot.scanHeading], duration: 0.16 });
  } else {
    visual.container.position.set(x, y);
    visual.container.scale.set(scale);
    visual.scanNeedle.rotation = HEADING_RADIANS[robot.scanHeading];
  }
  visual.container.alpha = robot.destroyed ? 0 : 1;
  visual.destroyed = robot.destroyed;
};
