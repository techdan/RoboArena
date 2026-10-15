"use client";

import { Home, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
  resetLocalGameData,
  roomForMatch,
  roomToken,
  RoomRequestError,
  ServerProtocolError,
} from "../../lib/net/client";
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
      <main className="grid min-h-screen place-items-center bg-[#0d100e] text-white">
        <div className="text-center" role="status">
          <LoaderCircle
            className="mx-auto size-7 animate-spin text-lime-300 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="eyebrow mt-4">Verifying participant seat…</p>
        </div>
      </main>
    );
  }
  if (state.kind === "authorized") {
    const snapshot = state.snapshot;
    const match = deserializeMatchState(snapshot.match);
    const selfTeam = match.teams.find((team) => team.id === snapshot.selfPlayerId);
    if (selfTeam === undefined) throw new Error("Participant Team is missing from match state.");
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
              syncing={busy}
              onSaveOrders={(orders) => void sendOrders(orders, false)}
              onLockOrders={(orders) => void sendOrders(orders, true)}
              onResign={() => void resign()}
            />
          </MatchSectionBoundary>
        </>
      );
    }
    if (snapshot.status === "waiting") {
      return (
        <main className="match-flow-page">
          {reconnect}
          <MatchFlowHeader
            roomCode={state.roomCode}
            matchId={matchId}
            team={selfTeam}
            turnNumber={match.turnNumber}
            status={snapshot.status}
          />
          <div className="match-flow-grid">
            <ReadyPanel match={match} lockedPlayerIds={snapshot.lockedPlayerIds} />
            <TeamDataPanel match={match} selfPlayerId={snapshot.selfPlayerId} />
          </div>
          <div className="match-flow-actions">
            <button
              type="button"
              className="match-acknowledge"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} aria-hidden="true" /> Refresh status
            </button>
            <Link href="/">
              <Home size={15} aria-hidden="true" /> Return home safely
            </Link>
            <ResignControl onResign={() => void resign()} disabled={busy} />
          </div>
        </main>
      );
    }
    if (snapshot.status === "turn-ready") {
      const turn = snapshot.unseenTurns[0];
      if (turn === undefined) {
        return (
          <main className="match-flow-page">
            {reconnect}
            <MatchFlowHeader
              roomCode={state.roomCode}
              matchId={matchId}
              team={selfTeam}
              turnNumber={match.turnNumber}
              status={snapshot.status}
            />
            <p className="match-flow-loading" role="status">
              Fetching your Turn movie…
            </p>
          </main>
        );
      }
      return (
        <main className="match-flow-page match-movie-page">
          {reconnect}
          <MatchFlowHeader
            roomCode={state.roomCode}
            matchId={matchId}
            team={selfTeam}
            turnNumber={turn.turnNumber}
            status={snapshot.status}
          />
          <TurnReel
            matchId={matchId}
            currentTurn={turn.turnNumber}
            selectedTurn={rewatch?.turnNumber ?? null}
            onSelect={selectRewatch}
            refreshKey={String(archiveRevision)}
          />
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
          <div className="match-movie-handoff">
            <div>
              <strong>Finished watching Turn {turn.turnNumber}?</strong>
              <p>Acknowledging unlocks your next planner. It does not affect other players.</p>
            </div>
            <button
              type="button"
              className="primary-action match-acknowledge"
              disabled={busy}
              onClick={() => void acknowledge(turn.turnNumber)}
            >
              {busy
                ? "Saving acknowledgement…"
                : `Acknowledge Turn ${turn.turnNumber} and plan next`}
            </button>
          </div>
          <div className="match-flow-grid">
            <TurnExplanation events={turn.events} />
            <TeamDataPanel match={match} selfPlayerId={snapshot.selfPlayerId} />
          </div>
          <div className="match-flow-actions match-movie-secondary-actions">
            <ObservedTurnExport turn={turn} />
            <Link href="/">
              <Home size={15} aria-hidden="true" /> Return home safely
            </Link>
            <ResignControl onResign={() => void resign()} disabled={busy} />
          </div>
        </main>
      );
    }
    return (
      <main className="match-flow-page results-page">
        {reconnect}
        <MatchFlowHeader
          roomCode={state.roomCode}
          matchId={matchId}
          team={selfTeam}
          turnNumber={match.turnNumber}
          status={snapshot.status}
        />
        <FinalCeremony
          teams={match.teams}
          scores={snapshot.ceremonyScores ?? []}
          {...(snapshot.outcome === undefined ? {} : { outcome: snapshot.outcome })}
          {...(snapshot.winningSide === undefined ? {} : { winningSide: snapshot.winningSide })}
        />
        <TurnReel
          matchId={matchId}
          currentTurn={null}
          selectedTurn={rewatch?.turnNumber ?? null}
          onSelect={selectRewatch}
          refreshKey={String(archiveRevision)}
        />
        {rewatch !== null ? (
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
        ) : null}
      </main>
    );
  }
  const roomCode = state.roomCode;
  return (
    <main className="grid min-h-screen place-items-center bg-[#0d100e] px-8 text-white">
      <section className="max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
        <ShieldCheck className="mx-auto size-8 text-emerald-300" aria-hidden="true" />
        <p className="eyebrow mt-5">Canonical match {matchId}</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.04em]">
          {state.outcome === "room-missing"
            ? "Room no longer exists"
            : state.outcome === "seat-forfeited"
              ? "Participant seat unavailable"
              : "Room service unavailable"}
        </h1>
        <p className="mt-4 leading-7 text-white/50">{state.reason}</p>
        {roomCode === null ? (
          <Link href="/" className="primary-action mt-6">
            Return home
          </Link>
        ) : (
          <Link href={`/room/${roomCode}`} className="primary-action mt-6">
            Return to room {roomCode}
          </Link>
        )}
        <button
          type="button"
          className="secondary-action mt-3 w-full"
          onClick={() => {
            resetLocalGameData();
            window.location.assign("/");
          }}
        >
          Reset saved room and planner data
        </button>
      </section>
    </main>
  );
}
