"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Application, Texture } from "pixi.js";
import { MovieControls, type MovieSpeed } from "../components/MovieControls";
import type { MatchState, Terrain, TileCoord } from "../engine/types";
import type { ParticipantResolutionEvent } from "../lib/net/protocol";
import {
  EFFECT_ASSET_URLS,
  highResSvg,
  MOVIE_MARKER_ASSET_URLS,
  TERRAIN_ASSETS,
  TERRAIN_ASSET_URLS,
} from "./assets";
import { ANIMATION_CUES, buildMovieTimeline, presentationDelayMs } from "./animations";
import { renderMovieEffects } from "./effects/effects";
import {
  movedBeyondGestureThreshold,
  pointDistance,
  transformForPinch,
  type Point,
} from "../lib/input/pointerGestures";
import { loadRobotTextures, robotTextureKey } from "./robotTextures";
import {
  createRobotSprite,
  MOVIE_TILE_SIZE,
  type RobotVisual,
  updateRobotSprite,
} from "./RobotSprite";

export interface MoviePlayerProps {
  readonly initialState: MatchState;
  readonly events: readonly ParticipantResolutionEvent[];
  readonly fps?: number;
  readonly initialTick?: number;
  readonly onTickChange?: (tick: number) => void;
}

/** Zoom bounds shared by buttons, wheel, and pinch clamping. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/** Multiplier applied per zoom-in/out button press. */
const ZOOM_STEP = 1.25;

