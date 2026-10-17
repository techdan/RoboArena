"use client";

import { useEffect, useState } from "react";
import {
  GRAPHICS_QUALITY_EVENT,
  GRAPHICS_QUALITY_KEY,
  isGraphicsQuality,
  preferredGraphicsQuality,
  type GraphicsQuality,
} from "../../renderer3d/quality";

/** The player's local graphics preset, kept in step with the picker and other tabs. */
export function useGraphicsQuality(): GraphicsQuality {
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
  return quality;
}
