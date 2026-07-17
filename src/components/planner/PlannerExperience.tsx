"use client";

import { AlertTriangle, CloudOff, Save, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { TICKS_PER_SECOND } from "../../engine/constants";
import { canTraverse } from "../../engine/traversal";
import type {
  Heading,
  MatchState,
  Posture,
  RobotCommandSegment,
  TileCoord,
  TurnOrders,
} from "../../engine/types";
import { plannerReducer, createPlannerState } from "../../planner/state";
import {
  appendSegment,
  deleteSegment,
  planMovement,
  projectRobotAtTick,
  replaceTimeline,
  timelineForRobot,
  timelineTiming,
} from "../../planner/segments";
import { tileAt } from "../../planner/pathfind";
import { ArenaCanvas, type PlannerRobotView } from "./ArenaCanvas";
import { CommandPanel } from "./CommandPanel";
import { Timeline } from "./Timeline";

const draftKey = (matchId: string, teamId: string) =>
  `roboarena.planner-draft.${matchId}.${teamId}`;

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isTile = (value: unknown): boolean =>
  isObject(value) && Number.isInteger(value.x) && Number.isInteger(value.y);

const isSegment = (value: unknown): boolean => {
  if (!isObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "deploy") return isTile(value.to);
  if (value.kind === "move") {
    return (
      (value.posture === "upright" ||
        value.posture === "ducking" ||
        value.posture === "crouching") &&
      Array.isArray(value.path) &&
      value.path.every(
        (step) => isObject(step) && isTile(step.to) && (step.via === undefined || isTile(step.via)),
      )
    );
  }
  if (value.kind === "set-posture")
    return (
      value.posture === "upright" || value.posture === "ducking" || value.posture === "crouching"
    );
  if (value.kind === "set-scan-direction")
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].includes(String(value.heading));
  return false;
};

const isTurnOrders = (value: unknown, turnNumber: number): value is TurnOrders =>
  isObject(value) &&
  value.turnNumber === turnNumber &&
  Array.isArray(value.timelines) &&
  value.timelines.every(
    (timeline) =>
      isObject(timeline) &&
      typeof timeline.robotId === "string" &&
      Array.isArray(timeline.segments) &&
      timeline.segments.every(isSegment),
  );

const readDraft = (
  matchId: string,
  teamId: string,
  turnNumber: number,
): { readonly orders: TurnOrders; readonly corrupt: boolean; readonly restored: boolean } => {
  const empty: TurnOrders = { turnNumber, timelines: [] };
  try {
    const raw = window.localStorage.getItem(draftKey(matchId, teamId));
    if (raw === null) return { orders: empty, corrupt: false, restored: false };
    const value: unknown = JSON.parse(raw);
    if (!isTurnOrders(value, turnNumber)) throw new Error("Stale or malformed planner draft.");
    return { orders: value, corrupt: false, restored: true };
  } catch {
    return { orders: empty, corrupt: true, restored: false };
  }
};

const routeTiles = (segments: readonly RobotCommandSegment[]): readonly TileCoord[] => {
  const route: TileCoord[] = [];
  for (const segment of segments) {
    if (segment.kind === "deploy") route.push(segment.to);
    if (segment.kind === "move")
      for (const step of segment.path)
        route.push(...(step.via === undefined ? [] : [step.via]), step.to);
  }
  return route;
};

export interface PlannerExperienceProps {
  readonly matchId: string;
  readonly roomCode: string;
  readonly selfPlayerId: string;
  readonly match: MatchState;
}

