import type { Posture, RobotClass } from "../../engine/types";
import {
  ROBOT_BODY_ASSETS,
  ROBOT_SPRITE_GEOMETRY,
  ROBOT_TURRET_ASSETS,
} from "../../renderer/assets";

/**
 * Static HTML composite of the production body + turret sprites, using the
 * same mount geometry as the board renderer. Decorative: callers name the
 * robot in adjacent text.
 */
export function RobotPortrait({
  robotClass,
  posture = "upright",
  size = 96,
}: {
  readonly robotClass: RobotClass;
  readonly posture?: Posture;
  readonly size?: number;
}) {
  const { bodyBox, turretBox, turretPivotY } = ROBOT_SPRITE_GEOMETRY;
  const turretPercent = (turretBox / bodyBox) * 100;
  return (
    <span
      className="robot-portrait"
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-class={robotClass}
      data-posture={posture}
    >
      <img src={ROBOT_BODY_ASSETS[robotClass][posture]} alt="" width={size} height={size} />
      <img
        src={ROBOT_TURRET_ASSETS[robotClass]}
        alt=""
        className="robot-portrait-turret"
        style={{
          width: `${turretPercent}%`,
          left: `${50 - turretPercent / 2}%`,
          top: `${(turretPivotY[posture] / bodyBox) * 100 - turretPercent / 2}%`,
        }}
      />
    </span>
  );
}
