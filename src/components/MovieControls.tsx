"use client";

import { Pause, Play, RotateCcw, SkipBack, SkipForward, Zap } from "lucide-react";

export type MovieSpeed = 0.5 | 1 | 2 | 4;

interface MovieControlsProps {
  readonly playing: boolean;
  readonly currentIndex: number;
  readonly maxIndex: number;
  readonly tick: number;
  readonly speed: MovieSpeed;
  readonly compressIdle: boolean;
  readonly onTogglePlaying: () => void;
  readonly onStepBack: () => void;
  readonly onStepForward: () => void;
  readonly onRestart: () => void;
  readonly onScrub: (index: number) => void;
  readonly onSpeedChange: (speed: MovieSpeed) => void;
  readonly onCompressIdleChange: (enabled: boolean) => void;
}

const SPEEDS: readonly MovieSpeed[] = [0.5, 1, 2, 4];

export function MovieControls(props: MovieControlsProps) {
  return (
    <div className="movie-controls" aria-label="Movie transport controls">
      <div className="flex items-center gap-2">
        <button
          className="transport-button"
          type="button"
          onClick={props.onRestart}
          aria-label="Restart movie"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
        </button>
        <button
          className="transport-button"
          type="button"
          onClick={props.onStepBack}
          aria-label="Step backward"
        >
          <SkipBack aria-hidden="true" className="size-4" />
        </button>
        <button
          className="transport-button transport-button-primary"
          type="button"
          onClick={props.onTogglePlaying}
          aria-label={props.playing ? "Pause movie" : "Play movie"}
        >
          {props.playing ? (
            <Pause aria-hidden="true" className="size-5" />
          ) : (
            <Play aria-hidden="true" className="size-5 fill-current" />
          )}
        </button>
        <button
          className="transport-button"
          type="button"
          onClick={props.onStepForward}
          aria-label="Step forward"
        >
          <SkipForward aria-hidden="true" className="size-4" />
        </button>
      </div>

      <label className="min-w-48 flex-1 basis-52">
        <span className="sr-only">Movie position</span>
        <input
          className="movie-scrubber"
          type="range"
          min={0}
          max={props.maxIndex}
          value={props.currentIndex}
          onChange={(event) => props.onScrub(Number(event.currentTarget.value))}
        />
      </label>

      <span
        className="w-20 text-right font-mono text-[11px] font-bold tracking-[0.12em] text-emerald-200"
        data-movie-tick
      >
        TICK {props.tick.toString().padStart(3, "0")}
      </span>

      <div
        className="flex items-center gap-1 rounded-xl border border-white/8 bg-black/20 p-1"
        aria-label="Playback speed"
      >
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            className="speed-button"
            data-active={props.speed === speed ? "true" : "false"}
            onClick={() => props.onSpeedChange(speed)}
            aria-pressed={props.speed === speed}
          >
            {speed}x
          </button>
        ))}
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">
        <input
          type="checkbox"
          className="accent-lime-300"
          checked={props.compressIdle}
          onChange={(event) => props.onCompressIdleChange(event.currentTarget.checked)}
        />
        <Zap aria-hidden="true" className="size-3.5 text-lime-300" />
        Skip idle
      </label>
    </div>
  );
}
