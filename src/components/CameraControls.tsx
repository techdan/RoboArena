"use client";

import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

export interface CameraControlsProps {
  readonly label: string;
  readonly zoom: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly dataAttribute?: "movie" | "planner";
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomReset: () => void;
}

/** Shared playback/planner zoom controls; camera gestures remain surface-owned. */
export function CameraControls({
  label,
  zoom,
  canZoomIn,
  canZoomOut,
  disabled = false,
  className = "",
  dataAttribute,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: CameraControlsProps) {
  return (
    <div
      className={`camera-controls flex items-center gap-1 rounded-xl border border-white/8 bg-black/20 p-1 ${className}`}
      aria-label={label}
    >
      <button
        className="transport-button"
        type="button"
        onClick={onZoomOut}
        aria-label="Zoom out"
        disabled={disabled || !canZoomOut}
      >
        <ZoomOut aria-hidden="true" className="size-4" />
      </button>
      <span
        className="w-12 text-center font-mono text-[11px] font-bold tracking-[0.08em] text-white/70"
        aria-live="polite"
        {...(dataAttribute === "movie"
          ? { "data-movie-zoom": true }
          : dataAttribute === "planner"
            ? { "data-planner-zoom": true }
            : {})}
      >
        {Math.round(zoom * 100)}%
      </span>
      <button
        className="transport-button"
        type="button"
        onClick={onZoomIn}
        aria-label="Zoom in"
        disabled={disabled || !canZoomIn}
      >
        <ZoomIn aria-hidden="true" className="size-4" />
      </button>
      <button
        className="transport-button"
        type="button"
        onClick={onZoomReset}
        aria-label="Reset zoom and pan"
        disabled={disabled}
      >
        <Maximize2 aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
