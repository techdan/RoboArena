"use client";

import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

export interface CameraControlsProps {
  readonly label: string;
  readonly zoom: number;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly compact?: boolean;
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
  compact = false,
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
      <button
        type="button"
        className="camera-zoom-value"
        onClick={onZoomReset}
        aria-label="Reset zoom and pan"
        title="Reset zoom and pan"
        disabled={disabled}
        aria-live="polite"
        {...(dataAttribute === "movie"
          ? { "data-movie-zoom": true }
          : dataAttribute === "planner"
            ? { "data-planner-zoom": true }
            : {})}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        className="transport-button"
        type="button"
        onClick={onZoomIn}
        aria-label="Zoom in"
        disabled={disabled || !canZoomIn}
      >
        <ZoomIn aria-hidden="true" className="size-4" />
      </button>
      {compact ? null : (
        <button
          className="transport-button"
          type="button"
          onClick={onZoomReset}
          aria-label="Reset zoom and pan"
          disabled={disabled}
        >
          <Maximize2 aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