const clampZoom = (scale: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

export function MoviePlayer({
  initialState,
  events,
  fps = 12,
  initialTick = 0,
  onTickChange,
}: MoviePlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const renderSnapshotRef = useRef<(index: number, animate: boolean) => void>(() => undefined);
  const timeline = useMemo(() => buildMovieTimeline(initialState, events), [initialState, events]);
  const initialIndex = useMemo(() => {
    let index = 0;
    while (
      index + 1 < timeline.ticks.length &&
      (timeline.ticks[index + 1] ?? Infinity) <= initialTick
    )
      index += 1;
    return index;
  }, [initialTick, timeline.ticks]);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<MovieSpeed>(1);
  const [compressIdle, setCompressIdle] = useState(true);
  const [rendererStatus, setRendererStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [grabbing, setGrabbing] = useState(false);
  const viewTransformRef = useRef(viewTransform);
  viewTransformRef.current = viewTransform;
  const viewPointersRef = useRef(new Map<number, Point>());
  const panRef = useRef<{
    readonly pointerId: number;
    readonly start: Point;
    readonly transform: typeof viewTransform;
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{
    readonly distance: number;
    readonly midpoint: Point;
    readonly transform: typeof viewTransform;
  } | null>(null);
  const currentIndexRef = useRef(currentIndex);
  const reducedMotionRef = useRef(reducedMotion);
  currentIndexRef.current = currentIndex;
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  const seek = useCallback(
    (index: number) => {
      setPlaying(false);
      setCurrentIndex(Math.max(0, Math.min(timeline.ticks.length - 1, index)));
    },
    [timeline.ticks.length],
  );

  // Zoom about a viewport-local focal point, keeping that point stationary
  // on screen. The CSS transform is `translate(x,y) scale(s)` with a 0,0
  // origin, so the content point under the focus is (focus - translate) / s;
  // holding it fixed at the new scale yields the corrected translation.
  const zoomAbout = useCallback((focal: Point, nextScale: number) => {
    setViewTransform((transform) => {
      const scale = clampZoom(nextScale);
      if (scale === transform.scale) return transform;
      const contentX = (focal.x - transform.x) / transform.scale;
      const contentY = (focal.y - transform.y) / transform.scale;
      return { scale, x: focal.x - contentX * scale, y: focal.y - contentY * scale };
    });
  }, []);

  const viewportCenter = useCallback((): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    return { x: rect.width / 2, y: rect.height / 2 };
  }, []);

  const zoomByStep = useCallback(
    (factor: number) => zoomAbout(viewportCenter(), viewTransformRef.current.scale * factor),
    [viewportCenter, zoomAbout],
  );

  const resetView = useCallback(() => setViewTransform({ x: 0, y: 0, scale: 1 }), []);

  // Wheel zoom needs a non-passive native listener so preventDefault can stop
  // the page from scrolling underneath the movie. React's synthetic onWheel is
  // registered passively and cannot cancel the default.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const focal = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      zoomAbout(focal, viewTransformRef.current.scale * Math.pow(1.0015, -event.deltaY));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAbout]);

  useEffect(() => {
    if (!playing || rendererStatus !== "ready") return;
    if (currentIndex >= timeline.ticks.length - 1) {
      setPlaying(false);
      return;
    }
    const fromTick = timeline.ticks[currentIndex] ?? 0;
    const toTick = timeline.ticks[currentIndex + 1] ?? fromTick;
    const timeout = window.setTimeout(() => {
      setCurrentIndex((index) => Math.min(index + 1, timeline.ticks.length - 1));
    }, presentationDelayMs({ fromTick, toTick, fps, speed, compressIdle }));
    return () => window.clearTimeout(timeout);
  }, [compressIdle, currentIndex, fps, playing, rendererStatus, speed, timeline.ticks]);

  useEffect(
    () => renderSnapshotRef.current(currentIndex, !reducedMotion),
    [currentIndex, reducedMotion],
  );

  useEffect(() => {
    let disposed = false;
    let app: Application | undefined;
    setRendererStatus("loading");
    setPlaying(false);
    setCurrentIndex(initialIndex);

    const initialize = async () => {
      const { Application, Assets, Container, Sprite } = await import("pixi.js");
      if (disposed) return;
      app = new Application();
      await app.init({
        width: initialState.arena.width * MOVIE_TILE_SIZE,
        height: initialState.arena.height * MOVIE_TILE_SIZE,
        antialias: true,
        autoDensity: true,
        background: "#151816",
        preference: "webgl",
        preserveDrawingBuffer: true,
        resolution: Math.min(window.devicePixelRatio, 2),
      });
      if (disposed) return;
      appRef.current = app;
      const canvas = app.canvas as HTMLCanvasElement;
      canvas.dataset.movieCanvas = "true";
      canvas.setAttribute("aria-label", "RoboArena turn movie");
      canvas.setAttribute("role", "img");
      hostRef.current?.appendChild(canvas);

      const textures = new Map(
        await Promise.all(
          TERRAIN_ASSET_URLS.map(
            async (url) => [url, await Assets.load<Texture>(highResSvg(url))] as const,
          ),
        ),
      );
      // Effect/marker textures are read synchronously via Assets.get during
      // per-tick effect rendering, so they must be cached before playback.
      await Promise.all(
        [...EFFECT_ASSET_URLS, ...MOVIE_MARKER_ASSET_URLS].map((url) =>
          Assets.load<Texture>(highResSvg(url)),
        ),
      );
      for (let y = 0; y < initialState.arena.height; y += 1) {
        for (let x = 0; x < initialState.arena.width; x += 1) {
          const terrain = initialState.arena.tiles[y]?.[x]?.terrain;
          if (terrain === undefined) continue;
          const texture = textures.get(TERRAIN_ASSETS[terrain as Terrain]);
          if (texture === undefined) continue;
          const sprite = new Sprite(texture);
          sprite.position.set(x * MOVIE_TILE_SIZE, y * MOVIE_TILE_SIZE);
          sprite.width = MOVIE_TILE_SIZE;
          sprite.height = MOVIE_TILE_SIZE;
          app.stage.addChild(sprite);
        }
      }

      const robotLayer = new Container();
      const effectsLayer = new Container();
      app.stage.addChild(robotLayer, effectsLayer);
      const visuals = new Map<string, RobotVisual>();
      const firstSnapshot = timeline.snapshots[0];
      if (firstSnapshot === undefined) throw new Error("Movie has no initial snapshot.");
      const movieRobots = new Map<string, (typeof firstSnapshot.robots)[string]>();
      for (const snapshot of timeline.snapshots) {
        for (const robot of Object.values(snapshot.robots)) movieRobots.set(robot.id, robot);
      }
      const robotTextures = await loadRobotTextures([...movieRobots.values()]);
      if (disposed) return;
      for (const robot of Object.values(firstSnapshot.robots)) {
        const textureSet = robotTextures.get(robotTextureKey(robot.robotClass, robot.teamColor));
        if (textureSet === undefined) throw new Error(`Missing robot textures for ${robot.id}.`);
        const visual = createRobotSprite(robot, textureSet);
        visuals.set(robot.id, visual);
        robotLayer.addChild(visual.container);
      }

      renderSnapshotRef.current = (index, animate) => {
        const snapshot = timeline.snapshots[index];
        if (snapshot === undefined) return;
        const robotPositions: Record<string, TileCoord | "dock"> = {};
        for (const visual of visuals.values()) visual.container.visible = false;
        for (const robot of Object.values(snapshot.robots)) {
          robotPositions[robot.id] = robot.position;
          let visual = visuals.get(robot.id);
          if (visual === undefined) {
            const textureSet = robotTextures.get(
              robotTextureKey(robot.robotClass, robot.teamColor),
            );
            if (textureSet === undefined) continue;
            visual = createRobotSprite(robot, textureSet);
            visuals.set(robot.id, visual);
            robotLayer.addChild(visual.container);
          }
          visual.container.visible = true;
          updateRobotSprite(visual, robot, animate && !reducedMotionRef.current);
        }
        renderMovieEffects(
          effectsLayer,
          timeline.eventsByTick.get(snapshot.tick) ?? [],
          robotPositions,
          reducedMotionRef.current,
        );
      };
      renderSnapshotRef.current(currentIndexRef.current, false);
      setRendererStatus("ready");
    };

    void initialize().catch((error: unknown) => {
      if (!disposed) {
        setRendererStatus("error");
        console.error("Could not initialize the movie renderer.", error);
      }
    });
    return () => {
      disposed = true;
      renderSnapshotRef.current = () => undefined;
      appRef.current = null;
      app?.destroy(true);
    };
  }, [initialIndex, initialState, timeline]);

  // The CSS zoom transform stretches the finished canvas bitmap, so the
  // backing store must grow with zoom or the movie goes blocky. Follow the
  // zoom with the renderer resolution (one canvas pixel ≈ one screen pixel),
  // quantized to half steps so wheel/pinch zooming doesn't reallocate the
  // drawing buffer on every event.
  useEffect(() => {
    const app = appRef.current;
    if (rendererStatus !== "ready" || app === null) return;
    const density = Math.min(window.devicePixelRatio, 2) * viewTransform.scale;
    const resolution = Math.min(4, Math.max(1, Math.ceil(density * 2) / 2));
    if (app.renderer.resolution === resolution) return;
    app.renderer.resize(
      initialState.arena.width * MOVIE_TILE_SIZE,
      initialState.arena.height * MOVIE_TILE_SIZE,
      resolution,
    );
  }, [rendererStatus, viewTransform.scale, initialState.arena.width, initialState.arena.height]);

  const tick = timeline.ticks[currentIndex] ?? 0;
  useEffect(() => onTickChange?.(tick), [onTickChange, tick]);
  const animationCues = (timeline.eventsByTick.get(tick) ?? [])
    .map((event) => ANIMATION_CUES[event.kind])
    .filter((cue) => cue !== "none")
    .join(" ");
  return (
    <section
      className="movie-shell"
      data-movie-ready={rendererStatus === "ready" ? "true" : "false"}
      data-animation-cues={animationCues}
    >
      <div
        ref={viewportRef}
        className="movie-viewport"
        style={{
          width: initialState.arena.width * MOVIE_TILE_SIZE,
          height: initialState.arena.height * MOVIE_TILE_SIZE,
          touchAction: "none",
          cursor: grabbing ? "grabbing" : viewTransform.scale > 1 ? "grab" : "default",
        }}
        onPointerDown={(event) => {
          // Mouse: only the primary button drags. Touch/pen: always pan/pinch.
          if (event.pointerType === "mouse" && event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = { x: event.clientX, y: event.clientY };
          viewPointersRef.current.set(event.pointerId, point);
          const points = [...viewPointersRef.current.values()];
          if (points.length === 1) {
            panRef.current = {
              pointerId: event.pointerId,
              start: point,
              transform: viewTransformRef.current,
              moved: false,
            };
            if (event.pointerType !== "touch") setGrabbing(true);
          } else if (points.length === 2) {
            const [first, second] = points;
            if (first === undefined || second === undefined) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            pinchRef.current = {
              distance: pointDistance(first, second),
              midpoint: {
                x: (first.x + second.x) / 2 - bounds.left,
                y: (first.y + second.y) / 2 - bounds.top,
              },
              transform: viewTransformRef.current,
            };
            if (panRef.current !== null) panRef.current.moved = true;
          }
        }}
        onPointerMove={(event) => {
          if (!viewPointersRef.current.has(event.pointerId)) return;
          const point = { x: event.clientX, y: event.clientY };
          viewPointersRef.current.set(event.pointerId, point);
          const points = [...viewPointersRef.current.values()];
          if (points.length >= 2) {
            const [first, second] = points;
            const pinch = pinchRef.current;
            if (first === undefined || second === undefined || pinch === null) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const midpoint = {
              x: (first.x + second.x) / 2 - bounds.left,
              y: (first.y + second.y) / 2 - bounds.top,
            };
            setViewTransform(
              transformForPinch({
                initialTransform: pinch.transform,
                initialMidpoint: pinch.midpoint,
                currentMidpoint: midpoint,
                initialDistance: pinch.distance,
                currentDistance: pointDistance(first, second),
                clampScale: clampZoom,
              }),
            );
            return;
          }
          const pan = panRef.current;
          if (
            pan === null ||
            pan.pointerId !== event.pointerId ||
            !movedBeyondGestureThreshold(pan.start, point)
          )
            return;
          pan.moved = true;
          setViewTransform({
            ...pan.transform,
            x: pan.transform.x + point.x - pan.start.x,
            y: pan.transform.y + point.y - pan.start.y,
          });
        }}
        onPointerUp={(event) => {
          viewPointersRef.current.delete(event.pointerId);
          if (viewPointersRef.current.size < 2) pinchRef.current = null;
          if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
          if (viewPointersRef.current.size === 0) setGrabbing(false);
        }}
        onPointerCancel={(event) => {
          viewPointersRef.current.delete(event.pointerId);
          panRef.current = null;
          pinchRef.current = null;
          setGrabbing(false);
        }}
      >
        <div
          className="movie-canvas-content"
          style={{
            transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`,
          }}
        >
          <div ref={hostRef} className="absolute inset-0" />
        </div>
        {rendererStatus !== "ready" ? (
          <div className="absolute inset-0 grid place-items-center bg-[#151816]/95">
            <p className="eyebrow">
              {rendererStatus === "error" ? "Renderer unavailable" : "Spooling turn movie…"}
            </p>
          </div>
        ) : null}
      </div>
      <MovieControls
        disabled={rendererStatus !== "ready"}
        playing={playing}
        currentIndex={currentIndex}
        maxIndex={timeline.ticks.length - 1}
        tick={tick}
        speed={speed}
        compressIdle={compressIdle}
        zoom={viewTransform.scale}
        canZoomIn={viewTransform.scale < MAX_ZOOM}
        canZoomOut={viewTransform.scale > MIN_ZOOM}
        onTogglePlaying={() => setPlaying((value) => !value)}
        onStepBack={() => seek(currentIndex - 1)}
        onStepForward={() => seek(currentIndex + 1)}
        onRestart={() => seek(0)}
        onScrub={seek}
        onSpeedChange={setSpeed}
        onCompressIdleChange={setCompressIdle}
        onZoomIn={() => zoomByStep(ZOOM_STEP)}
        onZoomOut={() => zoomByStep(1 / ZOOM_STEP)}
        onZoomReset={resetView}
      />
      <p className="sr-only" aria-live="polite">
        Movie at tick {tick}
      </p>
    </section>
  );
}
