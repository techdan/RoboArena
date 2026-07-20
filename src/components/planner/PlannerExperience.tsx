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
import { TICKS_PER_SECOND, WEAPON_TIMING } from "../../engine/constants";
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
  deleteSegment,
  planMovement,
  previewParkingTick,
  projectRobotAtTick,
  rebaseTurnOrders,
  replaceTimeline,
  timelineForRobot,
  validatedTimelinePrefix,
} from "../../planner/segments";
import { tileAt } from "../../planner/pathfind";
import {
  availableWeapons,
  defaultScanSettings,
  PLANNER_WEAPON_RANGE,
  previewTargetingTiles,
  projectedWeaponAmmo,
  targetingOpportunityTicks,
  type AuthorizedContact,
} from "../../planner/firingHelpers";
import { robotDisplayNames } from "../../planner/presentation";
import { AimAndFireDialog } from "./AimAndFireDialog";
import { AllProgramsOverlay } from "./AllProgramsOverlay";
import { ArenaCanvas, type PlannerRobotView, type PlannerTargetingOverlay } from "./ArenaCanvas";
import { AimFireControls, ScanFireControls } from "./FireControlStrip";
import { PlannerActionStrip } from "./PlannerActionStrip";
import { PlannerMenu } from "./PlannerMenu";
import { RobotSelector } from "./RobotSelector";
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

interface AimDialogState {
  readonly target: TileCoord;
  readonly weapon: WeaponId;
}

