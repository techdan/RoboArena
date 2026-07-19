"use client";

import { ArrowRight, Film, Gamepad2, RadioTower, Users } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { Arena } from "../../engine/types";
import { PROTOCOL_VERSION, type RoomSnapshotMessage } from "../../lib/net/protocol";
import {
  forgetRoom,
  recentRooms,
  rememberRoom,
  requestId,
  requestOnce,
  roomToken,
  RoomRequestError,
} from "../../lib/net/client";
import { PLAYER_COLORS, type PlayerColor } from "../../lib/setup/validate";

const PixiArena = dynamic(
  () => import("../../renderer/PixiArena").then((module) => module.PixiArena),
  { ssr: false },
);

interface RememberedRoom {
  readonly code: string;
  readonly status: string;
}

interface HomeSetupProps {
  readonly arena: Arena;
}

const roomStatus = (snapshot: RoomSnapshotMessage): string => {
  const { room, matchStatus } = snapshot;
  if (matchStatus?.status === "planning") return `Your turn · Turn ${matchStatus.turnNumber}`;
  if (matchStatus?.status === "waiting") {
    return matchStatus.waitingForPlayers === 1
      ? "Waiting for 1 player"
      : `Waiting for ${matchStatus.waitingForPlayers} players`;
  }
  if (matchStatus?.status === "turn-ready") return "Turn ready to watch";
  if (matchStatus?.status === "finished") return "Finished";
  if (room.phase === "active") return "Match started";
  const ready = room.players.filter((player) => player.ready).length;
  if (room.players.length < 2) return "Waiting for players";
  if (ready === room.players.length) return "Ready to start";
  return `${ready}/${room.players.length} ready`;
};

export function HomeSetup({ arena }: HomeSetupProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("Ember Unit");
  const [color, setColor] = useState<PlayerColor>("red");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [remembered, setRemembered] = useState<readonly RememberedRoom[]>([]);

  useEffect(() => {
    let disposed = false;
    const rooms = recentRooms();
    setRemembered(rooms.map((roomCode) => ({ code: roomCode, status: "Checking…" })));
    void Promise.all(
      rooms.map(async (roomCode): Promise<RememberedRoom> => {
        const token = roomToken(roomCode);
        if (token === null) return { code: roomCode, status: "Rejoin required" };
        try {
          const response = await requestOnce({
            version: PROTOCOL_VERSION,
            requestId: requestId(),
            kind: "ResumeRoom",
            code: roomCode,
            token,
          });
          return { code: roomCode, status: roomStatus(response) };
        } catch (caught) {
          if (caught instanceof RoomRequestError && caught.code === "UNAUTHORIZED") {
            forgetRoom(roomCode);
            return { code: roomCode, status: "Rejoin required" };
          }
          return { code: roomCode, status: "Unavailable" };
        }
      }),
    ).then((statuses) => {
      if (!disposed) setRemembered(statuses);
    });
    return () => {
      disposed = true;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await requestOnce(
        mode === "create"
          ? { version: PROTOCOL_VERSION, requestId: requestId(), kind: "CreateRoom", name, color }
          : {
              version: PROTOCOL_VERSION,
              requestId: requestId(),
              kind: "JoinRoom",
              code: code.toUpperCase(),
              name,
              color,
            },
      );
      if (response.participantToken === undefined)
        throw new Error("The room service did not issue a rejoin token.");
      rememberRoom(response.room.code, response.participantToken);
      router.push(`/room/${response.room.code}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that room.");
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0d100e] text-white">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1180px] px-8 py-10">
        <header className="flex items-center justify-between border-b border-white/8 pb-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl border border-lime-300/20 bg-lime-300/10">
              <Gamepad2 className="size-5 text-lime-300" aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">RoboArena</p>
              <p className="mt-1 text-sm text-white/45">Private simultaneous robot tactics</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Link className="secondary-link" href="/preview">
              Terrain lab
            </Link>
            <Link className="secondary-link" href="/movie/demo">
              <Film className="size-4" aria-hidden="true" />
              Replay demo
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-[1.05fr_0.95fr] gap-14 py-14">
          <section className="pt-8">
            <p className="eyebrow mb-5">Online free-for-all / 2–4 players</p>
            <h1 className="max-w-xl text-6xl font-black leading-[0.92] tracking-[-0.07em]">
              Program privately.<span className="block text-white/30">Watch together.</span>
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-8 text-white/55">
              Create a private room, invite up to three friends, and command one unique team each.
              No account required.
            </p>
            <div className="mt-9 flex gap-7 text-sm text-white/45">
              <span className="flex items-center gap-2">
                <RadioTower className="size-4 text-emerald-300" aria-hidden="true" />
                Live room state
              </span>
              <span className="flex items-center gap-2">
                <Users className="size-4 text-emerald-300" aria-hidden="true" />
                Separate devices
              </span>
            </div>

            <figure className="mt-9 w-fit max-w-full">
              <div className="mb-3 flex items-center justify-between gap-4">
                <figcaption className="eyebrow">Battlefield · {arena.sizeName}</figcaption>
                <Link className="secondary-link" href="/preview">
                  Terrain lab
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
              <div className="max-w-full overflow-auto rounded-[20px]">
                <PixiArena arena={arena} />
              </div>
            </figure>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-white/[0.045] p-6 shadow-[0_30px_90px_rgba(0,0,0,.35)]">
            <div className="mb-6 grid grid-cols-2 rounded-xl bg-black/25 p-1">
              {(["create", "join"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="mode-button"
                  data-active={mode === option ? "true" : "false"}
                  onClick={() => setMode(option)}
                >
                  {option === "create" ? "Create room" : "Join room"}
                </button>
              ))}
            </div>
            <form className="space-y-5" onSubmit={(event) => void submit(event)}>
              {mode === "join" ? (
                <label className="setup-label">
                  Room code
                  <input
                    className="setup-input font-mono uppercase tracking-[0.2em]"
                    name="room-code"
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    maxLength={6}
                    onChange={(event) => setCode(event.currentTarget.value.toUpperCase())}
                    placeholder="ABC123…"
                    required
                  />
                </label>
              ) : null}
              <label className="setup-label">
                Team name
                <input
                  className="setup-input"
                  name="team-name"
                  autoComplete="off"
                  spellCheck={false}
                  value={name}
                  maxLength={24}
                  onChange={(event) => setName(event.currentTarget.value)}
                  required
                />
              </label>
              <fieldset>
                <legend className="setup-label">Team color</legend>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {PLAYER_COLORS.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className="color-choice"
                      data-active={color === choice ? "true" : "false"}
                      onClick={() => setColor(choice)}
                      aria-label={`${choice} team`}
                      aria-pressed={color === choice}
                    >
                      <span className={`team-swatch team-swatch-${choice}`} />
                    </button>
                  ))}
                </div>
              </fieldset>
              {error === undefined ? null : (
                <p
                  className="rounded-xl border border-red-300/20 bg-red-300/8 px-4 py-3 text-sm text-red-200"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <button className="primary-action w-full" type="submit" disabled={busy}>
                {busy ? "Connecting…" : mode === "create" ? "Create private room" : "Join room"}
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </form>
            {remembered.length > 0 ? (
              <div className="mt-6 border-t border-white/8 pt-5">
                <p className="eyebrow mb-3">Recent rooms</p>
                <div className="flex flex-wrap gap-2" aria-live="polite">
                  {remembered.map((room) => (
                    <Link key={room.code} href={`/room/${room.code}`} className="recent-room">
                      <strong>{room.code}</strong>
                      <span>{room.status}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
