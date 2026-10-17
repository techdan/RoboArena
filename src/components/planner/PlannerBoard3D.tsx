"use client";

/**
 * 3D planning board: the same arena, robots and lighting as the turn movie,
 * seen top-down by default, with orders drawn on the floor. It takes the same
 * props as the 2D `ArenaCanvas`, so the planner can swap between them.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { MatchState, TileCoord } from "../../engine/types";
import { buildMovieTimeline } from "../../renderer/animations";
import type { BattleScene3D, PlannedRobotPose } from "../../renderer3d/BattleScene3D";
import { headingYaw } from "../../renderer3d/kinematics";
import {
  PLANNER_2D_CHOICE_ENABLED,
  preferredPlannerView,
  rememberPlannerView,
  type PlannerView,
} from "../../renderer3d/support";
import type { ArenaThemeId } from "../../renderer3d/themes";
import { targetingTileVisual } from "../../planner/targetingVisuals";
import type { ArenaCanvasProps } from "./ArenaCanvas";
import { TargetingLegend } from "./TargetingLegend";

const TEAM_HEX: Readonly<Record<string, string>> = {
  red: "#ff5a4f",
  blue: "#5b9dff",
  green: "#4fd88a",
  yellow: "#ffd23f",
};
const CURSOR_HEX: Readonly<Record<ArenaCanvasProps["cursorState"], string>> = {
  valid: "#e8ffd0",
  blocked: "#ff5a4f",
  "out-of-home": "#ffb547",
  "out-of-bounds": "#ff5a4f",
};
const CLICK_SLOP_PX = 6;

const VIEWS: readonly { readonly id: PlannerView; readonly label: string }[] = [
  { id: "top", label: "Top" },
  { id: "tilt", label: "Tilted" },
  { id: "orbit", label: "Orbit" },
];

export interface PlannerBoard3DProps extends ArenaCanvasProps {
  readonly match: MatchState;
  readonly theme: ArenaThemeId;
  /** Falls back to the 2D board (renderer failure or the player's choice). */
  readonly onUse2D: () => void;
  /** CSS pixels of the board covered by overlaid UI; the camera frames around them. */
  readonly insets?: { top: number; right: number; bottom: number; left: number };
  /** Content pinned above a tile that follows the camera (the orders ring). */
  readonly anchorTile?: TileCoord | null;
  readonly anchorContent?: ReactNode;
  /** Extra chrome laid over the board. */
  readonly children?: ReactNode;
}

