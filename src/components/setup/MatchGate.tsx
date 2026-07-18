"use client";

import { LoaderCircle, RefreshCw, ShieldCheck, Trophy } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TurnOrders } from "../../engine/types";
import {
  deserializeMatchState,
  PROTOCOL_VERSION,
  type MatchSnapshotMessage,
} from "../../lib/net/protocol";
import {
  forgetRoom,
  requestId,
  requestOnce,
  roomForMatch,
  roomToken,
  RoomRequestError,
} from "../../lib/net/client";
import { PlannerExperience } from "../planner/PlannerExperience";
import { MovieExperience } from "../MovieExperience";
import { ConnectionOverlay } from "../match/ConnectionOverlay";
import { ReadyPanel } from "../match/ReadyPanel";
import { RoomStatus } from "../match/RoomStatus";
import { TeamDataPanel } from "../match/TeamDataPanel";
import { TurnExplanation } from "../match/TurnExplanation";
import { ObservedTurnExport } from "../replay/ObservedTurnExport";
import { FieldGuideButton } from "../help/HelpProvider";
import { ResignControl } from "../match/ResignControl";

type GateState =
  | { readonly kind: "checking" }
  | {
      readonly kind: "authorized";
      readonly roomCode: string;
      readonly snapshot: MatchSnapshotMessage;
    }
  | { readonly kind: "denied"; readonly roomCode: string | null; readonly reason: string };

export function MatchGate({ matchId }: { readonly matchId: string }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
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
    setConnectionError(null);
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
          reason:
            caught instanceof RoomRequestError && caught.code === "UNAUTHORIZED"
              ? "Your saved participant seat is no longer valid. Rejoin the room to continue."
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
      void refresh().catch(() => {
        setConnectionError("Your seat is safe. Reconnect to fetch the latest durable turn state.");
      });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [refresh, state]);

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
          setConnectionError("Playback is local, but its resume position could not be saved."),
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
      setConnectionError(null);
    } catch (caught) {
      setConnectionError(caught instanceof Error ? caught.message : "Orders could not be saved.");
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
      setConnectionError(null);
    } catch (caught) {
      setConnectionError(
        caught instanceof Error ? caught.message : "Turn could not be acknowledged.",
      );
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
      setConnectionError(null);
    } catch (caught) {
      setConnectionError(
        caught instanceof Error ? caught.message : "Resignation could not be sent.",
      );
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
    const reconnect =
      connectionError === null ? null : (
        <ConnectionOverlay
          message={connectionError}
          busy={busy}
          onRetry={() => {
            setBusy(true);
            void refresh()
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
        />
      );
    if (snapshot.status === "planning") {
      return (
        <>
          {reconnect}
          <PlannerExperience
            matchId={matchId}
            roomCode={state.roomCode}
            selfPlayerId={snapshot.selfPlayerId}
            match={match}
            serverOrders={snapshot.ownOrders}
            serverRevision={snapshot.revision}
            syncing={busy}
            onSaveOrders={(orders) => void sendOrders(orders, false)}
            onLockOrders={(orders) => void sendOrders(orders, true)}
            onResign={() => void resign()}
          />
        </>
      );
    }
    if (snapshot.status === "waiting") {
      return (
        <main className="match-flow-page">
          {reconnect}
          <RoomStatus status={snapshot.status} />
          <div className="match-guide-action">
            <FieldGuideButton />
          </div>
          <div className="match-flow-grid">
            <ReadyPanel match={match} lockedPlayerIds={snapshot.lockedPlayerIds} />
            <TeamDataPanel match={match} selfPlayerId={snapshot.selfPlayerId} />
          </div>
          <div className="match-flow-actions">
            <button type="button" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw size={15} aria-hidden="true" /> Refresh status
            </button>
            <Link href={`/room/${state.roomCode}`}>Leave safely</Link>
            <ResignControl onResign={() => void resign()} disabled={busy} />
          </div>
        </main>
      );
    }
    if (snapshot.status === "turn-ready") {
      const turn = snapshot.unseenTurns[0];
      if (turn === undefined) {
        return <main className="match-flow-page">Fetching authorized turn movie…</main>;
      }
      return (
        <main className="match-flow-page match-movie-page">
          {reconnect}
          <RoomStatus status={snapshot.status} />
          <div className="match-guide-action">
            <FieldGuideButton />
          </div>
          <MovieExperience
            key={turn.turnNumber}
            initialState={deserializeMatchState(turn.initialState)}
            events={turn.events}
            initialTick={turn.playbackTick}
            onTickChange={(tick) => savePlaybackPosition(turn.turnNumber, tick)}
          />
          <div className="match-flow-grid">
            <TurnExplanation events={turn.events} />
            <TeamDataPanel match={match} selfPlayerId={snapshot.selfPlayerId} />
          </div>
          <ObservedTurnExport turn={turn} />
          <div className="match-flow-actions">
            <button
              type="button"
              className="primary-action match-acknowledge"
              disabled={busy}
              onClick={() => void acknowledge(turn.turnNumber)}
            >
              {busy ? "Saving playback…" : `Acknowledge Turn ${turn.turnNumber} and plan next`}
            </button>
            <ResignControl onResign={() => void resign()} disabled={busy} />
          </div>
        </main>
      );
    }
    const scoreByTeam = new Map(
      (snapshot.ceremonyScores ?? []).map((entry) => [entry.teamId, entry.score]),
    );
    return (
      <main className="match-flow-page results-page">
        {reconnect}
        <RoomStatus status={snapshot.status} />
        <section className="final-ceremony">
          <Trophy size={34} aria-hidden="true" />
          <p className="eyebrow">Final Ceremony</p>
          <h1>
            {snapshot.outcome === "draw" ? "Draw" : `Side ${snapshot.winningSide ?? "—"} survives`}
          </h1>
          <ol>
            {match.teams.map((team) => (
              <li key={team.id}>
                <span>{team.name}</span>
                <strong>{scoreByTeam.get(team.id) ?? 0}</strong>
              </li>
            ))}
          </ol>
          <p className="match-privacy-note">
            The server retained and verified the canonical Phase 5 replay. Private opponent orders
            are not included in participant downloads.
          </p>
          <div className="match-flow-actions">
            <Link href={`/room/${state.roomCode}`}>Return to room</Link>
          </div>
        </section>
      </main>
    );
  }
  const roomCode = state.roomCode;
  return (
    <main className="grid min-h-screen place-items-center bg-[#0d100e] px-8 text-white">
      <section className="max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
        <ShieldCheck className="mx-auto size-8 text-emerald-300" aria-hidden="true" />
        <p className="eyebrow mt-5">Canonical match {matchId}</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.04em]">Participant token required</h1>
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
      </section>
    </main>
  );
}
