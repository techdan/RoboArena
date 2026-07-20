import type { Posture } from "../../engine/types";

/**
 * Modern redraws of the original RoboSport posture silhouettes: one solid
 * front-facing figure whose head height and body mass drop from Upright
 * through Ducking to Crouching. Filled with currentColor so the strip,
 * timeline glyphs, and legend tint them like any other icon. Decorative only —
 * accessible names belong on the wrapping control.
 */
const SILHOUETTE_PATHS: Readonly<
  Record<Posture, { head: [number, number, number]; body: string }>
> = {
  // Tall figure, slight taper to the hips, legs parted to the ground line.
  upright: {
    head: [12, 4.4, 2.5],
    body: "M9.2 8h5.6l-.5 6.6.9 6.4h-2.1l-.7-5.2h-.8l-.7 5.2H8.8l.9-6.4z",
  },
  // Head drops, knees bend and splay outward.
  ducking: {
    head: [12, 7.9, 2.5],
    body: "M9.5 11.5h5l-.3 4 2.3 3.3-1.7 1.3-2.8-3.5-2.8 3.5-1.7-1.3 2.3-3.3z",
  },
  // Compact squat mass hugging the ground.
  crouching: {
    head: [12, 11.5, 2.4],
    body: "M9.1 14.7h5.8l2 3.1-1 3.2H8.1l-1-3.2z",
  },
};

export function PostureIcon({ posture }: { readonly posture: Posture }) {
  const { head, body } = SILHOUETTE_PATHS[posture];
  const [cx, cy, r] = head;
  return (
    <svg
      className="posture-silhouette"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-posture={posture}
    >
      <circle cx={cx} cy={cy} r={r} />
      <path d={body} />
    </svg>
  );
}
