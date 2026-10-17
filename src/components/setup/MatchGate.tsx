"use client";

import { ArrowRight, Home, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { TurnOrders } from "../../engine/types";
import {
  deserializeMatchState,
  PROTOCOL_VERSION,
  type MatchSnapshotMessage,
  type ParticipantTurnResult,
} from "../../lib/net/protocol";
import { loadArchivedTurn, saveArchivedTurn } from "../../lib/replays/turnArchive";
import { TurnReel } from "../match/TurnReel";
import {
  forgetRoom,
  requestId,
  requestOnce,
  roomForMatch,
  roomToken,
  RoomRequestError,
  ServerProtocolError,
} from "../../lib/net/client";
import { matchFlowCopy, matchTabTitle, movieHandoffCopy } from "../../lib/presentation/matchFlow";
import { clearPlannerDraft } from "../../planner/draft";
import { PlannerExperience } from "../planner/PlannerExperience";
import { MovieExperience } from "../MovieExperience";
import { ConnectionOverlay } from "../match/ConnectionOverlay";
import { ReadyPanel } from "../match/ReadyPanel";
import { TeamDataPanel } from "../match/TeamDataPanel";
import { TurnExplanation } from "../match/TurnExplanation";
import { ObservedTurnExport } from "../replay/ObservedTurnExport";
import { ResignControl } from "../match/ResignControl";
import { MatchSectionBoundary } from "../match/MatchSectionBoundary";
import { MatchFlowHeader } from "../match/MatchFlowHeader";
import { FinalCeremony } from "../match/FinalCeremony";
import { ResetLocalData } from "../site/ResetLocalData";
import { SiteHeader } from "../site/SiteHeader";

type ReconnectOutcome =
  | { readonly kind: "retrying"; readonly message: string }
  | { readonly kind: "resumed"; readonly message: string }
  | { readonly kind: "incompatible-protocol"; readonly message: string };

type GateState =
  | { readonly kind: "checking" }
  | {
      readonly kind: "authorized";
      readonly roomCode: string;
      readonly snapshot: MatchSnapshotMessage;
    }
  | {
      readonly kind: "denied";
      readonly roomCode: string | null;
      readonly reason: string;
      readonly outcome: "room-missing" | "seat-forfeited" | "unavailable";
    };

const reconnectFailure = (caught: unknown): ReconnectOutcome =>
  caught instanceof ServerProtocolError
    ? { kind: "incompatible-protocol", message: caught.message }
    : {
        kind: "retrying",
        message:
          caught instanceof Error
            ? caught.message
            : "Your seat is safe. Reconnect to fetch the latest durable room state.",
      };

export function MatchGate({ matchId }: { readonly matchId: string }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [busy, setBusy] = useState(false);
  const [saveAcknowledgement, setSaveAcknowledgement] = useState<{
    readonly revision: string;
    readonly orders: TurnOrders;
  } | null>(null);
  const [connectionOutcome, setConnectionOutcome] = useState<ReconnectOutcome | null>(null);
  // An earlier turn chosen from the reel; null plays the default (latest) movie.
  const [rewatch, setRewatch] = useState<ParticipantTurnResult | null>(null);
  const [archiveRevision, setArchiveRevision] = useState(0);
  const unseenTurns = state.kind === "authorized" ? state.snapshot.unseenTurns : null;
  useEffect(() => {
    if (unseenTurns === null || unseenTurns.length === 0) return;
    let cancelled = false;
    void Promise.all(unseenTurns.map((turn) => saveArchivedTurn(matchId, turn))).then(() => {
      if (!cancelled) setArchiveRevision((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [matchId, unseenTurns]);
  const selectRewatch = useCallback(
    (turnNumber: number | null) => {
      if (turnNumber === null) {
        setRewatch(null);
        return;
      }
      void loadArchivedTurn(matchId, turnNumber).then((turn) => setRewatch(turn));
    },
    [matchId],
  );
  const tabStatus = state.kind === "authorized" ? state.snapshot.status : state.kind;
  const tabTurn =
    state.kind !== "authorized"
      ? 0
      : state.snapshot.status === "turn-ready"
        ? (state.snapshot.unseenTurns[0]?.turnNumber ?? 0)
        : state.snapshot.match.turnNumber;
  useEffect(() => {
    document.title = `${matchTabTitle(tabStatus, tabTurn)} · RoboArena`;
  }, [tabStatus, tabTurn]);
  const playbackTimer = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    const roomCode = roomForMatch(matchId);
    const token = roomCode === null ? null : roomToken(roomCode);
    if (roomCode === null || token === null) throw new Error("Participant seat is unavailable.");
    const response = await requestOnce({
      version: PROTOCOL_VERSION,
      requestId: requestId(),
      kind: "GetMatchState",
      code: roomCode,
      token,
    });
    if (response.matchId !== matchId) throw new Error("That room does not own this match.");
    setState({ kind: "authorized", roomCode, snapshot: response });
    setConnectionOutcome((current) =>
      current === null
        ? null
        : { kind: "resumed", message: "Durable room state resumed successfully." },
    );
    return response;
  }, [matchId]);

  useEffect(() => {
    let disposed = false;
    const roomCode = roomForMatch(matchId);
    const token = roomCode === null ? null : roomToken(roomCode);
    if (roomCode === null || token === null) {
      setState({
        kind: "denied",
        roomCode,
        reason: "Open this match through the room that issued your participant seat.",
        outcome: "seat-forfeited",
      });
      return;
    }
    setState({ kind: "checking" });
    void refresh()
      .then((response) => {
        if (disposed) return;
        setState({ kind: "authorized", roomCode, snapshot: response });
      })
      .catch((caught: unknown) => {
        if (disposed) return;
        if (caught instanceof RoomRequestError && caught.code === "UNAUTHORIZED") {
          forgetRoom(roomCode);
        }
        setState({
          kind: "denied",
          roomCode,
          outcome:
            caught instanceof RoomRequestError && caught.code === "ROOM_NOT_FOUND"
              ? "room-missing"
              : caught instanceof RoomRequestError && caught.code === "UNAUTHORIZED"
                ? "seat-forfeited"
                : "unavailable",
          reason:
            caught instanceof RoomRequestError && caught.code === "UNAUTHORIZED"
              ? "Your saved participant seat is no longer valid. Rejoin the room to continue."
              : caught instanceof RoomRequestError && caught.code === "ROOM_NOT_FOUND"
                ? "This room no longer exists on the authoritative room service."
                : caught instanceof ServerProtocolError
                  ? caught.message
                  : "The authoritative room service could not verify your seat. Try the room again.",
        });
      });
    return () => {
      disposed = true;
    };
  }, [matchId, refresh]);

  useEffect(() => {
    if (state.kind !== "authorized" || state.snapshot.status !== "waiting") return;
    const interval = window.setInterval(() => {
      void refresh().catch((caught: unknown) => {
        setConnectionOutcome(reconnectFailure(caught));
      });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [refresh, state]);

  useEffect(() => {
    if (connectionOutcome?.kind !== "resumed") return;
    const timer = window.setTimeout(() => setConnectionOutcome(null), 2500);
    return () => window.clearTimeout(timer);
  }, [connectionOutcome]);

  useEffect(
    () => () => {
      if (playbackTimer.current !== null) window.clearTimeout(playbackTimer.current);
    },
    [],
  );

  const savePlaybackPosition = useCallback(
    (turnNumber: number, tick: number) => {
      if (playbackTimer.current !== null) window.clearTimeout(playbackTimer.current);
      playbackTimer.current = window.setTimeout(() => {
        const roomCode = roomForMatch(matchId);
        const token = roomCode === null ? null : roomToken(roomCode);
        if (roomCode === null || token === null) return;
        void requestOnce({
          version: PROTOCOL_VERSION,
          requestId: requestId(),
          kind: "SetPlaybackPosition",
          code: roomCode,
          token,
          matchId,
          turnNumber,
          tick,
        }).catch(() =>
          setConnectionOutcome({
            kind: "retrying",
            message: "Playback is local, but its resume position could not be saved.",
          }),
        );
      }, 400);
    },
    [matchId],
  );

  const sendOrders = async (orders: TurnOrders, lock: boolean) => {
    const roomCode = roomForMatch(matchId);
    const token = roomCode === null ? null : roomToken(roomCode);
    if (roomCode === null || token === null) return;
    setBusy(true);
    try {
      const response = await requestOnce({
        version: PROTOCOL_VERSION,
        requestId: requestId(),
        kind: lock ? "LockOrders" : "SubmitOrders",
        code: roomCode,
        token,
        matchId,
        orders,
      });
      if (!lock)
        setSaveAcknowledgement({ revision: response.revision, orders: response.ownOrders });
      setState({ kind: "authorized", roomCode, snapshot: response });
      setConnectionOutcome(null);
      if (lock) {
        // The server now holds the canonical submission; a stale local draft
        // would otherwise look like an unsynced conflict on the next turn.
        try {
          clearPlannerDraft(window.localStorage, matchId, response.selfPlayerId);
        } catch {
          // Storage may be unavailable; the draft is inert either way.
        }
      }
    } catch (caught) {
      setConnectionOutcome(reconnectFailure(caught));
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (turnNumber: number) => {
    const roomCode = roomForMatch(matchId);
    const token = roomCode === null ? null : roomToken(roomCode);
    if (roomCode === null || token === null) return;
    setBusy(true);
    try {
      const response = await requestOnce({
        version: PROTOCOL_VERSION,
        requestId: requestId(),
        kind: "TurnResultAcknowledged",
        code: roomCode,
        token,
        matchId,
        turnNumber,
      });
      setState({ kind: "authorized", roomCode, snapshot: response });
      setConnectionOutcome(null);
    } catch (caught) {
      setConnectionOutcome(reconnectFailure(caught));
    } finally {
      setBusy(false);
    }
  };
  const resign = async () => {
    const roomCode = roomForMatch(matchId);
    const token = roomCode === null ? null : roomToken(roomCode);
    if (roomCode === null || token === null) return;
    setBusy(true);
    try {
      const response = await requestOnce({
        version: PROTOCOL_VERSION,
        requestId: requestId(),
        kind: "ResignMatch",
        code: roomCode,
        token,
        matchId,
      });
      setState({ kind: "authorized", roomCode, snapshot: response });
      setConnectionOutcome(null);
    } catch (caught) {
      setConnectionOutcome(reconnectFailure(caught));
    } finally {
      setBusy(false);
    }
  };

  if (state.kind === "checking") {
    return (
      <main className="site-page site-center-page">
        <div className="site-center">
          <div className="site-loader" role="status">
            <p className="site-label">Checking your seat</p>
            <span className="site-scan" aria-hidden="true" />
            <p className="site-fine">Asking the game server for this match…</p>
          </div>
        </div>
      </main>
    );
  }
  if (state.kind === "authorized") {
    const snapshot = state.snapshot;
    const match = deserializeMatchState(snapshot.match);
    const selfTeam = match.teams.find((team) => team.id === snapshot.selfPlayerId);
    if (selfTeam === undefined) throw new Error("Participant Team is missing from match state.");
    const spectating = selfTeam.robots.every((robot) => robot.hp <= 0);
    const recoverPlanner = () => {
      clearPlannerDraft(window.localStorage, matchId, snapshot.selfPlayerId);
      window.location.reload();
    };
    const reconnect =
      connectionOutcome === null ? null : (
        <ConnectionOverlay
          outcome={connectionOutcome.kind}
          message={connectionOutcome.message}
          busy={busy}
          onRetry={() => {
            setBusy(true);
            void refresh()
              .catch((caught: unknown) => setConnectionOutcome(reconnectFailure(caught)))
              .finally(() => setBusy(false));
          }}
        />
      );
    if (snapshot.status === "planning") {
      return (
        <>
          {reconnect}
          {snapshot.needsOrderReview ? (
            <p role="status" className="match-privacy-note">
              This Turn needs review after recovery. Your draft was preserved. Review it and lock
              again.
            </p>
          ) : null}
          <MatchSectionBoundary
            section="planner"
            resetKey={snapshot.revision}
            onRecover={recoverPlanner}
          >
            <PlannerExperience
              matchId={matchId}
              roomCode={state.roomCode}
              selfPlayerId={snapshot.selfPlayerId}
              match={match}
              arenaTheme={snapshot.arenaTheme}
              serverOrders={snapshot.ownOrders}
              serverRevision={snapshot.revision}
              saveAcknowledgement={saveAcknowledgement}
              syncing={busy}
              onSaveOrders={(orders) => void sendOrders(orders, false)}
              onLockOrders={(orders) => void sendOrders(orders, true)}
              onResign={() => void resign()}
            />
          </MatchSectionBoundary>
        </>
      );
    }
    const header = (children?: ReactNode) => (
      <MatchFlowHeader
        roomCode={state.roomCode}
        matchId={matchId}
        team={selfTeam}
        turnNumber={
          snapshot.status === "turn-ready"
            ? (snapshot.unseenTurns[0]?.turnNumber ?? match.turnNumber)
            : match.turnNumber
        }
        status={snapshot.status}
      >
        {children}
      </MatchFlowHeader>
    );
    if (snapshot.status === "waiting") {
      const required = snapshot.requiredPlayerIds ?? match.teams.map((team) => team.id);
      const lockedCount = required.filter((id) => snapshot.lockedPlayerIds.includes(id)).length;
      const copy = matchFlowCopy("waiting", match.turnNumber);
      return (
        <main className="site-page site-match">
          {reconnect}
          {header()}
          <section className="site-wait" aria-labelledby="wait-title">
            <span className="site-pill" data-tone={spectating ? "muted" : "go"}>
              <span className="site-lamp" aria-hidden="true" />
              {spectating ? "Your team is out · watching" : "Your orders are locked"}
            </span>
            <h1 id="wait-title" className="site-display site-wait-title">
              {spectating ? "Following the match" : copy.heading}
            </h1>
            <p className="site-wait-lede">
              {spectating
                ? "No orders are needed from you. New turn movies appear here as the remaining teams play."
                : copy.detail}
            </p>
            <p className="site-label">
              {lockedCount} of {required.length} teams locked for Turn {match.turnNumber}
            </p>
            <ReadyPanel
              match={match}
              lockedPlayerIds={snapshot.lockedPlayerIds}
              requiredPlayerIds={required}
              selfPlayerId={snapshot.selfPlayerId}
            />
          </section>
          <footer className="site-match-foot">
            <TeamDataPanel match={match} selfPlayerId={snapshot.selfPlayerId} />
            <p className="site-fine">Only ready status is shared. Orders stay private.</p>
            <div className="site-match-actions">
              <button
                type="button"
                className="site-button"
                data-variant="ghost"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw size={15} aria-hidden="true" /> {copy.primaryAction}
              </button>
              <Link className="site-button" href="/">
                <Home size={15} aria-hidden="true" /> Return home
              </Link>
              <ResignControl onResign={() => void resign()} disabled={busy} />
            </div>
          </footer>
        </main>
      );
    }
    if (snapshot.status === "turn-ready") {
      const turn = snapshot.unseenTurns[0];
      if (turn === undefined) {
        return (
          <main className="site-page site-match">
            {reconnect}
            {header()}
            <div className="site-center">
              <div className="site-loader" role="status">
                <p className="site-label">Fetching your turn movie</p>
                <span className="site-scan" aria-hidden="true" />
              </div>
            </div>
          </main>
        );
      }
      const handoff = movieHandoffCopy(turn.turnNumber, spectating);
      return (
        <main className="site-page site-match site-movie-page">
          {reconnect}
          {header(
            <TurnReel
              matchId={matchId}
              currentTurn={turn.turnNumber}
              selectedTurn={rewatch?.turnNumber ?? null}
              onSelect={selectRewatch}
              refreshKey={String(archiveRevision)}
            />,
          )}
          <h1 className="sr-only">Turn {turn.turnNumber} movie</h1>
          <div className="site-movie-stage">
            <MatchSectionBoundary
              section="movie"
              resetKey={`${snapshot.revision}:${turn.turnNumber}:${rewatch?.turnNumber ?? "latest"}`}
              onRecover={() => window.location.reload()}
            >
              {rewatch !== null && rewatch.turnNumber !== turn.turnNumber ? (
                <MovieExperience
                  key={`rewatch-${rewatch.turnNumber}`}
                  initialState={deserializeMatchState(rewatch.initialState)}
                  events={rewatch.events}
                  arenaTheme={snapshot.arenaTheme}
                />
              ) : (
                <MovieExperience
                  key={turn.turnNumber}
                  initialState={deserializeMatchState(turn.initialState)}
                  events={turn.events}
                  initialTick={turn.playbackTick}
                  onTickChange={(tick) => savePlaybackPosition(turn.turnNumber, tick)}
                  arenaTheme={snapshot.arenaTheme}
                />
              )}
            </MatchSectionBoundary>
          </div>
          <section className="site-after" aria-labelledby="after-turn-title">
            <h2 id="after-turn-title" className="site-label">
              After the turn
            </h2>
            <div className="site-after-grid">
              <div className="site-panel site-after-events">
                <TurnExplanation events={turn.events} />
              </div>
              <div className="site-after-side">
                <TeamDataPanel match={match} selfPlayerId={snapshot.selfPlayerId} />
                <div className="site-match-actions">
                  <ObservedTurnExport turn={turn} />
                  <Link className="site-button" href="/">
                    <Home size={15} aria-hidden="true" /> Return home
                  </Link>
                  <ResignControl onResign={() => void resign()} disabled={busy} />
                </div>
              </div>
            </div>
          </section>
          <div className="site-handoff">
            <div>
              <strong>{handoff.question}</strong>
              <p>{handoff.detail}</p>
            </div>
            <a className="site-button" data-variant="ghost" href="#after-turn-title">
              After the turn ↓
            </a>
            <button
              type="button"
              className="site-button"
              data-variant="go"
              data-size="lg"
              disabled={busy}
              onClick={() => void acknowledge(turn.turnNumber)}
            >
              {busy ? "Saving…" : handoff.action}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </main>
      );
    }
    return (
      <main className="site-page site-match site-results">
        {reconnect}
        {header()}
        <FinalCeremony
          teams={match.teams}
          scores={snapshot.ceremonyScores ?? []}
          selfTeamId={snapshot.selfPlayerId}
          {...(snapshot.outcome === undefined ? {} : { outcome: snapshot.outcome })}
          {...(snapshot.winningSide === undefined ? {} : { winningSide: snapshot.winningSide })}
        >
          <TurnReel
            matchId={matchId}
            currentTurn={null}
            selectedTurn={rewatch?.turnNumber ?? null}
            onSelect={selectRewatch}
            refreshKey={String(archiveRevision)}
          />
        </FinalCeremony>
        {rewatch !== null ? (
          <div className="site-movie-stage" id="rewatch">
            <MatchSectionBoundary
              section="movie"
              resetKey={`final:${rewatch.turnNumber}`}
              onRecover={() => setRewatch(null)}
            >
              <MovieExperience
                key={`rewatch-${rewatch.turnNumber}`}
                initialState={deserializeMatchState(rewatch.initialState)}
                events={rewatch.events}
              />
            </MatchSectionBoundary>
          </div>
        ) : null}
      </main>
    );
  }
  const roomCode = state.roomCode;
  return (
    <main className="site-page site-center-page">
      <SiteHeader />
      <div className="site-center">
        <section className="site-panel site-message" aria-labelledby="denied-title">
          <p className="site-label" data-tone="rail">
            {roomCode === null ? "Match" : `Room ${roomCode}`}
          </p>
          <h1 id="denied-title" className="site-display site-message-title">
            {state.outcome === "room-missing"
              ? "This room no longer exists"
              : state.outcome === "seat-forfeited"
                ? "This device has no seat in this match"
                : "Can’t reach the game server"}
          </h1>
          <p>{state.reason}</p>
          <div className="site-confirm-actions">
            {roomCode === null || state.outcome === "room-missing" ? (
              <Link href="/" className="site-button" data-variant="go" data-size="lg">
                <Home size={16} aria-hidden="true" /> Return home
              </Link>
            ) : (
              <>
                <Link
                  href={`/room/${roomCode}`}
                  className="site-button"
                  data-variant="go"
                  data-size="lg"
                >
                  Return to room {roomCode}
                </Link>
                <Link href="/" className="site-button" data-size="lg">
                  Home
                </Link>
              </>
            )}
          </div>
          <ResetLocalData />
        </section>
      </div>
    </main>
  );
}