export function PlannerExperience({
  matchId,
  roomCode,
  selfPlayerId,
  match,
}: PlannerExperienceProps) {
  const team = match.teams.find((candidate) => candidate.id === selfPlayerId);
  if (team === undefined)
    throw new Error("The participant team is missing from this match snapshot.");
  const initialDraft = useRef<ReturnType<typeof readDraft> | null>(null);
  initialDraft.current ??= readDraft(matchId, team.id, match.turnNumber);
  const revision = `${match.turnNumber}:${match.config.arenaSizeName}:${match.teams.map((entry) => entry.id).join(",")}`;
  const [state, dispatch] = useReducer(plannerReducer, undefined, () => {
    const restored = initialDraft.current!;
    const created = createPlannerState(restored.orders, revision);
    return restored.restored ? { ...created, dirty: true } : created;
  });
  const [selectedRobotId, setSelectedRobotId] = useState(team.robots[0]?.id ?? "");
  const [cursor, setCursor] = useState<TileCoord | null>(null);
  const budgetTicks = match.config.turnLengthSeconds * TICKS_PER_SECOND;
  const [previewTick, setPreviewTick] = useState(budgetTicks);
  const [notice, setNotice] = useState(
    initialDraft.current.corrupt
      ? "Saved draft was corrupt and has been reset safely."
      : initialDraft.current.restored
        ? "Recovered your unsent local draft."
        : "Choose a Home Area tile to deploy your first robot.",
  );
  const orders = state.history.present;
  const selectedRobot = team.robots.find((robot) => robot.id === selectedRobotId) ?? team.robots[0];
  if (selectedRobot === undefined) throw new Error("This team has no programmable robots.");
  const selectedTimeline = timelineForRobot(orders, selectedRobot.id);
  const projected = projectRobotAtTick(selectedRobot, selectedTimeline.segments);
  const homeTiles = useMemo(
    () =>
      new Set(
        match.arena.homeAreas[team.homeSlot]?.tiles.map((tile) => `${tile.x},${tile.y}`) ?? [],
      ),
    [match.arena.homeAreas, team.homeSlot],
  );
  const hoverPlan = useMemo(() => {
    if (cursor === null || projected.position === "dock") return null;
    return planMovement(match.arena, projected.position, cursor, projected.posture);
  }, [cursor, match.arena, projected.position, projected.posture]);
  const cursorState =
    cursor === null
      ? "out-of-bounds"
      : projected.position === "dock"
        ? !homeTiles.has(`${cursor.x},${cursor.y}`)
          ? "out-of-home"
          : canTraverse(projected.posture, tileAt(match.arena, cursor)?.terrain ?? "wall")
            ? "valid"
            : "blocked"
        : hoverPlan?.kind === "error"
          ? hoverPlan.reason === "unreachable"
            ? "blocked"
            : hoverPlan.reason
          : "valid";

  useEffect(() => {
    window.localStorage.setItem(draftKey(matchId, team.id), JSON.stringify(orders));
  }, [matchId, orders, team.id]);

  const lastRevision = useRef(revision);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    dispatch({
      type: "authoritative-refresh",
      revision,
      orders: { turnNumber: match.turnNumber, timelines: [] },
    });
  }, [match.turnNumber, revision]);

  const edit = (next: TurnOrders, message: string) => {
    dispatch({ type: "edit", orders: next });
    setNotice(message);
    setPreviewTick(budgetTicks);
  };
  const chooseTile = (tile: TileCoord) => {
    if (projected.position === "dock") {
      if (!homeTiles.has(`${tile.x},${tile.y}`)) {
        setNotice("Out of home — deployment must begin inside your assigned Home Area.");
        return;
      }
      if (!canTraverse(projected.posture, tileAt(match.arena, tile)?.terrain ?? "wall")) {
        setNotice("Blocked — choose a traversable deployment tile inside your Home Area.");
        return;
      }
      edit(
        appendSegment(orders, selectedRobot.id, { kind: "deploy", to: tile }),
        `Deploy programmed at ${tile.x},${tile.y}.`,
      );
      return;
    }
    const plan = planMovement(match.arena, projected.position, tile, projected.posture);
    if (plan.kind === "error") {
      setNotice(
        plan.reason === "blocked"
          ? "Blocked — this posture cannot enter that terrain."
          : plan.reason === "out-of-bounds"
            ? "Out of bounds — choose a tile inside the arena."
            : "No traversable route reaches that tile.",
      );
      return;
    }
    if (plan.segment.path.length === 0) {
      setNotice("The robot is already on that tile.");
      return;
    }
    edit(
      appendSegment(orders, selectedRobot.id, plan.segment),
      `Route added: ${plan.segment.path.length} movement selectors.`,
    );
  };
  const addPosture = (posture: Posture) => {
    if (posture === projected.posture) {
      setNotice(`Already ${posture}; no time is added.`);
      return;
    }
    edit(
      appendSegment(orders, selectedRobot.id, { kind: "set-posture", posture }),
      `${posture} posture added · 10 ticks.`,
    );
  };
  const addHeading = (heading: Heading) => {
    if (heading === projected.scanHeading) {
      setNotice(`Scan is already facing ${heading}; no time is added.`);
      return;
    }
    edit(
      appendSegment(orders, selectedRobot.id, { kind: "set-scan-direction", heading }),
      `Scan heading ${heading} added · 5 ticks.`,
    );
  };
  const selectedEndTick =
    timelineTiming(selectedRobot, selectedTimeline.segments, budgetTicks).at(-1)?.endTick ?? 0;
  const robotViews: readonly PlannerRobotView[] = team.robots.map((robot, index) => {
    const view = projectRobotAtTick(
      robot,
      timelineForRobot(orders, robot.id).segments,
      previewTick,
    );
    return {
      id: robot.id,
      label: `R${index + 1}`,
      robotClass: robot.definition.class,
      color: team.color,
      position: view.position,
      posture: view.posture,
      scanHeading: view.scanHeading,
      selected: robot.id === selectedRobot.id,
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && team.robots[index] !== undefined)
          setSelectedRobotId(team.robots[index].id);
        return;
      }
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        const index = team.robots.findIndex((robot) => robot.id === selectedRobot.id);
        setSelectedRobotId(team.robots[(index + 1) % team.robots.length]?.id ?? selectedRobot.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRobot.id, team.robots]);

  return (
    <main className="planner-page">
      <div className="ambient-grid" />
      <header className="planner-header">
        <div>
          <p className="eyebrow">Turn {match.turnNumber} · Private draft</p>
          <h1>{team.name} command board</h1>
        </div>
        <div className="planner-header-status">
          <span>
            <ShieldCheck size={14} /> Seat verified
          </span>
          <span>
            <Save size={14} /> Saved locally
          </span>
          <Link href={`/room/${roomCode}`}>Room {roomCode}</Link>
        </div>
      </header>
      {state.conflictRevision !== null ? (
        <div className="planner-conflict" role="alert">
          <AlertTriangle size={18} />
          <span>
            The server advanced while this browser has an unsent draft. Your work was preserved.
          </span>
          <button type="button" onClick={() => dispatch({ type: "keep-local" })}>
            Keep local draft
          </button>
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "accept-authoritative",
                revision: state.conflictRevision!,
                orders: { turnNumber: match.turnNumber, timelines: [] },
              })
            }
          >
            Use server turn
          </button>
        </div>
      ) : null}
      <Timeline
        robots={team.robots}
        orders={orders}
        selectedRobotId={selectedRobot.id}
        budgetTicks={budgetTicks}
        previewTick={previewTick}
        onPreviewTick={setPreviewTick}
        onSelectRobot={setSelectedRobotId}
        onDelete={(robotId, index) =>
          edit(deleteSegment(orders, robotId, index), "Command removed. Undo remains available.")
        }
      />
      <div className="planner-workspace">
        <section className="planner-board-card">
          <div className="planner-board-heading">
            <div>
              <p className="eyebrow">{selectedRobot.definition.class} robot</p>
              <h2>
                {projected.position === "dock"
                  ? "Awaiting deployment"
                  : `Projected at ${projected.position.x},${projected.position.y}`}
              </h2>
            </div>
            <span data-state={cursorState}>{cursorState.replaceAll("-", " ")}</span>
          </div>
          <ArenaCanvas
            arena={match.arena}
            robots={robotViews}
            route={routeTiles(selectedTimeline.segments)}
            cursor={cursor}
            cursorState={cursorState}
            onCursor={(tile) => {
              setCursor(tile);
              if (tile === null) setNotice("Out of bounds — move back inside the tactical grid.");
            }}
            onChooseTile={chooseTile}
          />
          <div className="planner-notice" role="status">
            <CloudOff size={15} />
            <span>{notice}</span>
            <small>Draft is private and has not been locked.</small>
          </div>
        </section>
        <CommandPanel
          posture={projected.posture}
          heading={projected.scanHeading}
          canUndo={state.history.past.length > 0}
          canRedo={state.history.future.length > 0}
          remainingTicks={budgetTicks - selectedEndTick}
          onPosture={addPosture}
          onHeading={addHeading}
          onUndo={() => dispatch({ type: "undo" })}
          onRedo={() => dispatch({ type: "redo" })}
          onReset={() =>
            edit(
              replaceTimeline(orders, selectedRobot.id, []),
              "Selected robot timeline reset. Undo remains available.",
            )
          }
        />
      </div>
    </main>
  );
}
