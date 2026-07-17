"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MatchState } from "../../engine/types";
import { PROTOCOL_VERSION } from "../../lib/net/protocol";
import { deserializeMatchState } from "../../lib/net/protocol";
import {
  forgetRoom,
  requestId,
  requestOnce,
  roomForMatch,
  roomToken,
  RoomRequestError,
} from "../../lib/net/client";
import { PlannerExperience } from "../planner/PlannerExperience";

type GateState =
  | { readonly kind: "checking" }
  | {
      readonly kind: "authorized";
      readonly roomCode: string;
      readonly selfPlayerId: string;
      readonly match: MatchState;
    }
  | { readonly kind: "denied"; readonly roomCode: string | null; readonly reason: string };

export function MatchGate({ matchId }: { readonly matchId: string }) {
  const [state, setState] = useState<GateState>({ kind: "checking" });
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
    void requestOnce({
      version: PROTOCOL_VERSION,
      requestId: requestId(),
      kind: "GetMatchState",
      code: roomCode,
      token,
    })
      .then((response) => {
        if (disposed) return;
        if (response.matchId === matchId) {
          setState({
            kind: "authorized",
            roomCode,
            selfPlayerId: response.selfPlayerId,
            match: deserializeMatchState(response.match),
          });
          return;
        }
        setState({
          kind: "denied",
          roomCode,
          reason: "That room does not own this match.",
        });
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
  }, [matchId]);
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
    return (
      <PlannerExperience
        matchId={matchId}
        roomCode={state.roomCode}
        selfPlayerId={state.selfPlayerId}
        match={state.match}
      />
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
