import type { Posture } from "../../engine/types";

/**
 * "Mini Mech" posture icons (option A from the 2026-07-19 icon review):
 * a front-facing boxy robot — antenna, visor slit, shoulder pods, boots —
 * echoing the chibi board sprites. Posture reads as antenna height plus
 * stance: legs splay outward when ducking and the body hunkers into a wide
 * slab when crouching. currentColor throughout; decorative only — accessible
 * names belong on the wrapping control.
 */
export function PostureIcon({ posture }: { readonly posture: Posture }) {
  return (
    <svg
      className="posture-silhouette"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-posture={posture}
    >
      {posture === "upright" ? (
        <>
          <circle cx="12" cy="1.9" r=".9" />
          <rect x="11.55" y="2.6" width=".9" height="1.1" />
          <path
            fillRule="evenodd"
            d="M9.8 3.6h4.4a1.4 1.4 0 0 1 1.4 1.4v2.4a1.4 1.4 0 0 1-1.4 1.4H9.8a1.4 1.4 0 0 1-1.4-1.4V5a1.4 1.4 0 0 1 1.4-1.4zm.3 1.8v1.3h3.8V5.4z"
          />
          <rect x="9.2" y="9.4" width="5.6" height="5.4" rx=".9" />
          <rect x="7" y="9.8" width="1.7" height="4.2" rx=".8" />
          <rect x="15.3" y="9.8" width="1.7" height="4.2" rx=".8" />
          <rect x="9.6" y="15.2" width="2" height="4.6" rx=".4" />
          <rect x="12.4" y="15.2" width="2" height="4.6" rx=".4" />
          <rect x="8.8" y="19.9" width="3.1" height="1.7" rx=".5" />
          <rect x="12.1" y="19.9" width="3.1" height="1.7" rx=".5" />
        </>
      ) : posture === "ducking" ? (
        <>
          <circle cx="12" cy="5.3" r=".85" />
          <rect x="11.6" y="5.9" width=".8" height="1" />
          <path
            fillRule="evenodd"
            d="M9.9 6.9h4.2a1.3 1.3 0 0 1 1.3 1.3v2.2a1.3 1.3 0 0 1-1.3 1.3H9.9a1.3 1.3 0 0 1-1.3-1.3V8.2a1.3 1.3 0 0 1 1.3-1.3zm.2 1.7v1.3h3.8V8.6z"
          />
          <rect x="8.9" y="12" width="6.2" height="4.4" rx=".9" />
          <polygon points="7.9,12.3 6.2,15.6 7.7,16.3 9.4,13.1" />
          <polygon points="16.1,12.3 17.8,15.6 16.3,16.3 14.6,13.1" />
          <polygon points="10.6,16.3 8,18.7 9.7,21.7 11.7,21.7 11.1,18.5" />
          <polygon points="13.4,16.3 16,18.7 14.3,21.7 12.3,21.7 12.9,18.5" />
        </>
      ) : (
        <>
          <circle cx="12" cy="9.2" r=".8" />
          <rect x="11.6" y="9.8" width=".8" height=".9" />
          <path
            fillRule="evenodd"
            d="M10.1 10.6h3.8a1.2 1.2 0 0 1 1.2 1.2v2a1.2 1.2 0 0 1-1.2 1.2h-3.8a1.2 1.2 0 0 1-1.2-1.2v-2a1.2 1.2 0 0 1 1.2-1.2zm.2 1.6v1.2h3.4v-1.2z"
          />
          <rect x="8" y="15.2" width="8" height="4" rx="1.3" />
          <rect x="6.7" y="19.5" width="4.2" height="1.8" rx=".6" />
          <rect x="13.1" y="19.5" width="4.2" height="1.8" rx=".6" />
        </>
      )}
    </svg>
  );
}
