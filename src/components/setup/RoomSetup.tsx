"use client";

import { Check, Clipboard, LoaderCircle, LockKeyhole, Play, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PROTOCOL_VERSION, type PublicRoom, type ServerMessage } from "../../lib/net/protocol";
import {
  rememberMatch,
  rememberRoom,
  requestId,
  roomToken,
  RoomSocket,
} from "../../lib/net/client";
import { configForLength, PLAYER_COLORS, type PlayerColor } from "../../lib/setup/validate";
import { TeamRow } from "./TeamRow";

export function RoomSetup({ code }: { readonly code: string }) {
  const router = useRouter();
  const socketRef = useRef<RoomSocket | undefined>(undefined);
  const [room, setRoom] = useState<PublicRoom>();
  const [selfPlayerId, setSelfPlayerId] = useState<string>();
  const [token, setToken] = useState<string>();
  const [needsJoin, setNeedsJoin] = useState(false);
  const [name, setName] = useState("Azure Unit");
  const [color, setColor] = useState<PlayerColor>("blue");
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<PlayerColor>("red");
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const handleMessage = useCallback((message: ServerMessage) => {
    if (message.kind === "ProtocolError") {
      setError(message.message);
      return;
    }
    setRoom(message.room);
    setSelfPlayerId(message.selfPlayerId);
    if (message.participantToken !== undefined) {
      rememberRoom(message.room.code, message.participantToken);
      setToken(message.participantToken);
      setNeedsJoin(false);
    }
  }, []);

  useEffect(() => {
    const socket = new RoomSocket();
    socketRef.current = socket;
    const unsubscribe = socket.subscribe(handleMessage);
    const storedToken = roomToken(code);
    if (storedToken === null) setNeedsJoin(true);
    else {
      setToken(storedToken);
      void socket
        .send({
          version: PROTOCOL_VERSION,
          requestId: requestId(),
          kind: "ResumeRoom",
          code,
          token: storedToken,
        })
        .catch((caught) =>
          setError(caught instanceof Error ? caught.message : "Connection failed."),
        );
    }
    return () => {
      unsubscribe();
      socket.close();
    };
  }, [code, handleMessage]);

  useEffect(() => {
    if (room?.phase !== "active" || room.matchId === undefined) return;
    rememberMatch(room.matchId, room.code);
    router.push(`/match/${room.matchId}/edit`);
  }, [room, router]);

  const selfPlayer = room?.players.find((player) => player.id === selfPlayerId);
  useEffect(() => {
    if (selfPlayer === undefined) return;
    setEditName(selfPlayer.name);
    setEditColor(selfPlayer.color);
  }, [selfPlayer?.color, selfPlayer?.id, selfPlayer?.name]);

  const send = (message: Parameters<RoomSocket["send"]>[0]) => {
    setError(undefined);
    void socketRef.current
      ?.send(message)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Connection failed."));
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    send({
      version: PROTOCOL_VERSION,
      requestId: requestId(),
      kind: "JoinRoom",
      code,
      name,
      color,
    });
  };

  if (needsJoin) {
    return (
      <main className="min-h-screen bg-[#0d100e] text-white">
        <div className="ambient-grid" aria-hidden="true" />
        <div className="relative mx-auto max-w-lg px-8 py-24">
          <p className="eyebrow mb-4">Join room {code}</p>
          <h1 className="text-4xl font-black tracking-[-0.05em]">Claim your team seat</h1>
          <form
            className="mt-8 space-y-5 rounded-3xl border border-white/10 bg-white/[0.04] p-6"
            onSubmit={join}
          >
            <label className="setup-label">
              Team name
              <input
                className="setup-input"
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
              <p role="alert" className="text-sm text-red-200">
                {error}
              </p>
            )}
            <button className="primary-action w-full" type="submit">
              Join room
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (room === undefined || selfPlayerId === undefined || token === undefined) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0d100e] text-white">
        <div className="text-center">
          <LoaderCircle
            className="mx-auto size-7 animate-spin text-lime-300 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="eyebrow mt-4">Rejoining room {code}…</p>
          {error === undefined ? null : (
            <p className="mt-4 text-sm text-red-200" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  }

  const self = room.players.find((player) => player.id === selfPlayerId)!;
  const isHost = self.isHost;
  const allReady = room.players.length >= 2 && room.players.every((player) => player.ready);
  const inviteUrl =
    typeof window === "undefined" ? `/room/${code}` : `${window.location.origin}/room/${code}`;

  return (
    <main className="min-h-screen bg-[#0d100e] text-white">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1080px] px-8 py-10">
        <header className="flex items-end justify-between border-b border-white/8 pb-6">
          <div>
            <p className="eyebrow mb-3">Private room</p>
            <div className="flex items-center gap-4">
              <h1 className="font-mono text-4xl font-black tracking-[0.16em]">{code}</h1>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-xs font-bold text-emerald-200">
                Setup live
              </span>
            </div>
          </div>
          <button
            type="button"
            className="secondary-link"
            onClick={() => {
              void navigator.clipboard.writeText(inviteUrl);
              setCopied(true);
            }}
          >
            <Clipboard className="size-4" aria-hidden="true" />
            {copied ? "Copied" : "Copy invite"}
          </button>
        </header>
        <div className="mt-7 grid grid-cols-[1fr_360px] gap-6">
          <section className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="eyebrow">Teams</p>
                <h2 className="mt-2 text-2xl font-bold">
                  {room.players.length} / 4 connected seats
                </h2>
              </div>
              <Users className="size-5 text-emerald-300" aria-hidden="true" />
            </div>
            <ul className="space-y-3">
              {room.players.map((player) => (
                <TeamRow key={player.id} player={player} isSelf={player.id === selfPlayerId} />
              ))}
            </ul>
            <div className="mt-6 rounded-2xl border border-dashed border-white/10 p-4 text-center text-sm text-white/35">
              Share <span className="font-mono text-white/60">{code}</span> with up to{" "}
              {4 - room.players.length} more players.
            </div>
          </section>
          <aside className="space-y-5">
            <section className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
              <p className="eyebrow mb-5">Your team</p>
              <label className="setup-label">
                Team name
                <input
                  className="setup-input"
                  value={editName}
                  maxLength={24}
                  disabled={self.ready}
                  onChange={(event) => setEditName(event.currentTarget.value)}
                />
              </label>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {PLAYER_COLORS.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className="color-choice"
                    data-active={editColor === choice ? "true" : "false"}
                    disabled={self.ready}
                    onClick={() => setEditColor(choice)}
                    aria-label={`Change to ${choice} team`}
                    aria-pressed={editColor === choice}
                  >
                    <span className={`team-swatch team-swatch-${choice}`} />
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="secondary-action mt-4 w-full"
                disabled={self.ready || (editName === self.name && editColor === self.color)}
                onClick={() =>
                  send({
                    version: PROTOCOL_VERSION,
                    requestId: requestId(),
                    kind: "UpdatePlayer",
                    code,
                    token,
                    name: editName,
                    color: editColor,
                  })
                }
              >
                Save team
              </button>
            </section>
            <section className="rounded-3xl border border-white/8 bg-white/[0.035] p-6">
              <p className="eyebrow mb-5">Match setup</p>
              <label className="setup-label">
                Game length
                <select
                  className="setup-input"
                  value={room.config.gameLength}
                  disabled={!isHost}
                  onChange={(event) =>
                    send({
                      version: PROTOCOL_VERSION,
                      requestId: requestId(),
                      kind: "UpdateConfig",
                      code,
                      token,
                      config: configForLength(event.currentTarget.value as "melee" | "battle"),
                    })
                  }
                >
                  <option value="melee">Melee · Rubble Two</option>
                  <option value="battle">Battle · Rubble Three</option>
                </select>
              </label>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div className="setup-stat">
                  <span>Arena</span>
                  <strong>
                    {room.config.arenaName === "rubble-two" ? "Rubble Two" : "Rubble Three"}
                  </strong>
                </div>
                <div className="setup-stat">
                  <span>Formation</span>
                  <strong>Beginner</strong>
                </div>
                <div className="setup-stat">
                  <span>Sport</span>
                  <strong>Survival</strong>
                </div>
                <div className="setup-stat">
                  <span>Turn</span>
                  <strong>{room.config.turnLengthSeconds}s</strong>
                </div>
              </div>
              {isHost ? null : (
                <p className="mt-4 flex gap-2 text-xs leading-5 text-white/35">
                  <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  The host controls match settings.
                </p>
              )}
            </section>
            {error === undefined ? null : (
              <p
                className="rounded-xl border border-red-300/20 bg-red-300/8 p-3 text-sm text-red-200"
                role="alert"
              >
                {error}
              </p>
            )}
            <button
              type="button"
              className={self.ready ? "secondary-action w-full" : "primary-action w-full"}
              onClick={() =>
                send({
                  version: PROTOCOL_VERSION,
                  requestId: requestId(),
                  kind: "SetReady",
                  code,
                  token,
                  ready: !self.ready,
                })
              }
            >
              {self.ready ? (
                <>
                  <Check className="size-4" aria-hidden="true" />
                  Ready — click to edit
                </>
              ) : (
                "Ready up"
              )}
            </button>
            {isHost ? (
              <button
                type="button"
                className="primary-action w-full"
                disabled={!allReady}
                onClick={() =>
                  send({
                    version: PROTOCOL_VERSION,
                    requestId: requestId(),
                    kind: "StartMatch",
                    code,
                    token,
                  })
                }
              >
                <Play className="size-4 fill-current" aria-hidden="true" />
                Start match
              </button>
            ) : (
              <p className="text-center text-xs text-white/35">
                The host starts when every team is ready.
              </p>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