export function PlannerBoard3D(props: PlannerBoard3DProps) {
  const {
    match,
    theme,
    arena,
    robots,
    contacts,
    ghosts,
    bombs,
    homeAreas,
    route,
    cursor,
    cursorState,
    targetingOverlay,
    firingInteractionActive,
    onAssumedPosture,
    onCursor,
    onChooseTile,
    onChooseRobot,
    onUse2D,
    insets,
    anchorTile = null,
    anchorContent = null,
    children = null,
  } = props;
  const anchorRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BattleScene3D | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [view, setView] = useState<PlannerView>("top");
  const [quarter, setQuarter] = useState(0);
  const pressRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const hoverRef = useRef<string | null>(null);

  // The scene is built once per arena and theme; everything else is synced.
  const sceneKey = `${arena.sizeName}:${arena.width}x${arena.height}:${theme}`;
  const matchRef = useRef(match);
  matchRef.current = match;
  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    if (host === null) return;
    setStatus("loading");
    const initialView = preferredPlannerView();
    setView(initialView);
    let observer: ResizeObserver | undefined;
    void (async () => {
      try {
        const { BattleScene3D } = await import("../../renderer3d/BattleScene3D");
        if (disposed) return;
        const state = matchRef.current;
        const scene = await BattleScene3D.create(host, state, buildMovieTimeline(state, []), {
          theme,
        });
        if (disposed) {
          scene.dispose();
          return;
        }
        scene.setPlanningLook(true);
        scene.resize();
        scene.planView(initialView, 0, false);
        sceneRef.current = scene;
        // Automated visual checks find tiles on screen through this handle.
        if (new URLSearchParams(window.location.search).has("capture"))
          (window as unknown as { __plannerBoard?: BattleScene3D }).__plannerBoard = scene;
        observer = new ResizeObserver(() => scene.resize());
        observer.observe(host);
        setStatus("ready");
      } catch {
        if (!disposed) setStatus("error");
      }
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [sceneKey, theme]);

  // Robots: own squad plus enemies currently in sight.
  const poses = useMemo<PlannedRobotPose[]>(
    () => [
      ...robots.map((robot) => ({
        id: robot.id,
        robotClass: robot.robotClass,
        color: robot.color,
        position: robot.position,
        posture: robot.posture,
        scanHeading: robot.scanHeading,
      })),
      ...contacts.map((contact) => ({
        id: contact.id,
        robotClass: contact.robotClass,
        color: contact.color,
        position: contact.position,
        posture: contact.posture,
        scanHeading: contact.scanHeading,
      })),
    ],
    [robots, contacts],
  );
  useEffect(() => {
    if (status !== "ready") return;
    sceneRef.current?.syncRobots(poses, true);
  }, [poses, status]);

  // Floor overlays.
  const selected = robots.find((robot) => robot.selected);
  useEffect(() => {
    const scene = sceneRef.current;
    if (status !== "ready" || scene === null) return;
    const overlays = scene.overlays;
    overlays.clear();
    const targeting = targetingOverlay;
    if (targeting === null) {
      for (const area of homeAreas)
        overlays.homeArea(area.tiles, TEAM_HEX[area.color] ?? area.color);
    } else {
      overlays.heatmap(
        targeting.tiles.map((tile) => {
          const visual = targetingTileVisual(tile);
          return {
            tile: tile.tile,
            color: visual.color,
            alpha: visual.alpha,
            pattern: visual.pattern,
          };
        }),
      );
      const color = targeting.mode === "aim" ? "#fde68a" : "#67e8f9";
      overlays.wedge(
        targeting.origin,
        headingYaw(targeting.heading),
        Math.PI / 2,
        targeting.maxDistance,
        color,
      );
      if (targeting.target !== null)
        overlays.aim(
          targeting.origin,
          targeting.target,
          "#fde047",
          targeting.resolution === "blast",
        );
    }
    const teamHex = selected === undefined ? "#ffffff" : (TEAM_HEX[selected.color] ?? "#ffffff");
    if (route.length > 1)
      overlays.route({
        tiles: route,
        color: teamHex,
        secondMarks: [],
        emphasis: "selected",
      });
    if (selected !== undefined && selected.position !== "dock")
      overlays.selection(selected.position, teamHex);
    for (const contact of contacts) overlays.contact(contact.position);
    for (const ghost of ghosts) overlays.lastKnown(ghost.at);
    for (const bomb of bombs ?? []) overlays.armedBomb(bomb.at);
  }, [status, targetingOverlay, homeAreas, route, selected, contacts, ghosts, bombs]);

  useEffect(() => {
    if (status !== "ready") return;
    sceneRef.current?.overlays.setCursor(cursor, CURSOR_HEX[cursorState]);
  }, [cursor, cursorState, status]);

  const viewRef = useRef({ view, quarter });
  viewRef.current = { view, quarter };
  const insetKey =
    insets === undefined ? "" : `${insets.top},${insets.right},${insets.bottom},${insets.left}`;
  useEffect(() => {
    const scene = sceneRef.current;
    if (status !== "ready" || scene === null || insets === undefined) return;
    scene.setViewInsets(insets);
    scene.planView(viewRef.current.view, viewRef.current.quarter, false);
    // insetKey captures the inset values; the object identity may change every render.
  }, [insetKey, status]);

  // Keep anchored content glued to its tile as the camera pans and zooms.
  useEffect(() => {
    if (status !== "ready" || anchorTile === null) return;
    let frame = 0;
    const follow = () => {
      const scene = sceneRef.current;
      const element = anchorRef.current;
      if (scene !== null && element !== null) {
        const point = scene.screenOf(anchorTile, 0.6);
        element.style.transform = `translate(${point.x}px, ${point.y}px)`;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [anchorTile, status]);

  const changeView = (next: PlannerView, nextQuarter = quarter) => {
    setView(next);
    setQuarter(nextQuarter);
    rememberPlannerView(next);
    sceneRef.current?.planView(next, nextQuarter, true);
  };

  const tileAt = (event: PointerEvent<HTMLDivElement>): TileCoord | null =>
    sceneRef.current?.tileAtClient(event.clientX, event.clientY) ?? null;

  const choose = (tile: TileCoord, modifiers: { ctrl: boolean; shift: boolean }) => {
    const robot = robots.find(
      (candidate) =>
        candidate.position !== "dock" &&
        candidate.position.x === tile.x &&
        candidate.position.y === tile.y,
    );
    if (robot !== undefined && !firingInteractionActive) onChooseRobot(robot.id);
    else onChooseTile(tile, modifiers);
  };

  return (
    <div className="planner-canvas-shell">
      <div
        className="planner-canvas planner-board-3d"
        role="application"
        aria-label={`${arena.sizeName} planning board, 3D view. Click or tap a tile to choose it.`}
        data-cursor-state={cursorState}
        data-targeting-active={firingInteractionActive ? "true" : "false"}
        onPointerDown={(event) => {
          pressRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse") return;
          const tile = tileAt(event);
          const key = tile === null ? null : `${tile.x},${tile.y}`;
          if (key === hoverRef.current) return;
          hoverRef.current = key;
          onCursor(tile);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          hoverRef.current = null;
          onCursor(null);
        }}
        onPointerUp={(event) => {
          const press = pressRef.current;
          pressRef.current = null;
          if (press === null || press.id !== event.pointerId || event.button !== 0) return;
          if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) return;
          const tile = tileAt(event);
          if (tile === null) return;
          if (event.pointerType !== "mouse") onCursor(tile);
          choose(tile, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey });
        }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        {anchorTile === null || anchorContent === null || status !== "ready" ? null : (
          <div ref={anchorRef} className="planner-board-anchor">
            {anchorContent}
          </div>
        )}
        {children}
        {cursor === null ? null : (
          <div className="planner-coord-chip" data-state={cursorState} aria-hidden="true">
            <strong>
              {cursor.x},{cursor.y}
            </strong>
            <span>
              {cursorState === "valid"
                ? "OK"
                : cursorState === "blocked"
                  ? "Blocked"
                  : cursorState === "out-of-home"
                    ? "Out of home"
                    : "Off board"}
            </span>
          </div>
        )}
        {targetingOverlay === null || targetingOverlay.previewOnly ? null : (
          <TargetingLegend
            overlay={targetingOverlay}
            onAssumedPosture={onAssumedPosture}
            onBlockBoardHover={() => onCursor(null)}
          />
        )}
        {status !== "ready" ? (
          <div className="planner-canvas-loading" role="status">
            {status === "error" ? (
              <>
                3D board unavailable.{" "}
                <button type="button" className="cursor-pointer underline" onClick={onUse2D}>
                  Use the 2D board
                </button>
              </>
            ) : (
              "Loading arena…"
            )}
          </div>
        ) : null}
      </div>
      <div className="planner-camera-controls planner-view-controls" aria-label="Board camera">
        <div className="planner-view-segment" role="group" aria-label="Camera angle">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="cursor-pointer"
              aria-pressed={view === option.id}
              disabled={status !== "ready"}
              onClick={() => changeView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="planner-view-segment" role="group" aria-label="Rotate and zoom">
          <button
            type="button"
            className="cursor-pointer"
            aria-label="Rotate board left"
            disabled={status !== "ready"}
            onClick={() => changeView(view, (quarter + 3) % 4)}
          >
            ⟲
          </button>
          <button
            type="button"
            className="cursor-pointer"
            aria-label="Rotate board right"
            disabled={status !== "ready"}
            onClick={() => changeView(view, (quarter + 1) % 4)}
          >
            ⟳
          </button>
          <button
            type="button"
            className="cursor-pointer"
            aria-label="Zoom out"
            disabled={status !== "ready"}
            onClick={() => sceneRef.current?.dolly(1.2)}
          >
            −
          </button>
          <button
            type="button"
            className="cursor-pointer"
            aria-label="Zoom in"
            disabled={status !== "ready"}
            onClick={() => sceneRef.current?.dolly(1 / 1.2)}
          >
            +
          </button>
          <button
            type="button"
            className="cursor-pointer"
            aria-label="Fit the whole arena"
            disabled={status !== "ready"}
            onClick={() => changeView(view)}
          >
            Fit
          </button>
          {PLANNER_2D_CHOICE_ENABLED ? (
            <button type="button" className="cursor-pointer" onClick={onUse2D}>
              2D
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