interface ScanDialogState {
  readonly weapon: WeaponId;
  readonly maxDistance: number;
  readonly seconds: number;
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
  const [aimTool, setAimTool] = useState(false);
  const [aimDialog, setAimDialog] = useState<AimDialogState | null>(null);
  const [aimShots, setAimShots] = useState(1);
  const [aimReviewOpen, setAimReviewOpen] = useState(false);
  const [scanDialog, setScanDialog] = useState<ScanDialogState | null>(null);
  const [targetingPosture, setTargetingPosture] = useState<Posture>("upright");
  const [headingPreview, setHeadingPreview] = useState<Heading | null>(null);
  const [weaponChoiceByRobot, setWeaponChoiceByRobot] = useState<
    Readonly<Record<string, WeaponId>>
  >({});
  const [cursor, setCursor] = useState<TileCoord | null>(null);
  const [showAllPrograms, setShowAllPrograms] = useState(false);
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
  const robotNames = useMemo(() => robotDisplayNames(team.robots), [team.robots]);
  const selectedTimeline = timelineForRobot(orders, selectedRobot.id);
  const [previewTick, setPreviewTick] = useState(() =>
    previewParkingTick(selectedRobot, selectedTimeline.segments, budgetTicks),
  );
  const commandPrefix = selectedTimeline.segments;
  const projected = projectRobotAtTick(selectedRobot, commandPrefix);
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
  const selectedWeapon = weapons.includes(
    weaponChoiceByRobot[selectedRobot.id] ?? selectedRobot.definition.primaryWeapon,
  )
    ? (weaponChoiceByRobot[selectedRobot.id] ?? selectedRobot.definition.primaryWeapon)
    : (weapons[0] ?? selectedRobot.definition.primaryWeapon);
  const missileAmmoValue = projectedWeaponAmmo(selectedRobot, commandPrefix, "missile-launcher");
  const missileAmmo =
    selectedRobot.definition.class === "missile" && missileAmmoValue !== "unlimited"
      ? missileAmmoValue
      : null;
  const aimWeapon = aimDialog?.weapon ?? selectedWeapon;
  const aimAmmo = projectedWeaponAmmo(selectedRobot, commandPrefix, aimWeapon);
  const aimMaxShots = Math.max(
    1,
    Math.min(
      Math.floor((budgetTicks - projected.tick) / WEAPON_TIMING[aimWeapon].firingIntervalTicks),
      aimAmmo === "unlimited" ? Number.POSITIVE_INFINITY : aimAmmo,
    ),
  );
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
    setAimTool(false);
    setAimDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setScanDialog(null);
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
  const commitSegments = (segments: readonly RobotCommandSegment[], message: string) => {
    const current = timelineForRobot(orders, selectedRobot.id).segments;
    const candidateSegments = [...current, ...segments];
    const candidate = replaceTimeline(orders, selectedRobot.id, candidateSegments);
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
      previewParkingTick(selectedRobot, validated.segments, budgetTicks),
    );
  };
  const commitSegment = (segment: RobotCommandSegment, message: string) =>
    commitSegments([segment], message);
  const removeCommand = (robotId: string, index: number) => {
    const robot = team.robots.find((candidate) => candidate.id === robotId);
    if (robot === undefined) return;
    const currentSegments = timelineForRobot(orders, robotId).segments;
    if (index !== currentSegments.length - 1) {
      setNotice("Remove later actions first; only the final action can be removed.");
      return;
    }
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
      "Last action removed. Undo remains available.",
      previewParkingTick(robot, validated.segments, budgetTicks),
    );
  };
  const selectRobot = (robotId: string) => {
    const robot = team.robots.find((candidate) => candidate.id === robotId);
    setSelectedRobotId(robotId);
    setAimTool(false);
    setAimDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setScanDialog(null);
    setHeadingPreview(null);
    if (robot !== undefined)
      setPreviewTick(
        previewParkingTick(robot, timelineForRobot(orders, robotId).segments, budgetTicks),
      );
  };
  const selectCommand = (robotId: string, _index: number, endTick: number) => {
    if (robotId !== selectedRobot.id) selectRobot(robotId);
    setPreviewTick(endTick);
  };
  const changeHistory = (type: "undo" | "redo") => {
    const nextOrders =
      type === "undo" ? (state.history.past.at(-1) ?? orders) : (state.history.future[0] ?? orders);
    dispatch({ type });
    setAimDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setScanDialog(null);
    setAimTool(false);
    setPreviewTick(
      previewParkingTick(
        selectedRobot,
        timelineForRobot(nextOrders, selectedRobot.id).segments,
        budgetTicks,
      ),
    );
  };
  const selectRobotRef = useRef(selectRobot);
  selectRobotRef.current = selectRobot;
  const changeHistoryRef = useRef(changeHistory);
  changeHistoryRef.current = changeHistory;
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
    if (aimDialog !== null) {
      // The docked confirm keeps the board interactive: clicking re-picks the
      // aimed tile without cancelling, preserving weapon/repeat choices.
      setAimDialog((current) => (current === null ? null : { ...current, target: tile }));
      setAimReviewOpen(false);
      setNotice(`Aim & Fire target moved to ${tile.x},${tile.y}.`);
      return;
    }
    if (scanDialog !== null) {
      return;
    }
    if ((modifiers.ctrl && modifiers.shift) || aimTool) {
      setAimDialog({
        target: tile,
        weapon: selectedWeapon,
      });
      setAimShots(modifiers.ctrl && modifiers.shift ? 2 : 1);
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
  const cancelFire = (message: string) => {
    setAimTool(false);
    setAimDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setScanDialog(null);
    setNotice(message);
  };
  const startAim = () => {
    if (aimTool || aimDialog !== null) {
      cancelFire("Aim & Fire canceled.");
      return;
    }
    setAimTool(true);
    setScanDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setNotice("Aim & Fire active — choose a target tile.");
  };
  const startScan = () => {
    if (scanDialog !== null) {
      cancelFire("Scan & Fire canceled.");
      return;
    }
    const defaults = defaultScanSettings(selectedWeapon, budgetTicks - selectedEndTick);
    setAimTool(false);
    setAimDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setScanDialog({
      weapon: selectedWeapon,
      maxDistance: defaults.maxDistance,
      seconds: defaults.seconds,
    });
    setNotice("Configure Scan & Fire distance and duration.");
  };

  useEffect(() => {
    if (notice.length === 0) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const robotViews = useMemo<readonly PlannerRobotView[]>(
    () =>
      team.robots.map((robot) => {
        const view = projectRobotAtTick(
          robot,
          timelineForRobot(orders, robot.id).segments,
          previewTick,
        );
        return {
          id: robot.id,
          label: robotNames.get(robot.id) ?? robot.definition.class,
          robotClass: robot.definition.class,
          color: team.color,
          position: view.position,
          posture: view.posture,
          scanHeading:
            robot.id === selectedRobot.id && headingPreview !== null
              ? headingPreview
              : view.scanHeading,
          selected: robot.id === selectedRobot.id,
        };
      }),
    [headingPreview, orders, previewTick, robotNames, selectedRobot.id, team.color, team.robots],
  );
  const targetingBase = useMemo<PlannerTargetingBase | null>(() => {
    const previewOnly =
      headingPreview !== null && !aimTool && aimDialog === null && scanDialog === null;
    if (
      projected.position === "dock" ||
      (!previewOnly && !aimTool && aimDialog === null && scanDialog === null)
    )
      return null;
    const mode = previewOnly || scanDialog !== null ? "scan" : "aim";
    const weapon = scanDialog?.weapon ?? aimDialog?.weapon ?? selectedWeapon;
    const maxDistance = scanDialog?.maxDistance ?? PLANNER_WEAPON_RANGE[weapon];
    const overlayShooter = {
      ...selectedRobot,
      position: projected.position,
      posture: projected.posture,
      scanHeading: headingPreview ?? projected.scanHeading,
    };
    return {
      previewOnly,
      mode,
      origin: projected.position,
      heading: headingPreview ?? projected.scanHeading,
      maxDistance,
      weapon,
      seconds: scanDialog?.seconds ?? null,
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
    headingPreview,
    scanDialog,
    selectedRobot,
    targetingPosture,
    selectedWeapon,
  ]);
  const cursorTargetingPreview =
    targetingBase === null || targetingBase.previewOnly || cursor === null
      ? null
      : (targetingBase.tiles[cursor.y * match.arena.width + cursor.x] ?? null);
  const cursorState =
    cursor === null
      ? "out-of-bounds"
      : cursorTargetingPreview !== null
        ? cursorTargetingPreview.status === "eligible"
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
  const previewAt = (tile: TileCoord | null) =>
    targetingBase === null || tile === null
      ? null
      : (targetingBase.tiles[tile.y * match.arena.width + tile.x] ?? null);
  const aimedPreview = previewAt(aimDialog?.target ?? null);

  // Active-fire controls that take over the strip's Aim/Scan entry-button slot
  // in place (constant strip height); null shows the two entry buttons.
  const fireControls =
    scanDialog !== null ? (
      <ScanFireControls
        weapon={scanDialog.weapon}
        maxDistance={scanDialog.maxDistance}
        seconds={scanDialog.seconds}
        onDistanceChange={(maxDistance) =>
          setScanDialog((current) => (current === null ? null : { ...current, maxDistance }))
        }
        onSecondsChange={(seconds) =>
          setScanDialog((current) => (current === null ? null : { ...current, seconds }))
        }
        onCancel={() => {
          setScanDialog(null);
          setNotice("Scan & Fire canceled.");
        }}
        onConfirm={() =>
          commitSegment(
            {
              kind: "scan-and-fire",
              weapon: scanDialog.weapon,
              maxDistance: scanDialog.maxDistance,
              seconds: scanDialog.seconds,
            },
            `Scan & Fire added · ${scanDialog.maxDistance} tiles for ${scanDialog.seconds} seconds.`,
          )
        }
      />
    ) : aimTool || aimDialog !== null ? (
      <AimFireControls
        weapon={aimDialog?.weapon ?? selectedWeapon}
        target={aimDialog?.target ?? null}
        shots={aimShots}
        maxShots={aimMaxShots}
        firingIntervalTicks={WEAPON_TIMING[aimWeapon].firingIntervalTicks}
        canReview={aimedPreview?.status === "eligible"}
        onShotsChange={setAimShots}
        onCancel={() => {
          cancelFire("Aim & Fire canceled.");
        }}
        onReview={() => setAimReviewOpen(true)}
      />
    ) : null;

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
      if (event.key === "Escape" && (aimTool || aimDialog !== null || scanDialog !== null)) {
        event.preventDefault();
        setAimTool(false);
        setAimDialog(null);
        setAimShots(1);
        setAimReviewOpen(false);
        setScanDialog(null);
        setNotice("Firing action canceled.");
        return;
      }
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        target.closest("input, select, textarea, [contenteditable='true']") !== null;
      if (aimDialog !== null || scanDialog !== null || typing) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && team.robots[index] !== undefined)
          selectRobotRef.current(team.robots[index].id);
        return;
      }
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        changeHistoryRef.current(event.shiftKey ? "redo" : "undo");
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        changeHistoryRef.current("redo");
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        const index = team.robots.findIndex((robot) => robot.id === selectedRobot.id);
        selectRobotRef.current(
          team.robots[(index + 1) % team.robots.length]?.id ?? selectedRobot.id,
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aimDialog, aimTool, scanDialog, selectedRobot.id, team.robots]);

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
          <div className="history-buttons planner-header-history" aria-label="Draft history">
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
      <RobotSelector
        robots={team.robots}
        names={robotNames}
        selectedRobotId={selectedRobot.id}
        selectedName={robotNames.get(selectedRobot.id) ?? "Selected robot"}
        usedTicks={selectedEndTick}
        budgetTicks={budgetTicks}
        showAllPrograms={showAllPrograms}
        onSelect={selectRobot}
        onToggleAllPrograms={() => setShowAllPrograms((current) => !current)}
        onClear={() =>
          edit(
            replaceTimeline(orders, selectedRobot.id, []),
            `${robotNames.get(selectedRobot.id) ?? "Selected robot"} plan cleared. Undo remains available.`,
          )
        }
      />
      <Timeline
        robots={team.robots}
        orders={orders}
        selectedRobotId={selectedRobot.id}
        budgetTicks={budgetTicks}
        previewTick={previewTick}
        onPreviewTick={setPreviewTick}
        remainingTicks={budgetTicks - selectedEndTick}
        onSelectCommand={selectCommand}
        onRemoveLast={removeCommand}
      />
      <div className="planner-lower">
        <PlannerActionStrip
          posture={projected.posture}
          heading={projected.scanHeading}
          weapons={weapons}
          selectedWeapon={selectedWeapon}
          missileAmmo={missileAmmo}
          disabled={projected.position === "dock"}
          aimActive={aimTool || aimDialog !== null}
          scanActive={scanDialog !== null}
          fireControls={fireControls}
          onPosture={addPosture}
          onHeadingPreview={setHeadingPreview}
          onHeading={addHeading}
          onWeapon={(weapon) => {
            setWeaponChoiceByRobot((current) => ({ ...current, [selectedRobot.id]: weapon }));
            setAimDialog((current) => (current === null ? null : { ...current, weapon }));
            setScanDialog((current) =>
              current === null
                ? null
                : {
                    ...current,
                    weapon,
                    maxDistance: Math.min(current.maxDistance, PLANNER_WEAPON_RANGE[weapon]),
                  },
            );
          }}
          onAim={startAim}
          onScan={startScan}
        />
        <div className="planner-arena-region">
          <ArenaCanvas
            arena={match.arena}
            robots={robotViews}
            homeAreas={homeAreaOverlays}
            route={selectedRoute}
            cursor={cursor}
            cursorState={cursorState}
            targetingOverlay={targetingOverlay}
            firingInteractionActive={aimTool || aimDialog !== null || scanDialog !== null}
            onAssumedPosture={setTargetingPosture}
            onCursor={setCursor}
            onChooseTile={chooseTile}
            onChooseRobot={selectRobot}
          />
          {aimReviewOpen && aimDialog !== null ? (
            <AimAndFireDialog
              arena={match.arena}
              shooter={projectedShooter}
              target={aimDialog.target}
              weapon={aimDialog.weapon}
              shots={aimShots}
              fireSeconds={
                (aimShots * WEAPON_TIMING[aimDialog.weapon].firingIntervalTicks) / TICKS_PER_SECOND
              }
              assumedPosture={targetingPosture}
              authorizedContacts={authorizedContacts}
              onBack={() => setAimReviewOpen(false)}
              onConfirm={() => {
                const shots = Array.from(
                  { length: aimShots },
                  () =>
                    ({
                      kind: "aim-and-fire",
                      target: aimDialog.target,
                      weapon: aimDialog.weapon,
                      repeat: false,
                    }) satisfies RobotCommandSegment,
                );
                commitSegments(
                  shots,
                  `${aimShots} Aim & Fire shot${aimShots === 1 ? "" : "s"} added at ${aimDialog.target.x},${aimDialog.target.y}.`,
                );
              }}
            />
          ) : null}
          {notice.length === 0 ? null : (
            <div
              className="planner-notice"
              data-severity={
                /blocked|out of|unavailable|invalid/i.test(notice) ? "warning" : "info"
              }
              role="status"
              aria-live="polite"
            >
              <span>{notice}</span>
            </div>
          )}
        </div>
        {showAllPrograms ? (
          <AllProgramsOverlay
            robots={team.robots}
            names={robotNames}
            orders={orders}
            selectedRobotId={selectedRobot.id}
            budgetTicks={budgetTicks}
            previewTick={previewTick}
            onPreviewTick={setPreviewTick}
            onSelectRobot={selectRobot}
            onSelectCommand={selectCommand}
            onRemoveLast={removeCommand}
            onClose={() => setShowAllPrograms(false)}
          />
        ) : null}
      </div>
    </main>
  );
}
