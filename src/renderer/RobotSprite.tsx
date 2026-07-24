/** Textured Foundry Plate robot visuals: posture-aware body swap, rotating
 *  class turret, and the transform-only hop rig from `motion.ts`.
 *
 *  Layout, outermost first:
 *
 *    container            ground position; walks the tile path
 *    ├── shadow           ground-anchored contact ellipse
 *    └── lift             hop height, squash, and lean about the ground anchor
 *        └── react        event reactions: flinch, collapse, drop-in
 *            ├── body     + bodyFade, the outgoing texture during a cross-fade
 *            └── recoil   weapon kick
 *                └── turret
 *
 *  Keeping the shadow outside `lift` is what makes the hop read as height
 *  rather than as the whole robot being dragged upward — see
 *  `stripBakedShadow` for the other half of that separation.
 *
 *  Every layer has exactly one writer, which is what keeps the hop and the
 *  reactions from fighting: `lift` belongs to the movement profile and is
 *  rewritten on every snapshot, so anything that must survive a redraw —
 *  a flinch, a death collapse, a deploy drop — lives on `react` instead.
 */

import { gsap } from "gsap";
import { Container, Graphics, Sprite } from "pixi.js";
import type { Heading, Posture, TileCoord } from "../engine/types";
import type { MovieRobotSnapshot } from "./animations";
import { ROBOT_SPRITE_GEOMETRY } from "./assets";
import { planMovement, RESTING_POSE, samplePlan, type MovementPose } from "./motion";
import type { RobotTextureSet } from "./robotTextures";

/** 28px tiles: 20px (Phase 6/7 placeholder size) proved too small to read
 *  robot stances on a desktop display; 24×24 and 32×32 arenas still fit. */
export const MOVIE_TILE_SIZE = 28;

/** Slightly over one tile so the chassis fills its footprint on the board. */
const bodySize = (tileSize: number) => tileSize * 1.15;
const turretSize = (tileSize: number) =>
  bodySize(tileSize) * (ROBOT_SPRITE_GEOMETRY.turretBox / ROBOT_SPRITE_GEOMETRY.bodyBox);

/** Converts a body-space offset from the sprite centre into container pixels. */
const fromBodyCentre = (bodyY: number, tileSize: number) =>
  ((bodyY - ROBOT_SPRITE_GEOMETRY.bodyBox / 2) / ROBOT_SPRITE_GEOMETRY.bodyBox) *
  bodySize(tileSize);

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
  fromBodyCentre(ROBOT_SPRITE_GEOMETRY.turretPivotY[posture], tileSize);

export interface RobotVisual {
  readonly container: Container;
  /** Everything that leaves the ground during a hop. */
  readonly lift: Container;
  /** Owned solely by event reactions, so a snapshot redraw cannot cancel them. */
  readonly react: Container;
  /** Weapon kick, kept off the turret's own posture-driven mount offset. */
  readonly recoil: Container;
  readonly shadow: Graphics;
  readonly body: Sprite;
  /** Holds the outgoing body texture while a posture change cross-fades. */
  readonly bodyFade: Sprite;
  readonly turret: Sprite;
  readonly textures: RobotTextureSet;
  readonly tileSize: number;
  /** Ground-anchor offset in container pixels; the hop's transform origin. */
  readonly groundY: number;
  destroyed: boolean;
  /** Last presented tile, so a redraw can tell movement from a repaint. */
  tile: TileCoord | null;
  /** In-flight hop, kept so unrelated redraws cannot interrupt it. */
  hop: gsap.core.Tween | null;
}

const createShadow = (tileSize: number): Graphics => {
  const { shadow, bodyBox } = ROBOT_SPRITE_GEOMETRY;
  const scale = bodySize(tileSize) / bodyBox;
  const graphics = new Graphics();
  graphics.label = "shadow";
  // Drawn about its own centre so a hop scales the ellipse in place.
  graphics
    .ellipse(0, 0, shadow.rx * scale, shadow.ry * scale)
    .fill({ color: shadow.fill, alpha: 1 });
  graphics.position.set(0, fromBodyCentre(shadow.cy, tileSize));
  graphics.alpha = shadow.alpha;
  return graphics;
};

export const createRobotSprite = (
  robot: MovieRobotSnapshot,
  textures: RobotTextureSet,
  tileSize = MOVIE_TILE_SIZE,
): RobotVisual => {
  const container = new Container();
  container.label = `robot:${robot.id}`;

  const shadow = createShadow(tileSize);

  const body = new Sprite(robot.destroyed ? textures.wreck : textures.bodies[robot.posture]);
  body.anchor.set(0.5);
  body.width = bodySize(tileSize);
  body.height = bodySize(tileSize);

  // Sits over the body holding whatever texture is being replaced, so a posture
  // change dissolves instead of popping.
  const bodyFade = new Sprite(body.texture);
  bodyFade.anchor.set(0.5);
  bodyFade.width = bodySize(tileSize);
  bodyFade.height = bodySize(tileSize);
  bodyFade.alpha = 0;

  const turret = new Sprite(textures.turret);
  turret.anchor.set(0.5);
  turret.width = turretSize(tileSize);
  turret.height = turretSize(tileSize);
  turret.position.set(0, turretOffsetY(robot.posture, tileSize));
  turret.rotation = headingRotation(robot.scanHeading);
  turret.visible = !robot.destroyed;

  // Pivot on the feet: scaling a top-down sprite about its centre reads as
  // inflating, whereas the same numbers about the ground anchor read as the
  // hull compressing under load.
  const groundY = fromBodyCentre(ROBOT_SPRITE_GEOMETRY.groundAnchorY, tileSize);
  const lift = new Container();
  lift.label = "lift";
  lift.pivot.set(0, groundY);
  lift.position.set(0, groundY);

  const recoil = new Container();
  recoil.label = "recoil";
  recoil.addChild(turret);

  // Reactions pivot on the feet too, so a collapse folds the hull down rather
  // than shrinking it toward its own middle.
  const react = new Container();
  react.label = "react";
  react.pivot.set(0, groundY);
  react.position.set(0, groundY);
  react.addChild(body, bodyFade, recoil);

  lift.addChild(react);
  container.addChild(shadow, lift);

  const visual: RobotVisual = {
    container,
    lift,
    react,
    recoil,
    shadow,
    body,
    bodyFade,
    turret,
    textures,
    tileSize,
    groundY,
    destroyed: robot.destroyed,
    tile: robot.position === "dock" ? null : robot.position,
    hop: null,
  };
  applyPose(visual, visual.tile, visual.tile, RESTING_POSE);
  container.visible = robot.position !== "dock";
  return visual;
};

