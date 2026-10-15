"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Application, Texture } from "pixi.js";
import { Box, Clapperboard, Map as MapIcon, Move3d, Square } from "lucide-react";
import { MovieControls, type MovieSpeed } from "../components/MovieControls";
import type { BattleScene3D, CameraMode } from "../renderer3d/BattleScene3D";
import { preferredMovieRenderer, type MovieRendererKind } from "../renderer3d/support";
import { DEFAULT_ARENA_THEME, isArenaThemeId, type ArenaThemeId } from "../renderer3d/themes";
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
import { clampContentOffset } from "../lib/fitTransform";
import { renderMovieEffects } from "./effects/effects";
import { drawBombMarker } from "./effects/bombMarker";
import { applyRobotReactions, resetRobotReactions } from "./reactions";
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
  /** Overrides the remembered/auto-detected renderer (tests, debug routes). */
  readonly renderer?: MovieRendererKind;
  /** The room's arena look for the 3D movie, chosen by the host in the lobby. */
  readonly arenaTheme?: ArenaThemeId | undefined;
}

/** Zoom bounds shared by buttons, wheel, and pinch clamping. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/** Multiplier applied per zoom-in/out button press. */
const ZOOM_STEP = 1.25;

const clampZoom = (scale: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

interface ViewTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** Holds the arena against the viewport edges so panning cannot open dead
 *  background beside the board. Zoomed out below fit there is no covering pan,
 *  so the arena centers instead. */
const clampView = (view: ViewTransform, content: Size, viewport: Size): ViewTransform => ({
  scale: view.scale,
  x: clampContentOffset(view.x, content.width * view.scale, viewport.width),
  y: clampContentOffset(view.y, content.height * view.scale, viewport.height),
});

export function MoviePlayer({
  initialState,
  events,
  fps = 12,
  initialTick = 0,
  onTickChange,
  renderer: rendererOverride,
  arenaTheme: roomArenaTheme,
}: MoviePlayerProps) {
  const [rendererKind, setRendererKind] = useState<MovieRendererKind>(rendererOverride ?? "2d");
  const [cameraMode, setCameraMode] = useState<CameraMode>("director");
  const [arenaTheme, setArenaTheme] = useState<ArenaThemeId>(roomArenaTheme ?? DEFAULT_ARENA_THEME);
  const sceneRef = useRef<BattleScene3D | null>(null);
  const is3d = rendererKind === "3d";
  const is3dRef = useRef(is3d);
  is3dRef.current = is3d;
  // The 3D movie is the default wherever WebGL2 is available; the choice is
  // remembered per browser. Decided after mount so server HTML stays stable.
  useEffect(() => {
    if (rendererOverride === undefined) setRendererKind(preferredMovieRenderer());
  }, [rendererOverride]);
  // The room host picks the arena look in the lobby; `?theme=` lets art-review
  // links on the debug movie routes preview the others.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("theme");
    setArenaTheme(isArenaThemeId(requested) ? requested : (roomArenaTheme ?? DEFAULT_ARENA_THEME));
  }, [roomArenaTheme]);
  const chooseRenderer = useCallback((kind: MovieRendererKind) => {
    setRendererKind(kind);
    try {
      window.localStorage.setItem("roboarena.movieRenderer", kind);
    } catch {
      // Storage can be unavailable (private mode); the choice just isn't remembered.
    }
  }, []);
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
  const [viewTransform, setViewTransform] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [grabbing, setGrabbing] = useState(false);
  const viewTransformRef = useRef(viewTransform);
  viewTransformRef.current = viewTransform;

  // The arena's intrinsic size. The viewport matches it on a roomy desktop, but
  // narrow screens cap `.movie-viewport` at 100% width, so the two are measured
  // separately or the pan clamp would fence off reachable board.
  const contentSize = useMemo(
    () => ({
      width: initialState.arena.width * MOVIE_TILE_SIZE,
      height: initialState.arena.height * MOVIE_TILE_SIZE,
    }),
    [initialState.arena.width, initialState.arena.height],
  );
  const [viewportSize, setViewportSize] = useState<Size>(contentSize);
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;
  const contentSizeRef = useRef(contentSize);
  contentSizeRef.current = contentSize;

  /** Single funnel for camera changes, so no gesture can escape the clamp. */
  const commitView = useCallback(
    (next: ViewTransform | ((current: ViewTransform) => ViewTransform)) => {
      setViewTransform((current) => {
        const value = typeof next === "function" ? next(current) : next;
        const clamped = clampView(value, contentSizeRef.current, viewportSizeRef.current);
        // Identity-stable when the clamp bites, so dragging against an edge does
        // not re-render on every pointer move.
        return clamped.x === current.x && clamped.y === current.y && clamped.scale === current.scale
          ? current
          : clamped;
      });
    },
    [],
  );
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
  // The Pixi render closure outlives any single speed setting, so speed is read
  // through a ref rather than rebuilding the renderer when it changes.
  const speedRef = useRef<number>(speed);
  currentIndexRef.current = currentIndex;
  reducedMotionRef.current = reducedMotion;
  speedRef.current = speed;

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
  const zoomAbout = useCallback(
    (focal: Point, nextScale: number) => {
      commitView((transform) => {
        const scale = clampZoom(nextScale);
        if (scale === transform.scale) return transform;
        const contentX = (focal.x - transform.x) / transform.scale;
        const contentY = (focal.y - transform.y) / transform.scale;
        return { scale, x: focal.x - contentX * scale, y: focal.y - contentY * scale };
      });
    },
    [commitView],
  );

  const viewportCenter = useCallback((): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    return { x: rect.width / 2, y: rect.height / 2 };
  }, []);

  const zoomByStep = useCallback(
    (factor: number) => zoomAbout(viewportCenter(), viewTransformRef.current.scale * factor),
    [viewportCenter, zoomAbout],
  );

  const resetView = useCallback(() => commitView({ x: 0, y: 0, scale: 1 }), [commitView]);

  // Track the rendered viewport box: narrow screens cap it below the arena's
  // intrinsic size, and a resize can leave a previously legal pan out of bounds.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const measure = () => {
      const bounds = viewport.getBoundingClientRect();
      const size = { width: bounds.width, height: bounds.height };
      setViewportSize(size);
      // Clamp against the size just measured; the ref still holds the old one
      // until React re-renders.
      setViewTransform((current) => clampView(current, contentSizeRef.current, size));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [commitView]);

  // Wheel zoom needs a non-passive native listener so preventDefault can stop
  // the page from scrolling underneath the movie. React's synthetic onWheel is
  // registered passively and cannot cancel the default.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const onWheel = (event: WheelEvent) => {
      // The 3D camera owns its own wheel dolly (OrbitControls).
      if (is3dRef.current) return;
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
    if (!is3d) return;
    let disposed = false;
    let scene: BattleScene3D | undefined;
    setRendererStatus("loading");
    setPlaying(false);
    const host = hostRef.current;
    if (host === null) return;
    const initialize = async () => {
      const { BattleScene3D } = await import("../renderer3d/BattleScene3D");
      if (disposed) return;
      // `?capture` freezes the render loop so automated visual checks can step
      // scene time deterministically (software GL is too slow for real time).
      const query = new URLSearchParams(window.location.search);
      const capture = query.has("capture");
      const { isRobotFamily } = await import("../renderer3d/models");
      const requestedFamily = query.get("bots");
      scene = await BattleScene3D.create(host, initialState, timeline, {
        manualClock: capture,
        theme: arenaTheme,
        ...(isRobotFamily(requestedFamily) ? { robotFamily: requestedFamily } : {}),
      });
      if (disposed) {
        scene.dispose();
        return;
      }
      sceneRef.current = scene;
      scene.onCameraModeChange = setCameraMode;
      setCameraMode(scene.mode);
      const observer = new ResizeObserver(() => scene?.resize());
      observer.observe(host);
      const created = scene;
      renderSnapshotRef.current = (index, animate) =>
        created.render(index, {
          animate,
          speed: speedRef.current,
          reducedMotion: reducedMotionRef.current,
        });
      renderSnapshotRef.current(currentIndexRef.current, false);
      if (capture) {
        (window as unknown as { __movie3d?: unknown }).__movie3d = {
          scene: created,
          ticks: timeline.ticks,
          show: (index: number, animate: boolean) => renderSnapshotRef.current(index, animate),
        };
      }
      setRendererStatus("ready");
      return () => observer.disconnect();
    };
    let cleanupObserver: (() => void) | undefined;
    void initialize()
      .then((cleanup) => {
        cleanupObserver = cleanup;
      })
      .catch((error: unknown) => {
        if (disposed) return;
        console.error("Could not initialize the 3D movie renderer; using 2D.", error);
        setRendererKind("2d");
      });
    return () => {
      disposed = true;
      cleanupObserver?.();
      renderSnapshotRef.current = () => undefined;
      sceneRef.current = null;
      scene?.dispose();
    };
  }, [is3d, initialState, timeline, arenaTheme]);

  useEffect(() => {
    if (is3d) return;
    let disposed = false;
    let app: Application | undefined;
    setRendererStatus("loading");
    setPlaying(false);
    setCurrentIndex(initialIndex);

    const initialize = async () => {
      const { Application, Assets, Container, Graphics, Sprite } = await import("pixi.js");
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

      const bombLayer = new Container();
      const robotLayer = new Container();
      const effectsLayer = new Container();
      app.stage.addChild(bombLayer, robotLayer, effectsLayer);
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

      // Effects may outlive their own beat, so the effects layer is only wiped
      // when the viewer jumps rather than advances — a scrub's leftovers belong
      // to a tick that is no longer on screen.
      let renderedIndex: number | null = null;

      renderSnapshotRef.current = (index, animate) => {
        const snapshot = timeline.snapshots[index];
        if (snapshot === undefined) return;
        const advanced = renderedIndex !== null && index === renderedIndex + 1;
        renderedIndex = index;
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
          updateRobotSprite(visual, robot, {
            animate: animate && !reducedMotionRef.current,
            speed: speedRef.current,
          });
        }
        // Armed bombs sit under the robots until their own explosion event.
        bombLayer.removeChildren().forEach((child) => child.destroy());
        for (const bomb of snapshot.bombs) {
          bombLayer.addChild(
            drawBombMarker(
              new Graphics(),
              bomb.at.x * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2,
              bomb.at.y * MOVIE_TILE_SIZE + MOVIE_TILE_SIZE / 2,
              MOVIE_TILE_SIZE,
            ),
          );
        }
        const tickEvents = timeline.eventsByTick.get(snapshot.tick) ?? [];
        renderMovieEffects(effectsLayer, tickEvents, robotPositions, {
          reducedMotion: reducedMotionRef.current,
          speed: speedRef.current,
          reset: !advanced,
          projectileImpactTicks: timeline.projectileImpactTicks,
        });

        // A jump lands on a tick whose reactions never played, so clear any
        // mid-flinch or mid-collapse pose before the new tick's own reactions.
        if (!advanced) resetRobotReactions(visuals.values());
        applyRobotReactions(
          tickEvents,
          {
            visualOf: (robotId) => visuals.get(robotId),
            tileOf: (robotId) => {
              const position = robotPositions[robotId];
              return position === undefined || position === "dock" ? undefined : position;
            },
          },
          { reducedMotion: reducedMotionRef.current, speed: speedRef.current },
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
  }, [initialIndex, initialState, timeline, is3d]);

  // The CSS zoom transform stretches the finished canvas bitmap, so the
  // backing store must grow with zoom or the movie goes blocky. Follow the
  // zoom with the renderer resolution (one canvas pixel ≈ one screen pixel),
  // quantized to half steps so wheel/pinch zooming doesn't reallocate the
  // drawing buffer on every event.
  useEffect(() => {
    const app = appRef.current;
    if (is3d || rendererStatus !== "ready" || app === null) return;
    const density = Math.min(window.devicePixelRatio, 2) * viewTransform.scale;
    const resolution = Math.min(4, Math.max(1, Math.ceil(density * 2) / 2));
    if (app.renderer.resolution === resolution) return;
    app.renderer.resize(
      initialState.arena.width * MOVIE_TILE_SIZE,
      initialState.arena.height * MOVIE_TILE_SIZE,
      resolution,
    );
  }, [
    is3d,
    rendererStatus,
    viewTransform.scale,
    initialState.arena.width,
    initialState.arena.height,
  ]);

  const tick = timeline.ticks[currentIndex] ?? 0;
  useEffect(() => onTickChange?.(tick), [onTickChange, tick]);
  const animationCues = (timeline.eventsByTick.get(tick) ?? [])
    .map((event) => ANIMATION_CUES[event.kind])
    .filter((cue) => cue !== "none")
    .join(" ");
  const cinemaWidth = Math.max(initialState.arena.width * MOVIE_TILE_SIZE, 900);
  return (
    <section
      className={is3d ? "movie-shell movie-shell-3d" : "movie-shell"}
      data-movie-ready={rendererStatus === "ready" ? "true" : "false"}
      data-movie-renderer={rendererKind}
      data-animation-cues={animationCues}
    >
      <div
        ref={viewportRef}
        className="movie-viewport"
        style={
          is3d
            ? { width: cinemaWidth, aspectRatio: "16 / 10", touchAction: "none" }
            : {
                width: initialState.arena.width * MOVIE_TILE_SIZE,
                height: initialState.arena.height * MOVIE_TILE_SIZE,
                touchAction: "none",
                cursor: grabbing ? "grabbing" : viewTransform.scale > 1 ? "grab" : "default",
              }
        }
        onPointerDown={(event) => {
          if (is3d) return;
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
          if (is3d || !viewPointersRef.current.has(event.pointerId)) return;
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
            commitView(
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
          commitView({
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
          key={rendererKind}
          className="movie-canvas-content"
          style={
            is3d
              ? undefined
              : {
                  transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`,
                }
          }
        >
          <div ref={hostRef} className="absolute inset-0" />
        </div>
        <div className="movie-view-toolbar" role="toolbar" aria-label="Movie view">
          <div className="movie-view-group" role="group" aria-label="Renderer">
            <button
              type="button"
              className="movie-view-button"
              aria-pressed={is3d}
              onClick={() => chooseRenderer("3d")}
              title="Cinematic 3D arena"
            >
              <Box aria-hidden="true" className="size-3.5" />
              3D
            </button>
            <button
              type="button"
              className="movie-view-button"
              aria-pressed={!is3d}
              onClick={() => chooseRenderer("2d")}
              title="Top-down tactical board"
            >
              <Square aria-hidden="true" className="size-3.5" />
              2D
            </button>
          </div>
          {is3d ? (
            <div className="movie-view-group" role="group" aria-label="Camera">
              <button
                type="button"
                className="movie-view-button"
                aria-pressed={cameraMode === "director"}
                onClick={() => sceneRef.current?.setCameraMode("director")}
                title="Director camera follows the action"
              >
                <Clapperboard aria-hidden="true" className="size-3.5" />
                Director
              </button>
              <button
                type="button"
                className="movie-view-button"
                aria-pressed={cameraMode === "overview"}
                onClick={() => sceneRef.current?.setCameraMode("overview")}
                title="Whole-arena overview"
              >
                <MapIcon aria-hidden="true" className="size-3.5" />
                Overview
              </button>
              <button
                type="button"
                className="movie-view-button"
                aria-pressed={cameraMode === "free"}
                onClick={() => sceneRef.current?.setCameraMode("free")}
                title="Free camera: drag to orbit, right-drag to pan, scroll to zoom"
              >
                <Move3d aria-hidden="true" className="size-3.5" />
                Free
              </button>
            </div>
          ) : null}
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
        zoom={is3d ? 1 : viewTransform.scale}
        canZoomIn={is3d || viewTransform.scale < MAX_ZOOM}
        canZoomOut={is3d || viewTransform.scale > MIN_ZOOM}
        onTogglePlaying={() => setPlaying((value) => !value)}
        onStepBack={() => seek(currentIndex - 1)}
        onStepForward={() => seek(currentIndex + 1)}
        onRestart={() => seek(0)}
        onScrub={seek}
        onSpeedChange={setSpeed}
        onCompressIdleChange={setCompressIdle}
        onZoomIn={() => (is3d ? sceneRef.current?.dolly(1 / ZOOM_STEP) : zoomByStep(ZOOM_STEP))}
        onZoomOut={() => (is3d ? sceneRef.current?.dolly(ZOOM_STEP) : zoomByStep(1 / ZOOM_STEP))}
        onZoomReset={() => (is3d ? sceneRef.current?.setCameraMode("director") : resetView())}
      />
      <p className="sr-only" aria-live="polite">
        Movie at tick {tick}
      </p>
    </section>
  );
}
