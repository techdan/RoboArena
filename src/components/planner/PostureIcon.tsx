import type { Posture } from "../../engine/types";

export function PostureIcon({ posture }: { readonly posture: Posture }) {
  return <span className="posture-silhouette" data-posture={posture} aria-hidden="true" />;
}