/** Writes one sampled pose onto the rig, interpolating the ground path. */
const applyPose = (
  visual: RobotVisual,
  from: TileCoord | null,
  to: TileCoord | null,
  pose: MovementPose,
) => {
  const size = visual.tileSize;
  if (from !== null && to !== null) {
    const x = from.x + (to.x - from.x) * pose.progress;
    const y = from.y + (to.y - from.y) * pose.progress;
    visual.container.position.set(x * size + size / 2, y * size + size / 2);
  }
  visual.lift.position.set(0, visual.groundY + pose.lift * size);
  visual.lift.scale.set(pose.scaleX, pose.scaleY);
  visual.lift.rotation = (pose.leanDegrees * Math.PI) / 180;
  visual.shadow.scale.set(pose.shadowScale);
  visual.shadow.alpha = ROBOT_SPRITE_GEOMETRY.shadow.alpha * pose.shadowAlpha;
};

const settle = (visual: RobotVisual, tile: TileCoord) =>
  applyPose(visual, tile, tile, RESTING_POSE);

export interface RobotSpriteUpdate {
  /** False for reduced motion and for the first paint after a seek. */
  readonly animate: boolean;
  /** Movie playback speed, so the hop lasts exactly its engine tick budget. */
  readonly speed: number;
}

export const updateRobotSprite = (
  visual: RobotVisual,
  robot: MovieRobotSnapshot,
  update: RobotSpriteUpdate,
) => {
  if (robot.position === "dock") {
    visual.container.visible = false;
    visual.hop?.kill();
    visual.hop = null;
    visual.tile = null;
    return;
  }
  visual.container.visible = true;

  const nextTexture = robot.destroyed
    ? visual.textures.wreck
    : visual.textures.bodies[robot.posture];
  if (visual.body.texture !== nextTexture) {
    // Cross-fade rather than pop, per implementation-plan.md §5's 100 ms
    // posture swap: the outgoing texture rides on top and dissolves away.
    visual.bodyFade.texture = visual.body.texture;
    visual.body.texture = nextTexture;
    gsap.killTweensOf(visual.bodyFade);
    if (update.animate) {
      visual.bodyFade.alpha = 1;
      gsap.to(visual.bodyFade, { alpha: 0, duration: 0.1 / Math.max(update.speed, 0.01) });
    } else {
      visual.bodyFade.alpha = 0;
    }
  }
  visual.turret.visible = !robot.destroyed;
  visual.destroyed = robot.destroyed;

  const turretY = turretOffsetY(robot.posture, visual.tileSize);
  const turretRotation = headingRotation(robot.scanHeading);
  gsap.killTweensOf([visual.turret.position, visual.turret]);
  if (update.animate) {
    gsap.to(visual.turret.position, { y: turretY, duration: 0.16 });
    gsap.to(visual.turret, { rotation: turretRotation, duration: 0.16 });
  } else {
    visual.turret.position.set(0, turretY);
    visual.turret.rotation = turretRotation;
  }

  const previous = visual.tile;
  const target = robot.position;
  const moved = previous === null || previous.x !== target.x || previous.y !== target.y;

  // Every visible robot is redrawn on every snapshot, so most calls arrive for
  // a robot that did not move. Restarting its tween here is what would make
  // idle robots twitch whenever anyone else acted — leave an in-flight hop to
  // finish, and only re-settle a robot that is already at rest.
  if (!moved) {
    if (visual.hop === null) settle(visual, target);
    return;
  }

  visual.tile = target;
  visual.hop?.kill();
  visual.hop = null;

  const plan =
    update.animate && previous !== null ? planMovement(previous, target, update.speed) : null;
  if (plan === null || previous === null) {
    settle(visual, target);
    return;
  }

  // A linear clock drives the tween; all shaping lives in the pure profile, so
  // the motion is identical to what `motion.test.ts` locks down.
  const clock = { u: 0 };
  visual.hop = gsap.to(clock, {
    u: 1,
    duration: plan.durationMs / 1000,
    ease: "none",
    onUpdate: () => applyPose(visual, previous, target, samplePlan(plan, clock.u)),
    onComplete: () => {
      visual.hop = null;
      settle(visual, target);
    },
  });
};
