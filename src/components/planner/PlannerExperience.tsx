"use client";

import {
  AlertTriangle,
  CloudOff,
  LockKeyhole,
  Redo2,
  Save,
  ShieldCheck,
  Undo2,
  UploadCloud,
} from "lucide-react";
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
  WeaponId,
} from "../../engine/types";
import { loadPlannerDraft, savePlannerDraft } from "../../planner/draft";
import { plannerReducer, createPlannerState } from "../../planner/state";
import {
  appendSegment,
  deleteSegment,
  planMovement,
  previewParkingTick,
  projectRobotAtTick,
  rebaseTurnOrders,
  replaceSegmentAt,
  replaceTimeline,
  timelineForRobot,
  validatedTimelinePrefix,
} from "../../planner/segments";
import { tileAt } from "../../planner/pathfind";
import {
  availableWeapons,
  defaultScanSettings,
  PLANNER_WEAPON_RANGE,
  previewAim,
  previewTargetingTiles,
  targetingOpportunityTicks,
  type AuthorizedContact,
} from "../../planner/firingHelpers";
import { AimAndFireDialog } from "./AimAndFireDialog";
import { ArenaCanvas, type PlannerRobotView, type PlannerTargetingOverlay } from "./ArenaCanvas";
import { CommandPanel } from "./CommandPanel";
import { PlannerMenu } from "./PlannerMenu";
import { ScanAndFireDialog } from "./ScanAndFireDialog";
import { TargetingAnalysis } from "./TargetingAnalysis";
import { Timeline } from "./Timeline";
import { FieldGuideButton, HelpButton } from "../help/HelpProvider";
import { FirstTimeHint } from "../help/FirstTimeHint";
import { ResignControl } from "../match/ResignControl";

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

interface EditingCommand {
  readonly robotId: string;
  readonly index: number;
}

interface AimDialogState {
  readonly target: TileCoord;
  readonly weapon: WeaponId;
  readonly repeat: boolean;
}

interface ScanDialogState {
  readonly weapon: WeaponId;
  readonly maxDistance?: number;
  readonly seconds?: number;
}

type PlannerTargetingBase = Omit<PlannerTargetingOverlay, "target">;

const browserLocalStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export interface PlannerExperienceProps {
  readonly matchId: string;
  readonly roomCode: string;
  readonly selfPlayerId: string;
  readonly match: MatchState;
  readonly serverOrders?: TurnOrders;
  readonly serverRevision?: string;
  readonly syncing?: boolean;
  readonly onSaveOrders?: (orders: TurnOrders) => void;
  readonly onLockOrders?: (orders: TurnOrders) => void;
  readonly onResign?: () => void;
}

