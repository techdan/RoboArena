"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { roomForMatch, roomToken } from "../../lib/net/client";

export function MatchGate({ matchId }: { readonly matchId: string }) {
  const [roomCode, setRoomCode] = useState<string | null | undefined>();
  useEffect(() => setRoomCode(roomForMatch(matchId)), [matchId]);
  if (roomCode === undefined) return null;
  const authorized = roomCode !== null && roomToken(roomCode) !== null;
  return (
    <main className="grid min-h-screen place-items-center bg-[#0d100e] px-8 text-white">
      <section className="max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
        <ShieldCheck className="mx-auto size-8 text-emerald-300" aria-hidden="true" />
        <p className="eyebrow mt-5">Canonical match {matchId}</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.04em]">
          {authorized ? "Your seat is secured" : "Participant token required"}
        </h1>
        <p className="mt-4 leading-7 text-white/50">
          {authorized
            ? "The authoritative match exists and setup is frozen. Phase 9 adds the private programming board here."
            : "Open this match through the room that issued your participant seat."}
        </p>
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
