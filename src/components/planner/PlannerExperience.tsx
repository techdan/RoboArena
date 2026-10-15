"use client";

import {
  AlertTriangle,
  CloudOff,
  GraduationCap,
  LockKeyhole,
  Redo2,
  Save,
  ShieldCheck,
  Undo2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { TICKS_PER_SECOND, TIME_BOMB_BLAST, WEAPON_TIMING } from "../../engine/constants";
import { canTraverse } from "../../engine/traversal";
import type {
  Heading,
  LastKnownMarker,
  MatchState,
  Posture,
  RobotCommandSegment,
  RobotState,
  TileCoord,
  TurnOrders,
  WeaponId,
} from "../../engine/types";
import { loadPlannerDraft, savePlannerDraft } from "../../planner/draft";
import { plannerReducer, createPlannerState } from "../../planner/state";
import {
  canProgramPlaceBomb,
  canProgramSelfDestruct,
  canProgramZap,
  type PlannerRules,
  planMovement,
  previewParkingTick,
  projectRobotAtTick,
  rebaseTurnOrders,
  replaceTimeline,
  timelineForRobot,
  timelineTiming,
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
import { fireActionCount } from "../../planner/combatPresentation";
import {
  nextSurvivingRobotId,
  participantRobotDisplayName,
  robotDisplayNames,
} from "../../planner/presentation";
import { AimAndFireDialog } from "./AimAndFireDialog";
import { AllProgramsOverlay } from "./AllProgramsOverlay";
import {
  ArenaCanvas,
  type PlannerBombView,
  type PlannerContactView,
  type PlannerGhostView,
  type PlannerRobotView,
  type PlannerTargetingOverlay,
} from "./ArenaCanvas";
import { AimFireControls, ScanFireControls, SpecialCommandControls } from "./FireControlStrip";
import { PlannerActionStrip } from "./PlannerActionStrip";
import { PlannerMenu } from "./PlannerMenu";
import { FirstTurnCoach } from "./FirstTurnCoach";
import {
  coachFinished,
  currentCoachStep,
  rememberCoach,
  type CoachStepId,
} from "../../planner/firstTurnCoach";
import { RobotSelector } from "./RobotSelector";
import { PlannerBoard3D } from "./PlannerBoard3D";
import { RadialOrders } from "./RadialOrders";
import { ShotCard } from "./ShotCard";
import { SquadRail } from "./SquadRail";
import { TurnTrack } from "./TurnTrack";
import {
  preferredPlannerBoard,
  rememberPlannerBoard,
  supportsWebGl2,
} from "../../renderer3d/support";
import { DEFAULT_ARENA_THEME, type ArenaThemeId } from "../../renderer3d/themes";
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

/** The first surviving robot, or the roster's first entry if the whole team is destroyed. */
const defaultSelectableRobot = (robots: readonly RobotState[]): RobotState | undefined =>
  robots.find((robot) => robot.hp > 0) ?? robots[0];

interface AimDialogState {
  readonly target: TileCoord;
  readonly weapon: WeaponId;
}

interface ScanDialogState {
  readonly weapon: WeaponId;
  readonly maxDistance: number;
  readonly seconds: number;
}

/** Zap duration or Place Bomb fuse being configured before it is added. */
interface SpecialDialogState {
  readonly kind: "zap" | "place-bomb" | "self-destruct";
  /** Unused by Self Destruct, which only asks for confirmation. */
  readonly seconds: number;
}

const SPECIAL_COMMAND_NAMES: Readonly<Record<SpecialDialogState["kind"], string>> = {
  zap: "Zap",
  "place-bomb": "Place Bomb",
  "self-destruct": "Self Destruct",
};

/** Default Zap duration and bomb fuse, in seconds. */
const DEFAULT_ZAP_SECONDS = 5;
const DEFAULT_BOMB_FUSE_SECONDS = 5;

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
  /** The room's arena look for the 3D board. */
  readonly arenaTheme?: ArenaThemeId | undefined;
  readonly serverOrders?: TurnOrders;
  readonly serverRevision?: string;
  readonly saveAcknowledgement?: { readonly revision: string; readonly orders: TurnOrders } | null;
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
  saveAcknowledgement,
  syncing = false,
  onSaveOrders,
  onLockOrders,
  onResign,
  arenaTheme,
}: PlannerExperienceProps) {
  // 3D board wherever WebGL2 runs, unless the player chose 2D. Decided after
  // mount because the server render can't probe WebGL.
  const [boardKind, setBoardKind] = useState<"3d" | "2d">("2d");
  const [can3d, setCan3d] = useState(false);
  useEffect(() => {
    setCan3d(supportsWebGl2());
    setBoardKind(preferredPlannerBoard());
  }, []);
  const chooseBoard = (kind: "3d" | "2d") => {
    rememberPlannerBoard(kind);
    setBoardKind(kind);
  };
  const team = match.teams.find((candidate) => candidate.id === selfPlayerId);
  if (team === undefined)
    throw new Error("The participant team is missing from this match snapshot.");
  const authorizedContacts = useMemo<readonly AuthorizedContact[]>(
    () =>
      match.teams.flatMap((candidate) =>
        candidate.side === team.side
          ? []
          : candidate.robots.flatMap((robot) =>
              robot.position === "dock"
                ? []
                : [
                    {
                      id: robot.id,
                      label: participantRobotDisplayName(
                        candidate.name,
                        robot.id,
                        robot.definition.class,
                      ),
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
  const [selectedRobotId, setSelectedRobotId] = useState(
    defaultSelectableRobot(team.robots)?.id ?? "",
  );
  const [aimTool, setAimTool] = useState(false);
  const [aimDialog, setAimDialog] = useState<AimDialogState | null>(null);
  const [aimShots, setAimShots] = useState(1);
  const [aimReviewOpen, setAimReviewOpen] = useState(false);
  const [scanDialog, setScanDialog] = useState<ScanDialogState | null>(null);
  const [specialDialog, setSpecialDialog] = useState<SpecialDialogState | null>(null);
  const [targetingPosture, setTargetingPosture] = useState<Posture>("upright");
  const [headingPreview, setHeadingPreview] = useState<Heading | null>(null);
  const [weaponChoiceByRobot, setWeaponChoiceByRobot] = useState<
    Readonly<Record<string, WeaponId>>
  >({});
  const [cursor, setCursor] = useState<TileCoord | null>(null);
  const [showAllPrograms, setShowAllPrograms] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [rehearsing, setRehearsing] = useState(false);
  // First-turn guide: shown until the player finishes or closes it once.
  const [coachActive, setCoachActive] = useState(false);
  const [coachOrdersOpened, setCoachOrdersOpened] = useState(false);
  const [coachRehearsed, setCoachRehearsed] = useState(false);
  const [coachSkipped, setCoachSkipped] = useState<ReadonlySet<CoachStepId>>(new Set());
  useEffect(() => {
    setCoachActive(!coachFinished(window.localStorage));
  }, []);
  useEffect(() => {
    if (ordersOpen) setCoachOrdersOpened(true);
  }, [ordersOpen]);
  useEffect(() => {
    if (rehearsing) setCoachRehearsed(true);
  }, [rehearsing]);
  const finishCoach = () => {
    setCoachActive(false);
    rememberCoach(window.localStorage, true);
  };
  const replayCoach = () => {
    rememberCoach(window.localStorage, false);
    setCoachOrdersOpened(false);
    setCoachRehearsed(false);
    setCoachSkipped(new Set());
    setCoachActive(true);
  };
  // Overlaid chrome sizes, so the 3D board frames the arena in the open area.
  const barRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [boardInsets, setBoardInsets] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  useEffect(() => {
    if (boardKind !== "3d") return;
    const measure = () => {
      const bar = barRef.current?.getBoundingClientRect();
      const rail = railRef.current?.getBoundingClientRect();
      const track = trackRef.current?.getBoundingClientRect();
      const next = {
        top: Math.round(bar?.bottom ?? 0),
        right: 16,
        bottom: Math.round(track === undefined ? 0 : window.innerHeight - track.top),
        left: Math.round(rail?.right ?? 0),
      };
      setBoardInsets((current) =>
        current.top === next.top &&
        current.bottom === next.bottom &&
        current.left === next.left &&
        current.right === next.right
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [barRef.current, railRef.current, trackRef.current])
      if (element !== null) observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [boardKind]);
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
  const selectedRobot =
    team.robots.find((robot) => robot.id === selectedRobotId) ??
    defaultSelectableRobot(team.robots);
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
  const grenadeAmmoValue = projectedWeaponAmmo(selectedRobot, commandPrefix, "grenade-launcher");
  const grenadeAmmo =
    selectedRobot.definition.secondaryWeapons?.includes("grenade-launcher") === true &&
    grenadeAmmoValue !== "unlimited"
      ? grenadeAmmoValue
      : null;
  const plannerRules: PlannerRules = {
    ...match.config,
    liveTeamRobots: team.robots.filter((robot) => robot.hp > 0).length,
  };
  const zapAllowed = canProgramZap(plannerRules, projected);
  const bombAllowed = canProgramPlaceBomb(projected);
  // Nothing can follow a Self Destruct, so a second one is never offered.
  const selfDestructAllowed =
    canProgramSelfDestruct(plannerRules, projected) &&
    commandPrefix.at(-1)?.kind !== "self-destruct";
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
  const lastSaveAcknowledgement = useRef(saveAcknowledgement);
  useEffect(() => {
    if (
      lastRevision.current === revision &&
      lastSaveAcknowledgement.current === saveAcknowledgement
    )
      return;
    lastRevision.current = revision;
    lastSaveAcknowledgement.current = saveAcknowledgement;
    dispatch({
      type:
        saveAcknowledgement?.revision === revision ? "save-acknowledged" : "authoritative-refresh",
      revision,
      orders: authoritativeOrders,
    });
  }, [authoritativeOrders, revision, saveAcknowledgement]);

  const edit = (next: TurnOrders, message: string, parkTick?: number) => {
    dispatch({ type: "edit", orders: next });
    setAimTool(false);
    setAimDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setScanDialog(null);
    setSpecialDialog(null);
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
      plannerRules,
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
  const removeFrom = (robotId: string, index: number) => {
    const robot = team.robots.find((candidate) => candidate.id === robotId);
    if (robot === undefined) return;
    const currentSegments = timelineForRobot(orders, robotId).segments;
    // Drop this action and everything after it; validation keeps the prefix
    // legal (it already was) and re-parks the preview at the new program end.
    const kept = currentSegments.slice(0, index);
    const validated = validatedTimelinePrefix(
      match.arena,
      robot,
      team.homeSlot,
      kept,
      plannerRules,
    );
    const removedCount = currentSegments.length - index;
    setSelectedRobotId(robotId);
    edit(
      replaceTimeline(orders, robotId, validated.segments),
      removedCount <= 1
        ? "Action removed. Undo remains available."
        : `Removed ${removedCount} actions from here to the end. Undo remains available.`,
      previewParkingTick(robot, validated.segments, budgetTicks),
    );
  };
  const selectRobot = (robotId: string) => {
    const robot = team.robots.find((candidate) => candidate.id === robotId);
    if (robot === undefined || robot.hp <= 0) return;
    setSelectedRobotId(robotId);
    setAimTool(false);
    setAimDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setScanDialog(null);
    setSpecialDialog(null);
    setHeadingPreview(null);
    setPreviewTick(
      previewParkingTick(robot, timelineForRobot(orders, robotId).segments, budgetTicks),
    );
  };
  /** Tapping a robot on the board selects it and opens its orders ring. */
  const pickRobotOnBoard = (robotId: string) => {
    if (robotId === selectedRobot.id) {
      setOrdersOpen((open) => !open);
      return;
    }
    selectRobot(robotId);
    setOrdersOpen(true);
  };
  const chooseBoardTile = (
    tile: TileCoord,
    modifiers: { readonly ctrl: boolean; readonly shift: boolean },
  ) => {
    setOrdersOpen(false);
    setRehearsing(false);
    chooseTile(tile, modifiers);
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
    setSpecialDialog(null);
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
    if (scanDialog !== null || specialDialog !== null) {
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
    setSpecialDialog(null);
    setNotice(message);
  };
  const startAim = () => {
    if (aimTool || aimDialog !== null) {
      cancelFire("Aim & Fire canceled.");
      return;
    }
    setAimTool(true);
    setScanDialog(null);
    setSpecialDialog(null);
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
    setSpecialDialog(null);
    setScanDialog({
      weapon: selectedWeapon,
      maxDistance: defaults.maxDistance,
      seconds: defaults.seconds,
    });
    setNotice("Configure Scan & Fire distance and duration.");
  };
  const startSpecial = (kind: SpecialDialogState["kind"]) => {
    const name = SPECIAL_COMMAND_NAMES[kind];
    if (specialDialog?.kind === kind) {
      cancelFire(`${name} canceled.`);
      return;
    }
    if (
      kind === "zap" ? !zapAllowed : kind === "place-bomb" ? !bombAllowed : !selfDestructAllowed
    ) {
      setNotice(
        kind === "zap"
          ? "Zap is unavailable — this formation does not arm it."
          : kind === "place-bomb"
            ? "Place Bomb is unavailable — this robot carries no Time Bomb."
            : "Self Destruct is unavailable — only a Team's last deployed robot can use it.",
      );
      return;
    }
    setAimTool(false);
    setAimDialog(null);
    setAimShots(1);
    setAimReviewOpen(false);
    setScanDialog(null);
    const remainingSeconds = Math.floor((budgetTicks - selectedEndTick) / TICKS_PER_SECOND);
    setSpecialDialog({
      kind,
      seconds:
        kind === "zap"
          ? Math.max(1, Math.min(DEFAULT_ZAP_SECONDS, remainingSeconds))
          : kind === "place-bomb"
            ? DEFAULT_BOMB_FUSE_SECONDS
            : 0,
    });
    setNotice(
      kind === "zap"
        ? "Set how long to Zap."
        : kind === "place-bomb"
          ? "Set the Time Bomb fuse, then add it."
          : "Confirm Self Destruct — this robot will blow itself up.",
    );
  };
  const confirmSpecial = () => {
    if (specialDialog === null) return;
    if (specialDialog.kind === "zap") {
      commitSegment(
        { kind: "zap", seconds: specialDialog.seconds },
        `Zap added · ${specialDialog.seconds} seconds.`,
      );
    } else if (specialDialog.kind === "self-destruct") {
      commitSegment(
        { kind: "self-destruct" },
        "Self Destruct added · the robot explodes shortly after it starts.",
      );
    } else {
      commitSegment(
        { kind: "place-bomb", fuseSeconds: specialDialog.seconds },
        `Time Bomb placed · goes off ${specialDialog.seconds} seconds after it is armed.`,
      );
    }
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
  // Enemy robots the server projection currently authorizes (visible this turn).
  const contactViews = useMemo<readonly PlannerContactView[]>(
    () =>
      match.teams.flatMap((candidate) =>
        candidate.side === team.side
          ? []
          : candidate.robots.flatMap((robot) => {
              const pos = robot.position;
              if (pos === "dock" || robot.hp <= 0) return [];
              return [
                {
                  id: robot.id,
                  label: participantRobotDisplayName(
                    candidate.name,
                    robot.id,
                    robot.definition.class,
                  ),
                  robotClass: robot.definition.class,
                  color: candidate.color,
                  position: pos,
                  posture: robot.posture,
                  scanHeading: robot.scanHeading,
                },
              ];
            }),
      ),
    [match.teams, team.side],
  );
  // Last-known enemy positions (ghosts) carried in the snapshot, minus any enemy
  // that is visible again this turn so a live contact isn't shadowed by a ghost.
  const ghostViews = useMemo<readonly PlannerGhostView[]>(() => {
    const markers: readonly LastKnownMarker[] =
      match.lastKnownMarkers instanceof Map ? (match.lastKnownMarkers.get(selfPlayerId) ?? []) : [];
    const visibleIds = new Set(contactViews.map((contact) => contact.id));
    return markers
      .filter((marker) => !visibleIds.has(marker.enemyId))
      .map((marker) => ({ at: marker.at, label: "Last seen" }));
  }, [contactViews, match.lastKnownMarkers, selfPlayerId]);
  // The player's own armed Time Bombs (the server sends only this Team's),
  // labelled with the time left from the start of this turn.
  const bombViews = useMemo<readonly PlannerBombView[]>(
    () =>
      (match.armedBombs ?? [])
        .filter((bomb) => bomb.teamId === team.id)
        .map((bomb) => ({
          at: bomb.at,
          label: `Bomb ${Math.ceil(bomb.detonatesAt / TICKS_PER_SECOND)}s`,
        })),
    [match.armedBombs, team.id],
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
          setSpecialDialog(null);
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
    ) : specialDialog !== null ? (
      <SpecialCommandControls
        kind={specialDialog.kind}
        seconds={specialDialog.seconds}
        onSecondsChange={(seconds) =>
          setSpecialDialog((current) => (current === null ? null : { ...current, seconds }))
        }
        onCancel={() => cancelFire(`${SPECIAL_COMMAND_NAMES[specialDialog.kind]} canceled.`)}
        onConfirm={confirmSpecial}
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
      plannerRules,
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

  // Rehearse: play the whole squad's orders in real time from the playhead.
  const previewTickRef = useRef(previewTick);
  previewTickRef.current = previewTick;
  useEffect(() => {
    if (!rehearsing) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const next = Math.min(
        budgetTicks,
        previewTickRef.current + ((now - last) / 1000) * TICKS_PER_SECOND,
      );
      last = now;
      previewTickRef.current = next;
      setPreviewTick(next);
      if (next >= budgetTicks) setRehearsing(false);
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [budgetTicks, rehearsing]);
  const toggleRehearse = () => {
    if (rehearsing) {
      setRehearsing(false);
      return;
    }
    setOrdersOpen(false);
    if (previewTick >= budgetTicks - 1) setPreviewTick(0);
    setRehearsing(true);
  };
  const cyclePosture = () => {
    const order: readonly Posture[] = ["upright", "ducking", "crouching"];
    addPosture(order[(order.indexOf(projected.posture) + 1) % order.length] ?? "upright");
  };
  const tacticalKeysRef = useRef({
    aim: startAim,
    scan: startScan,
    posture: cyclePosture,
    orders: () => setOrdersOpen(true),
    rehearse: toggleRehearse,
    zap: () => startSpecial("zap"),
    bomb: () => startSpecial("place-bomb"),
    selfDestruct: () => startSpecial("self-destruct"),
  });
  tacticalKeysRef.current = {
    aim: startAim,
    scan: startScan,
    posture: cyclePosture,
    orders: () => setOrdersOpen(true),
    rehearse: toggleRehearse,
    zap: () => startSpecial("zap"),
    bomb: () => startSpecial("place-bomb"),
    selfDestruct: () => startSpecial("self-destruct"),
  };
  const tacticalRef = useRef(false);
  tacticalRef.current = boardKind === "3d";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        (aimTool || aimDialog !== null || scanDialog !== null || specialDialog !== null)
      ) {
        event.preventDefault();
        setAimTool(false);
        setAimDialog(null);
        setAimShots(1);
        setAimReviewOpen(false);
        setScanDialog(null);
        setSpecialDialog(null);
        setNotice("Firing action canceled.");
        return;
      }
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        target.closest("input, select, textarea, [contenteditable='true']") !== null;
      if (aimDialog !== null || scanDialog !== null || specialDialog !== null || typing) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey || event.altKey) && tacticalRef.current) {
        const key = event.key.toLowerCase();
        const action =
          key === "a"
            ? tacticalKeysRef.current.aim
            : key === "s"
              ? tacticalKeysRef.current.scan
              : key === "d"
                ? tacticalKeysRef.current.posture
                : key === "f"
                  ? tacticalKeysRef.current.orders
                  : key === "r"
                    ? tacticalKeysRef.current.rehearse
                    : key === "z"
                      ? tacticalKeysRef.current.zap
                      : key === "b"
                        ? tacticalKeysRef.current.bomb
                        : key === "x"
                          ? tacticalKeysRef.current.selfDestruct
                          : null;
        if (action !== null) {
          event.preventDefault();
          action();
          return;
        }
        if (event.key === "Escape") {
          setOrdersOpen(false);
          return;
        }
      }
      if (!(event.ctrlKey || event.metaKey)) {
        const shortcutRobot = team.robots[Number(event.key) - 1];
        if (shortcutRobot !== undefined && shortcutRobot.hp > 0)
          selectRobotRef.current(shortcutRobot.id);
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
        const nextRobotId = nextSurvivingRobotId(team.robots, selectedRobot.id);
        if (nextRobotId !== null) selectRobotRef.current(nextRobotId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aimDialog, aimTool, scanDialog, specialDialog, selectedRobot.id, team.robots]);

  const confirmAim = () => {
    if (aimDialog === null) return;
    const count = fireActionCount(aimDialog.weapon, aimShots);
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
      `${count.primary} added at ${aimDialog.target.x},${aimDialog.target.y}${count.projectiles === null ? "" : ` · ${count.projectiles}`}.`,
    );
  };
  const chooseWeapon = (weapon: WeaponId) => {
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
  };
  const fireActive = aimTool || aimDialog !== null || scanDialog !== null || specialDialog !== null;
  const conflictBanner =
    state.conflictRevision !== null && state.conflictOrders !== null ? (
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
    ) : null;
  const plannerMenu = (
    <PlannerMenu alert={draftStorageStatus === "error"}>
      <FieldGuideButton />
      {boardKind === "3d" ? (
        <button type="button" className="planner-menu-item cursor-pointer" onClick={replayCoach}>
          <GraduationCap size={14} aria-hidden="true" /> First turn guide
        </button>
      ) : null}
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
        {draftStorageStatus === "saved" ? "Saved locally" : "Memory only — storage unavailable"}
      </span>
      {onResign === undefined ? null : <ResignControl onResign={onResign} disabled={syncing} />}
    </PlannerMenu>
  );
  const syncActions = (
    <>
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
    </>
  );

  if (boardKind === "3d") {
    const selectedName = robotNames.get(selectedRobot.id) ?? "Selected robot";
    const plannedRobots = team.robots.filter(
      (robot) =>
        robot.hp > 0 &&
        (timelineTiming(robot, timelineForRobot(orders, robot.id).segments, budgetTicks).at(-1)
          ?.endTick ?? 0) > 0,
    ).length;
    const livingRobots = team.robots.filter((robot) => robot.hp > 0).length;
    const coachStep = coachActive
      ? currentCoachStep({
          timelines: team.robots
            .filter((robot) => robot.hp > 0)
            .map((robot) => timelineForRobot(orders, robot.id).segments),
          ordersOpened: coachOrdersOpened,
          rehearsed: coachRehearsed,
          skipped: coachSkipped,
        })
      : null;
    return (
      <main
        className="tactical-planner desktop-viewport-gate"
        data-coach={coachStep?.id}
        style={{ "--tactical-track-h": `${boardInsets.bottom}px` } as CSSProperties}
      >
        <PlannerBoard3D
          match={match}
          theme={arenaTheme ?? DEFAULT_ARENA_THEME}
          onUse2D={() => chooseBoard("2d")}
          insets={boardInsets}
          arena={match.arena}
          robots={robotViews}
          contacts={contactViews}
          ghosts={ghostViews}
          bombs={bombViews}
          previewProgress={Math.min(1, previewTick / Math.max(1, budgetTicks))}
          homeAreas={homeAreaOverlays}
          route={selectedRoute}
          cursor={cursor}
          cursorState={cursorState}
          targetingOverlay={targetingOverlay}
          firingInteractionActive={fireActive}
          onAssumedPosture={setTargetingPosture}
          onCursor={setCursor}
          onChooseTile={chooseBoardTile}
          onChooseRobot={pickRobotOnBoard}
          anchorTile={
            ordersOpen && !fireActive && !rehearsing && projected.position !== "dock"
              ? projected.position
              : null
          }
          anchorContent={
            <RadialOrders
              key={selectedRobot.id}
              name={selectedName}
              posture={projected.posture}
              heading={projected.scanHeading}
              onMove={() => {
                setOrdersOpen(false);
                setNotice(`Tap the floor to move ${selectedName}.`);
              }}
              onAim={() => {
                setOrdersOpen(false);
                startAim();
              }}
              onScan={() => {
                setOrdersOpen(false);
                startScan();
              }}
              {...(zapAllowed
                ? {
                    onZap: () => {
                      setOrdersOpen(false);
                      startSpecial("zap");
                    },
                  }
                : {})}
              {...(bombAllowed
                ? {
                    onPlaceBomb: () => {
                      setOrdersOpen(false);
                      startSpecial("place-bomb");
                    },
                  }
                : {})}
              {...(selfDestructAllowed
                ? {
                    onSelfDestruct: () => {
                      setOrdersOpen(false);
                      startSpecial("self-destruct");
                    },
                  }
                : {})}
              onPosture={addPosture}
              onHeadingPreview={setHeadingPreview}
              onHeading={addHeading}
              onClose={() => setOrdersOpen(false)}
            />
          }
        />
        <header className="tactical-bar" ref={barRef}>
          <div className="tactical-bar-lead">
            {plannerMenu}
            <div>
              <p className="eyebrow">Turn {match.turnNumber} · Your orders</p>
              <h1>Plan your {match.config.turnLengthSeconds} seconds</h1>
            </div>
          </div>
          <div className="tactical-bar-actions">
            <span className="tactical-progress">
              {plannedRobots} of {livingRobots} robots planned
            </span>
            {syncActions}
          </div>
        </header>
        <div className="tactical-rail" ref={railRef}>
          <SquadRail
            robots={team.robots}
            names={robotNames}
            orders={orders}
            selectedRobotId={selectedRobot.id}
            budgetTicks={budgetTicks}
            onSelect={(robotId) => {
              selectRobot(robotId);
              setOrdersOpen(true);
            }}
            onClear={() =>
              edit(
                replaceTimeline(orders, selectedRobot.id, []),
                `${selectedName} plan cleared. Undo remains available.`,
              )
            }
          />
          <div className="history-buttons tactical-history" aria-label="Draft history">
            <button
              type="button"
              onClick={() => changeHistory("undo")}
              disabled={state.history.past.length === 0}
              aria-label="Undo"
              title="Undo — Ctrl+Z"
            >
              <Undo2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => changeHistory("redo")}
              disabled={state.history.future.length === 0}
              aria-label="Redo"
              title="Redo — Ctrl+Shift+Z"
            >
              <Redo2 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        {conflictBanner}
        {coachStep !== null ? (
          fireActive && coachStep.id !== "aim" ? null : (
            <FirstTurnCoach
              step={coachStep}
              turnSeconds={match.config.turnLengthSeconds}
              onSkipStep={() => setCoachSkipped((skipped) => new Set([...skipped, coachStep.id]))}
              onFinish={finishCoach}
            />
          )
        ) : projected.position === "dock" ? (
          <div className="tactical-hint" role="status">
            Tap a tile in your home corner to deploy <strong>{selectedName}</strong>.
          </div>
        ) : !ordersOpen && !fireActive && !rehearsing ? (
          <div className="tactical-hint" role="status">
            Tap the floor to move <strong>{selectedName}</strong>, or tap it for orders.
          </div>
        ) : null}
        {aimTool || aimDialog !== null ? (
          <ShotCard
            arena={match.arena}
            shooter={projectedShooter}
            shooterName={selectedName}
            target={aimDialog?.target ?? cursor}
            locked={aimDialog !== null}
            weapon={aimWeapon}
            weapons={weapons}
            shots={aimShots}
            maxShots={aimMaxShots}
            firingIntervalTicks={WEAPON_TIMING[aimWeapon].firingIntervalTicks}
            assumedPosture={targetingPosture}
            authorizedContacts={authorizedContacts}
            onWeapon={chooseWeapon}
            onShots={setAimShots}
            onConfirm={confirmAim}
            onCancel={() => cancelFire("Aim canceled.")}
          />
        ) : scanDialog !== null ? (
          <aside className="tactical-card scan-card" aria-label="Scan and fire">
            <header>
              <p className="eyebrow">Scan &amp; fire · {selectedName}</p>
            </header>
            <p className="shot-card-empty">
              {selectedName} fires at any enemy that enters the lit arc within range.
            </p>
            {fireControls}
          </aside>
        ) : specialDialog !== null ? (
          <aside
            className="tactical-card scan-card"
            aria-label={SPECIAL_COMMAND_NAMES[specialDialog.kind]}
          >
            <header>
              <p className="eyebrow">
                {SPECIAL_COMMAND_NAMES[specialDialog.kind]} · {selectedName}
              </p>
            </header>
            <p className="shot-card-empty">
              {specialDialog.kind === "zap"
                ? `${selectedName} zaps any enemy standing on its tile, up to once a second.`
                : specialDialog.kind === "place-bomb"
                  ? `${selectedName} arms its Time Bomb here. It blasts every robot within ${TIME_BOMB_BLAST.radius} tiles, yours too.`
                  : `${selectedName} explodes on its own tile, blasting every robot within ${TIME_BOMB_BLAST.radius} tiles — itself included. Nothing can follow it.`}
            </p>
            {fireControls}
          </aside>
        ) : null}
        {notice.length === 0 ? null : (
          <div
            className="planner-notice tactical-notice"
            data-severity={/blocked|out of|unavailable|invalid/i.test(notice) ? "warning" : "info"}
            role="status"
            aria-live="polite"
          >
            <span>{notice}</span>
          </div>
        )}
        <div className="tactical-track" ref={trackRef}>
          <TurnTrack
            robots={team.robots}
            names={robotNames}
            orders={orders}
            selectedRobotId={selectedRobot.id}
            budgetTicks={budgetTicks}
            previewTick={previewTick}
            rehearsing={rehearsing}
            onPreviewTick={(tick) => {
              setRehearsing(false);
              setPreviewTick(tick);
            }}
            onRehearse={toggleRehearse}
            onSelectRobot={selectRobot}
            onSelectCommand={selectCommand}
            onRemoveFrom={removeFrom}
          />
        </div>
      </main>
    );
  }

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
        onRemoveFrom={removeFrom}
      />
      <div className="planner-lower">
        <PlannerActionStrip
          posture={projected.posture}
          heading={projected.scanHeading}
          weapons={weapons}
          selectedWeapon={selectedWeapon}
          missileAmmo={missileAmmo}
          grenadeAmmo={grenadeAmmo}
          disabled={projected.position === "dock"}
          aimActive={aimTool || aimDialog !== null}
          scanActive={scanDialog !== null}
          fireControls={fireControls}
          historyControls={
            <div className="history-buttons planner-header-history" aria-label="Draft history">
              <button
                type="button"
                onClick={() => changeHistory("undo")}
                disabled={state.history.past.length === 0}
                aria-label={`Undo (${state.history.past.length} step${state.history.past.length === 1 ? "" : "s"} available)`}
                title="Undo — Ctrl+Z"
              >
                <Undo2 size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => changeHistory("redo")}
                disabled={state.history.future.length === 0}
                aria-label={`Redo (${state.history.future.length} step${state.history.future.length === 1 ? "" : "s"} available)`}
                title="Redo — Ctrl+Shift+Z"
              >
                <Redo2 size={16} aria-hidden="true" />
              </button>
            </div>
          }
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
          {...(zapAllowed
            ? { zap: { active: specialDialog?.kind === "zap", onStart: () => startSpecial("zap") } }
            : {})}
          {...(bombAllowed || specialDialog?.kind === "place-bomb"
            ? {
                placeBomb: {
                  active: specialDialog?.kind === "place-bomb",
                  onStart: () => startSpecial("place-bomb"),
                },
              }
            : {})}
          {...(selfDestructAllowed || specialDialog?.kind === "self-destruct"
            ? {
                selfDestruct: {
                  active: specialDialog?.kind === "self-destruct",
                  onStart: () => startSpecial("self-destruct"),
                },
              }
            : {})}
        />
        <div className="planner-arena-region">
          <ArenaCanvas
            arena={match.arena}
            robots={robotViews}
            contacts={contactViews}
            ghosts={ghostViews}
            bombs={bombViews}
            previewProgress={Math.min(1, previewTick / Math.max(1, budgetTicks))}
            homeAreas={homeAreaOverlays}
            route={selectedRoute}
            cursor={cursor}
            cursorState={cursorState}
            targetingOverlay={targetingOverlay}
            firingInteractionActive={fireActive}
            onAssumedPosture={setTargetingPosture}
            onCursor={setCursor}
            onChooseTile={chooseTile}
            onChooseRobot={selectRobot}
          />
          {can3d ? (
            <button
              type="button"
              className="planner-board-switch cursor-pointer"
              onClick={() => chooseBoard("3d")}
            >
              3D board
            </button>
          ) : null}
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
              onConfirm={confirmAim}
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
            onRemoveFrom={removeFrom}
            onClose={() => setShowAllPrograms(false)}
          />
        ) : null}
      </div>
    </main>
  );
}