export function PlannerExperience({
  matchId,
  roomCode,
  selfPlayerId,
  match,
  serverOrders,
  serverRevision,
  syncing = false,
  onSaveOrders,
  onLockOrders,
  onResign,
}: PlannerExperienceProps) {
  const team = match.teams.find((candidate) => candidate.id === selfPlayerId);
  if (team === undefined)
    throw new Error("The participant team is missing from this match snapshot.");
  const authorizedContacts = useMemo<readonly AuthorizedContact[]>(
    () =>
      match.teams.flatMap((candidate) =>
        candidate.side === team.side
          ? []
          : candidate.robots.flatMap((robot, index) =>
              robot.position === "dock"
                ? []
                : [
                    {
                      id: robot.id,
                      label: `${candidate.name} R${index + 1}`,
                      tile: robot.position,
                      posture: robot.posture,
                    },
                  ],
            ),
      ),
    [match.teams, team.side],
  );
  const revision =
    serverRevision ??
    `${match.turnNumber}:${match.config.arenaSizeName}:${match.teams.map((entry) => entry.id).join(",")}`;
  const authoritativeOrders = useMemo<TurnOrders>(
    () => serverOrders ?? { turnNumber: match.turnNumber, timelines: [] },
    [match.turnNumber, serverOrders],
  );
  const initialDraft = useRef<ReturnType<typeof loadPlannerDraft> | null>(null);
  if (initialDraft.current === null) {
    const storage = typeof window === "undefined" ? null : browserLocalStorage();
    initialDraft.current =
      storage === null
        ? { kind: typeof window === "undefined" ? "none" : "unavailable" }
        : loadPlannerDraft(storage, matchId, team.id, revision);
  }
  const [state, dispatch] = useReducer(plannerReducer, undefined, () => {
    const loaded = initialDraft.current!;
    if (loaded.kind !== "restored") return createPlannerState(authoritativeOrders, revision);
    const current = loaded.envelope.orders.turnNumber === match.turnNumber;
    const conflictOrders = current
      ? (loaded.envelope.conflictOrders ?? null)
      : (loaded.envelope.conflictOrders ?? loaded.envelope.orders);
    const created = createPlannerState(
      current ? loaded.envelope.orders : authoritativeOrders,
      revision,
      conflictOrders,
    );
    return current && loaded.envelope.orders.timelines.length > 0
      ? { ...created, dirty: true }
      : created;
  });
  const [selectedRobotId, setSelectedRobotId] = useState(team.robots[0]?.id ?? "");
  const [editing, setEditing] = useState<EditingCommand | null>(null);
  const [aimTool, setAimTool] = useState(false);
  const [aimDialog, setAimDialog] = useState<AimDialogState | null>(null);
  const [scanDialog, setScanDialog] = useState<ScanDialogState | null>(null);
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const [scanOverlayPinned, setScanOverlayPinned] = useState(false);
  const [scanOverlayDistance, setScanOverlayDistance] = useState(18);
  const [scanOverlayWeapon, setScanOverlayWeapon] = useState<WeaponId>("rifle");
  const [scanOverlaySeconds, setScanOverlaySeconds] = useState(1);
  const [targetingPosture, setTargetingPosture] = useState<Posture>("upright");
  const [pinnedAnalysisTile, setPinnedAnalysisTile] = useState<TileCoord | null>(null);
  const [lastAnalysisTile, setLastAnalysisTile] = useState<TileCoord | null>(null);
  const [cursor, setCursor] = useState<TileCoord | null>(null);
  const budgetTicks = match.config.turnLengthSeconds * TICKS_PER_SECOND;
  const [draftStorageStatus, setDraftStorageStatus] = useState<"saved" | "error">(
    initialDraft.current.kind === "unavailable" ? "error" : "saved",
  );
  const [notice, setNotice] = useState(
    initialDraft.current.kind === "corrupt"
      ? "Saved draft was corrupt and has been reset safely."
      : initialDraft.current.kind === "unavailable"
        ? "Local draft storage is unavailable. This draft remains in memory only."
        : initialDraft.current.kind === "restored"
          ? initialDraft.current.envelope.orders.turnNumber === match.turnNumber
            ? "Recovered your unsent local draft."
            : `Preserved your Turn ${initialDraft.current.envelope.orders.turnNumber} draft for explicit recovery.`
          : "Choose a Home Area tile to deploy your first robot.",
  );
  const orders = state.history.present;
  const selectedRobot = team.robots.find((robot) => robot.id === selectedRobotId) ?? team.robots[0];
  if (selectedRobot === undefined) throw new Error("This team has no programmable robots.");
  const selectedTimeline = timelineForRobot(orders, selectedRobot.id);
  const [previewTick, setPreviewTick] = useState(() =>
    previewParkingTick(selectedRobot, selectedTimeline.segments, budgetTicks),
  );
  const editingIndex = editing?.robotId === selectedRobot.id ? editing.index : null;
  const commandPrefix =
    editingIndex === null
      ? selectedTimeline.segments
      : selectedTimeline.segments.slice(0, editingIndex);
  const projected = projectRobotAtTick(selectedRobot, commandPrefix);
  const previewProjected = projectRobotAtTick(
    selectedRobot,
    selectedTimeline.segments,
    previewTick,
  );
  const projectedShooter = useMemo(
    () => ({
      ...selectedRobot,
      position: projected.position,
      posture: projected.posture,
      scanHeading: projected.scanHeading,
    }),
    [projected.position, projected.posture, projected.scanHeading, selectedRobot],
  );
  const selectedEndTick = previewParkingTick(selectedRobot, selectedTimeline.segments, budgetTicks);
  const selectedRoute = useMemo(
    () => routeTiles(selectedTimeline.segments),
    [selectedTimeline.segments],
  );
  const weapons = availableWeapons(selectedRobot, commandPrefix);
  const homeTiles = useMemo(
    () =>
      new Set(
        match.arena.homeAreas[team.homeSlot]?.tiles.map((tile) => `${tile.x},${tile.y}`) ?? [],
      ),
    [match.arena.homeAreas, team.homeSlot],
  );
  const homeAreaOverlays = useMemo(
    () =>
      match.teams.flatMap((candidate) => {
        const home = match.arena.homeAreas[candidate.homeSlot];
        return home === undefined
          ? []
          : [{ tiles: home.tiles, color: candidate.color, corner: home.corner }];
      }),
    [match.arena.homeAreas, match.teams],
  );
  const hoverPlan = useMemo(() => {
    if (cursor === null || projected.position === "dock") return null;
    return planMovement(match.arena, projected.position, cursor, projected.posture);
  }, [cursor, match.arena, projected.position, projected.posture]);
  const aimCursorPreview = useMemo(
    () =>
      !aimTool || cursor === null
        ? null
        : previewAim({
            arena: match.arena,
            shooter: projectedShooter,
            target: cursor,
            weapon: weapons[0]!,
            authorizedContacts,
          }),
    [aimTool, authorizedContacts, cursor, match.arena, projectedShooter, weapons],
  );
  const cursorState =
    cursor === null
      ? "out-of-bounds"
      : aimCursorPreview !== null
        ? aimCursorPreview.status === "eligible"
          ? "valid"
          : "blocked"
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
    const storage = browserLocalStorage();
    const saved =
      storage !== null &&
      savePlannerDraft(storage, matchId, team.id, {
        authoritativeRevision: state.authoritativeRevision,
        orders,
        ...(state.conflictOrders === null ? {} : { conflictOrders: state.conflictOrders }),
      });
    setDraftStorageStatus(saved ? "saved" : "error");
  }, [matchId, orders, state.authoritativeRevision, state.conflictOrders, team.id]);

  const lastRevision = useRef(revision);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    dispatch({
      type: "authoritative-refresh",
      revision,
      orders: authoritativeOrders,
    });
  }, [authoritativeOrders, revision]);

  const edit = (next: TurnOrders, message: string, parkTick?: number) => {
    dispatch({ type: "edit", orders: next });
    setEditing(null);
    setAimTool(false);
    setAimDialog(null);
    setScanDialog(null);
    setScanOverlayPinned(false);
    setPinnedAnalysisTile(null);
    setLastAnalysisTile(null);
    setNotice(message);
    setPreviewTick(
      parkTick ??
        previewParkingTick(
          selectedRobot,
          timelineForRobot(next, selectedRobot.id).segments,
          budgetTicks,
        ),
    );
  };
  const commitSegment = (segment: RobotCommandSegment, message: string) => {
    const candidate =
      editingIndex === null
        ? appendSegment(orders, selectedRobot.id, segment)
        : replaceSegmentAt(orders, selectedRobot.id, editingIndex, segment);
    const validated = validatedTimelinePrefix(
      match.arena,
      selectedRobot,
      team.homeSlot,
      timelineForRobot(candidate, selectedRobot.id).segments,
    );
    const next = replaceTimeline(orders, selectedRobot.id, validated.segments);
    edit(
      next,
      validated.droppedCount === 0
        ? message
        : `${message} ${validated.droppedCount} dependent command${validated.droppedCount === 1 ? " was" : "s were"} removed because the edit made them invalid.`,
      previewParkingTick(selectedRobot, validated.segments, budgetTicks, editingIndex ?? undefined),
    );
    setScanOverlayPinned(segment.kind === "scan-and-fire");
  };
  const removeCommand = (robotId: string, index: number) => {
    const robot = team.robots.find((candidate) => candidate.id === robotId);
    if (robot === undefined) return;
    const candidate = deleteSegment(orders, robotId, index);
    const validated = validatedTimelinePrefix(
      match.arena,
      robot,
      team.homeSlot,
      timelineForRobot(candidate, robotId).segments,
    );
    setSelectedRobotId(robotId);
    edit(
      replaceTimeline(orders, robotId, validated.segments),
      validated.droppedCount === 0
        ? "Command removed. Undo remains available."
        : `Command and ${validated.droppedCount} invalid dependent command${validated.droppedCount === 1 ? "" : "s"} removed. Undo remains available.`,
      previewParkingTick(robot, validated.segments, budgetTicks),
    );
  };
  const selectRobot = (robotId: string) => {
    const robot = team.robots.find((candidate) => candidate.id === robotId);
    setSelectedRobotId(robotId);
    setEditing(null);
    setAimTool(false);
    setAimDialog(null);
    setScanDialog(null);
    setScanOverlayPinned(false);
    setPinnedAnalysisTile(null);
    setLastAnalysisTile(null);
    if (robot !== undefined)
      setPreviewTick(
        previewParkingTick(robot, timelineForRobot(orders, robotId).segments, budgetTicks),
      );
  };
  const openRobotCommands = (robotId: string) => {
    selectRobot(robotId);
    setCommandDialogOpen(true);
  };
  const beginEdit = (robotId: string, index: number) => {
    setSelectedRobotId(robotId);
    setEditing({ robotId, index });
    const robot = team.robots.find((candidate) => candidate.id === robotId);
    if (robot !== undefined)
      setPreviewTick(
        previewParkingTick(robot, timelineForRobot(orders, robotId).segments, budgetTicks, index),
      );
    const segment = timelineForRobot(orders, robotId).segments[index];
    setScanOverlayPinned(false);
    if (segment?.kind === "aim-and-fire") {
      setAimDialog({ target: segment.target, weapon: segment.weapon, repeat: segment.repeat });
      setNotice(`Editing Aim & Fire command ${index + 1}.`);
      return;
    }
    if (segment?.kind === "scan-and-fire") {
      setScanDialog({
        weapon: segment.weapon,
        maxDistance: segment.maxDistance,
        seconds: segment.seconds,
      });
      setScanOverlayDistance(segment.maxDistance);
      setScanOverlayWeapon(segment.weapon);
      setScanOverlaySeconds(segment.seconds);
      setScanOverlayPinned(true);
      setNotice(`Editing Scan & Fire command ${index + 1}.`);
      return;
    }
    setCommandDialogOpen(true);
    setNotice(`Editing command ${index + 1}. Choose a tile, posture, or heading to replace it.`);
  };
  const changeHistory = (type: "undo" | "redo") => {
    const nextOrders =
      type === "undo" ? (state.history.past.at(-1) ?? orders) : (state.history.future[0] ?? orders);
    dispatch({ type });
    setEditing(null);
    setAimDialog(null);
    setScanDialog(null);
    setScanOverlayPinned(false);
    setPinnedAnalysisTile(null);
    setLastAnalysisTile(null);
    setAimTool(false);
    setCommandDialogOpen(false);
    setPreviewTick(
      previewParkingTick(
        selectedRobot,
        timelineForRobot(nextOrders, selectedRobot.id).segments,
        budgetTicks,
      ),
    );
  };
  const chooseTile = (
    tile: TileCoord,
    modifiers: { readonly ctrl: boolean; readonly shift: boolean },
  ) => {
    if (projected.position === "dock") {
      if (!homeTiles.has(`${tile.x},${tile.y}`)) {
        setNotice("Out of home — deployment must begin inside your assigned Home Area.");
        return;
      }
      if (!canTraverse(projected.posture, tileAt(match.arena, tile)?.terrain ?? "wall")) {
        setNotice("Blocked — choose a traversable deployment tile inside your Home Area.");
        return;
      }
      commitSegment({ kind: "deploy", to: tile }, `Deploy programmed at ${tile.x},${tile.y}.`);
      return;
    }
    if ((modifiers.ctrl && modifiers.shift) || aimTool) {
      setScanOverlayPinned(false);
      setAimDialog({
        target: tile,
        weapon: weapons[0]!,
        repeat: modifiers.ctrl && modifiers.shift,
      });
      setNotice(
        modifiers.ctrl && modifiers.shift
          ? `Repeat Aim & Fire target selected at ${tile.x},${tile.y}.`
          : `Aim & Fire target selected at ${tile.x},${tile.y}.`,
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
    commitSegment(plan.segment, `Route added: ${plan.segment.path.length} movement selectors.`);
  };
  const addPosture = (posture: Posture) => {
    if (posture === projected.posture) {
      setNotice(`Already ${posture}; no time is added.`);
      return;
    }
    commitSegment({ kind: "set-posture", posture }, `${posture} posture added · 0.17s.`);
  };
  const addHeading = (heading: Heading) => {
    if (heading === projected.scanHeading) {
      setNotice(`Scan is already facing ${heading}; no time is added.`);
      return;
    }
    commitSegment(
      { kind: "set-scan-direction", heading },
      `Scan heading ${heading} added · 0.08s.`,
    );
  };
  const robotViews = useMemo<readonly PlannerRobotView[]>(
    () =>
      team.robots.map((robot, index) => {
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
      }),
    [orders, previewTick, selectedRobot.id, team.color, team.robots],
  );
  const targetingBase = useMemo<PlannerTargetingBase | null>(() => {
    const scanActive = scanDialog !== null || scanOverlayPinned;
    const overlayProjection =
      scanOverlayPinned && scanDialog === null ? previewProjected : projected;
    if (overlayProjection.position === "dock" || (!aimTool && aimDialog === null && !scanActive))
      return null;
    const mode = scanActive ? "scan" : "aim";
    const weapon = mode === "scan" ? scanOverlayWeapon : (aimDialog?.weapon ?? weapons[0]!);
    const maxDistance = mode === "scan" ? scanOverlayDistance : PLANNER_WEAPON_RANGE[weapon];
    const overlayShooter = {
      ...selectedRobot,
      position: overlayProjection.position,
      posture: overlayProjection.posture,
      scanHeading: overlayProjection.scanHeading,
    };
    return {
      mode,
      origin: overlayProjection.position,
      heading: overlayProjection.scanHeading,
      maxDistance,
      weapon,
      seconds: mode === "scan" ? scanOverlaySeconds : null,
      opportunityTicks: targetingOpportunityTicks(weapon, mode),
      assumedPosture: targetingPosture,
      resolution:
        weapon === "missile-launcher" || weapon === "grenade-launcher"
          ? ("blast" as const)
          : ("direct-hit-roll" as const),
      tiles: previewTargetingTiles({
        arena: match.arena,
        shooter: overlayShooter,
        weapon,
        authorizedContacts,
        fireMode: mode,
        maxDistance,
        assumedPosture: targetingPosture,
      }),
    };
  }, [
    aimDialog,
    aimTool,
    authorizedContacts,
    match.arena,
    projected.position,
    projected.posture,
    projected.scanHeading,
    previewProjected,
    scanDialog,
    scanOverlayPinned,
    scanOverlayDistance,
    scanOverlaySeconds,
    scanOverlayWeapon,
    selectedRobot,
    targetingPosture,
    weapons,
  ]);
  const targetingOverlay = useMemo<PlannerTargetingOverlay | null>(
    () =>
      targetingBase === null
        ? null
        : {
            ...targetingBase,
            target: targetingBase.mode === "aim" ? (aimDialog?.target ?? cursor) : null,
          },
    [aimDialog?.target, cursor, targetingBase],
  );
  // The hovered tile stays analyzable after the pointer leaves the board so the
  // analysis panel's own controls (pin, posture, calculation) remain reachable.
  const analysisTile = pinnedAnalysisTile ?? aimDialog?.target ?? cursor ?? lastAnalysisTile;
  const analysisX = analysisTile?.x ?? -1;
  const analysisY = analysisTile?.y ?? -1;
  const targetingAnalysisPreview = useMemo(() => {
    if (targetingBase === null || analysisX < 0 || analysisY < 0) return null;
    const preview = targetingBase.tiles[analysisY * match.arena.width + analysisX];
    return preview?.tile.x === analysisX && preview.tile.y === analysisY ? preview : null;
  }, [analysisX, analysisY, match.arena.width, targetingBase]);
  // Latest-value refs so the global keydown handler can read them without
  // re-subscribing on every hover change.
  const analysisTileRef = useRef<TileCoord | null>(null);
  const targetingActiveRef = useRef(false);
  useEffect(() => {
    analysisTileRef.current = analysisTile;
    targetingActiveRef.current = targetingBase !== null;
  });

  const keepOrRecoverConflict = () => {
    const conflictOrders = state.conflictOrders;
    if (conflictOrders === null) return;
    if (conflictOrders.turnNumber === match.turnNumber) {
      dispatch({ type: "keep-local" });
      setNotice("Kept the unsent local draft for this server turn.");
      return;
    }
    const recovered = rebaseTurnOrders(
      match.arena,
      team.robots,
      team.homeSlot,
      conflictOrders,
      match.turnNumber,
    );
    dispatch({ type: "recover-conflict", revision, orders: recovered });
    setNotice(
      recovered.timelines.length > 0
        ? `Recovered the compatible command prefixes from Turn ${conflictOrders.turnNumber}. Review them before locking.`
        : `The Turn ${conflictOrders.turnNumber} draft was preserved, but none of its commands are legal from the current state.`,
    );
  };

  const acceptAuthoritative = () => {
    dispatch({
      type: "accept-authoritative",
      revision: state.conflictRevision ?? revision,
      orders: authoritativeOrders,
    });
    setNotice("Using the current authoritative server turn.");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        (aimTool || aimDialog !== null || scanDialog !== null || scanOverlayPinned)
      ) {
        event.preventDefault();
        setAimTool(false);
        setAimDialog(null);
        setScanDialog(null);
        setScanOverlayPinned(false);
        setPinnedAnalysisTile(null);
        setLastAnalysisTile(null);
        setEditing(null);
        setNotice("Firing action canceled.");
        return;
      }
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        target.closest("input, select, textarea, [contenteditable='true']") !== null;
      if (
        event.key.toLowerCase() === "p" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !typing &&
        targetingActiveRef.current
      ) {
        event.preventDefault();
        setPinnedAnalysisTile((current) => (current === null ? analysisTileRef.current : null));
        return;
      }
      if (aimDialog !== null || scanDialog !== null || typing) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && team.robots[index] !== undefined)
          selectRobot(team.robots[index].id);
        return;
      }
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        changeHistory(event.shiftKey ? "redo" : "undo");
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        changeHistory("redo");
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        const index = team.robots.findIndex((robot) => robot.id === selectedRobot.id);
        selectRobot(team.robots[(index + 1) % team.robots.length]?.id ?? selectedRobot.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aimDialog, aimTool, scanDialog, scanOverlayPinned, selectedRobot.id, team.robots]);

  return (
    <main className="planner-page desktop-viewport-gate">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="planner-header">
        <div className="planner-header-lead">
          <PlannerMenu alert={draftStorageStatus === "error"}>
            <FieldGuideButton />
            <Link className="planner-menu-item" href={`/room/${roomCode}`}>
              Room {roomCode}
            </Link>
            <span className="planner-menu-item">
              <ShieldCheck size={14} aria-hidden="true" /> Seat verified
            </span>
            <span className="planner-menu-item" role="status" aria-live="polite">
              {draftStorageStatus === "saved" ? (
                <Save size={14} aria-hidden="true" />
              ) : (
                <CloudOff size={14} aria-hidden="true" />
              )}
              {draftStorageStatus === "saved"
                ? "Saved locally"
                : "Memory only — storage unavailable"}
            </span>
            {onResign === undefined ? null : (
              <ResignControl onResign={onResign} disabled={syncing} />
            )}
          </PlannerMenu>
          <div className="planner-header-title">
            <p className="eyebrow">Turn {match.turnNumber} · Private draft</p>
            <h1>{team.name} command board</h1>
          </div>
        </div>
        <div className="planner-header-status">
          {onSaveOrders === undefined ? null : (
            <button
              type="button"
              className="planner-sync-action"
              disabled={syncing}
              onClick={() => onSaveOrders(orders)}
            >
              <UploadCloud size={14} aria-hidden="true" /> Save to server
            </button>
          )}
          {onLockOrders === undefined ? null : (
            <span className="header-action-with-help">
              <button
                type="button"
                className="planner-lock-action"
                disabled={syncing}
                onClick={() => onLockOrders(orders)}
              >
                <LockKeyhole size={14} aria-hidden="true" />
                {syncing ? "Locking…" : "Lock orders"}
              </button>
              <HelpButton topic="action:lock-orders" label="Lock orders" />
            </span>
          )}
        </div>
      </header>
      <FirstTimeHint />
      {state.conflictRevision !== null && state.conflictOrders !== null ? (
        <div className="planner-conflict" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            {state.conflictOrders.turnNumber === match.turnNumber
              ? "The server state changed while this browser has an unsent draft. Your work was preserved."
              : `The server advanced to Turn ${match.turnNumber}. Your Turn ${state.conflictOrders.turnNumber} draft remains preserved for recovery.`}
          </span>
          <button type="button" onClick={keepOrRecoverConflict}>
            {state.conflictOrders.turnNumber === match.turnNumber
              ? "Keep local draft"
              : "Recover compatible commands"}
          </button>
          <button type="button" onClick={acceptAuthoritative}>
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
        editing={editing}
        remainingTicks={budgetTicks - selectedEndTick}
        onReset={() =>
          edit(
            replaceTimeline(orders, selectedRobot.id, []),
            "Selected robot timeline reset. Undo remains available.",
          )
        }
        onSelectRobot={openRobotCommands}
        onEdit={beginEdit}
        onDelete={removeCommand}
      />
      <div className="planner-workspace">
        <section className="planner-board-card">
          <div className="planner-board-heading">
            <div>
              <p className="eyebrow">{selectedRobot.definition.class} robot</p>
              <h2>
                {previewProjected.position === "dock"
                  ? "Awaiting deployment"
                  : `At tile ${previewProjected.position.x},${previewProjected.position.y}`}
              </h2>
            </div>
            <div className="planner-board-actions">
              <span className="planner-cursor-status" data-state={cursorState}>
                {cursor === null ? "Outside grid" : `${cursor.x},${cursor.y} · `}
                {cursorState.replaceAll("-", " ")}
              </span>
              <div className="history-buttons" aria-label="Draft history">
                <button
                  type="button"
                  onClick={() => changeHistory("undo")}
                  disabled={state.history.past.length === 0}
                  aria-label="Undo"
                >
                  <Undo2 size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => changeHistory("redo")}
                  disabled={state.history.future.length === 0}
                  aria-label="Redo"
                >
                  <Redo2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <ArenaCanvas
            arena={match.arena}
            robots={robotViews}
            homeAreas={homeAreaOverlays}
            route={selectedRoute}
            cursor={cursor}
            cursorState={cursorState}
            targetingOverlay={targetingOverlay}
            onCursor={(tile) => {
              setCursor(tile);
              if (tile !== null) setLastAnalysisTile(tile);
            }}
            onChooseTile={chooseTile}
            onChooseRobot={openRobotCommands}
          />
          {targetingBase === null ? null : (
            <TargetingAnalysis
              mode={targetingBase.mode}
              weapon={targetingBase.weapon}
              maxDistance={targetingBase.maxDistance}
              seconds={targetingBase.seconds}
              opportunityTicks={targetingBase.opportunityTicks}
              assumedPosture={targetingPosture}
              preview={targetingAnalysisPreview}
              pinned={pinnedAnalysisTile !== null}
              onAssumedPosture={setTargetingPosture}
              onTogglePinned={() =>
                setPinnedAnalysisTile((current) => (current === null ? analysisTile : null))
              }
            />
          )}
          <div className="planner-notice" role="status" aria-live="polite">
            <CloudOff size={15} aria-hidden="true" />
            <span>{notice}</span>
            <small>Draft is private and has not been locked.</small>
          </div>
        </section>
      </div>
      {commandDialogOpen ? (
        <CommandPanel
          robotLabel={`R${team.robots.findIndex((robot) => robot.id === selectedRobot.id) + 1} · ${selectedRobot.definition.class} robot`}
          posture={projected.posture}
          heading={projected.scanHeading}
          editingCommandNumber={editingIndex === null ? null : editingIndex + 1}
          onPosture={addPosture}
          onHeading={addHeading}
          onClose={() => setCommandDialogOpen(false)}
          onCancelEdit={() => {
            setEditing(null);
            setAimDialog(null);
            setScanDialog(null);
            setScanOverlayPinned(false);
            setPinnedAnalysisTile(null);
          }}
          fireDisabled={projected.position === "dock"}
          aimActive={aimTool}
          onAim={() => {
            if (aimTool) {
              setAimTool(false);
              setAimDialog(null);
              setScanOverlayPinned(false);
              setPinnedAnalysisTile(null);
              setNotice("Aim & Fire canceled.");
              return;
            }
            setAimTool(true);
            setScanDialog(null);
            setScanOverlayPinned(false);
            setPinnedAnalysisTile(null);
            setNotice("Aim & Fire active — choose a target tile. Ctrl+Shift adds repeat fire.");
          }}
          onScanFire={() => {
            const weapon = weapons[0]!;
            const defaults = defaultScanSettings(weapon, budgetTicks - selectedEndTick);
            setAimTool(false);
            setAimDialog(null);
            setScanDialog({ weapon });
            setScanOverlayWeapon(weapon);
            setScanOverlayDistance(defaults.maxDistance);
            setScanOverlaySeconds(defaults.seconds);
            setScanOverlayPinned(true);
            setPinnedAnalysisTile(null);
            setNotice("Configure how long and how far this robot should scan for a target.");
          }}
        />
      ) : null}
      {aimDialog === null ? null : (
        <AimAndFireDialog
          arena={match.arena}
          shooter={projectedShooter}
          target={aimDialog.target}
          weapons={weapons}
          initialWeapon={aimDialog.weapon}
          initialRepeat={aimDialog.repeat}
          authorizedContacts={authorizedContacts}
          onWeaponChange={(weapon) =>
            setAimDialog((current) => (current === null ? null : { ...current, weapon }))
          }
          onCancel={() => {
            setAimDialog(null);
            setAimTool(false);
            setEditing(null);
          }}
          onConfirm={(weapon, repeat) =>
            commitSegment(
              { kind: "aim-and-fire", target: aimDialog.target, weapon, repeat },
              `${repeat ? "Repeat " : ""}Aim & Fire added at ${aimDialog.target.x},${aimDialog.target.y}.`,
            )
          }
        />
      )}
      {scanDialog === null ? null : (
        <ScanAndFireDialog
          weapons={weapons}
          initialWeapon={scanDialog.weapon}
          {...(scanDialog.maxDistance === undefined
            ? {}
            : { initialMaxDistance: scanDialog.maxDistance })}
          {...(scanDialog.seconds === undefined ? {} : { initialSeconds: scanDialog.seconds })}
          remainingTicks={budgetTicks - selectedEndTick}
          onDistanceChange={setScanOverlayDistance}
          onSecondsChange={setScanOverlaySeconds}
          onWeaponChange={setScanOverlayWeapon}
          onCancel={() => {
            setScanDialog(null);
            setScanOverlayPinned(editing !== null);
            setEditing(null);
          }}
          onConfirm={(weapon, maxDistance, seconds) =>
            commitSegment(
              { kind: "scan-and-fire", weapon, maxDistance, seconds },
              `Scan & Fire added · ${maxDistance} tiles for ${seconds} seconds.`,
            )
          }
        />
      )}
    </main>
  );
}
