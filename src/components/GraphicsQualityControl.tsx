"use client";

import { useEffect, useState } from "react";
import {
  GRAPHICS_QUALITIES,
  GRAPHICS_QUALITY_EVENT,
  GRAPHICS_QUALITY_KEY,
  isGraphicsQuality,
  preferredGraphicsQuality,
  rememberGraphicsQuality,
  type GraphicsQuality,
} from "../renderer3d/quality";

/** A local presentation choice; never changes orders or authoritative match state. */
export function GraphicsQualityControl() {
  const [quality, setQuality] = useState<GraphicsQuality>("cinematic");
  useEffect(() => {
    const refresh = (event?: Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== GRAPHICS_QUALITY_KEY)
        return;
      const requested = event instanceof CustomEvent ? event.detail : null;
      setQuality(isGraphicsQuality(requested) ? requested : preferredGraphicsQuality());
    };
    refresh();
    window.addEventListener(GRAPHICS_QUALITY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(GRAPHICS_QUALITY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return (
    <label className="graphics-quality-control">
      <span>Graphics</span>
      <select
        aria-label="Graphics quality"
        value={quality}
        onChange={(event) => {
          const next = event.target.value;
          if (isGraphicsQuality(next)) rememberGraphicsQuality(next);
        }}
        title="Cinematic keeps full resolution. Balanced and Performance favor smoother play on older GPUs."
      >
        {Object.entries(GRAPHICS_QUALITIES).map(([value, option]) => (
          <option key={value} value={value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
