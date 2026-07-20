"use client";

import { Check, Clipboard, LoaderCircle, LockKeyhole, Play, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PROTOCOL_VERSION, type PublicRoom, type ServerMessage } from "../../lib/net/protocol";
import {
  forgetRoom,
  rememberMatch,
  rememberRoom,
  requestId,
  roomToken,
  RoomSocket,
} from "../../lib/net/client";
import {
  configForLength,
  HOME_CORNER_LABELS,
  HOME_SLOTS,
  PLAYER_COLORS,
  type PlayerColor,
} from "../../lib/setup/validate";
import { TeamRow } from "./TeamRow";

export function RoomSetup({ code }: { readonly code: string }) {
  const router = useRouter();
  const socketRef = useRef<RoomSocket | undefined>(undefined);
  const tokenRef = useRef<string | undefined>(undefined);
  const [room, setRoom] = useState<PublicRoom>();
  const [selfPlayerId, setSelfPlayerId] = useState<string>();
  const [token, setToken] = useState<string>();
  const [needsJoin, setNeedsJoin] = useState(false);
  const [name, setName] = useState("Azure Unit");
  const [color, setColor] = useState<PlayerColor>("blue");
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<PlayerColor>("red");
  const [error, setError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [connected, setConnected] = useState(false);

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      if (message.kind === "ProtocolError") {
        if (message.code === "UNAUTHORIZED") {
          forgetRoom(code);
          tokenRef.current = undefined;
          setToken(undefined);
          setRoom(undefined);
          setSelfPlayerId(undefined);
          setNeedsJoin(true);
          setError("That saved seat is no longer valid. Join the room again to claim a seat.");
          return;
        }
        setError(message.message);
        return;
      }
      if (message.kind !== "RoomSnapshot") return;
      setRoom(message.room);
      setSelfPlayerId(message.selfPlayerId);
      setError(undefined);
      if (message.participantToken !== undefined) {
        rememberRoom(message.room.code, message.participantToken);
        tokenRef.current = message.participantToken;
        setToken(message.participantToken);
        setNeedsJoin(false);
      }
    },
    [code],
  );

  useEffect(() => {
    const socket = new RoomSocket();
    socketRef.current = socket;
    const unsubscribe = socket.subscribe(handleMessage);
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectDelay = 500;
    const storedToken = roomToken(code);
    tokenRef.current = storedToken ?? undefined;
    if (storedToken === null) setNeedsJoin(true);
    else setToken(storedToken);

    const connect = () => {
      void socket.connect().catch((caught: unknown) => {
        if (disposed) return;
        setConnected(false);
        setError(caught instanceof Error ? caught.message : "Connection failed.");
        scheduleReconnect();
      });
    };
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== undefined) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 5_000);
    };
    const unsubscribeConnection = socket.subscribeConnection((isConnected) => {
      setConnected(isConnected);
      if (!isConnected) {
        if (!disposed) setError("Connection lost. Reconnecting…");
        scheduleReconnect();
        return;
      }
      reconnectDelay = 500;
      const activeToken = tokenRef.current;
      if (activeToken === undefined) return;
      void socket
        .send({
          version: PROTOCOL_VERSION,
          requestId: requestId(),
          kind: "ResumeRoom",
          code,
          token: activeToken,
        })
        .catch((caught) =>
          setError(caught instanceof Error ? caught.message : "Connection failed."),
        );
    });
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      unsubscribe();
      unsubscribeConnection();
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

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  const copyInvite = async (url: string) => {
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(url);
      } else {
        // Clipboard API is unavailable outside a secure context (e.g. a plain
        // http:// LAN address during device testing). Fall back to the
        // legacy select-and-copy technique so the invite link still copies.
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

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
        <header className="flex items-end border-b border-white/8 pb-6">
          <div>
            <p className="eyebrow mb-3">Private room</p>
            <div className="flex items-center gap-4">
              <h1 className="font-mono text-4xl font-black tracking-[0.16em]">{code}</h1>
              <button
                type="button"
                className="secondary-link"
                onClick={() => void copyInvite(inviteUrl)}
              >
                <Clipboard className="size-4" aria-hidden="true" />
                {copyStatus === "copied"
                  ? "Copied"
                  : copyStatus === "failed"
                    ? "Couldn't copy"
                    : "Copy invite"}
              </button>
              <span
                className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1 text-xs font-bold text-emerald-200"
                role="status"
              >
                {connected ? "Setup live" : "Reconnecting…"}
              </span>
            </div>
          </div>
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
                  name="team-name"
                  autoComplete="off"
                  spellCheck={false}
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
              <fieldset className="mt-5" disabled={self.ready}>
                <legend className="setup-label">Home corner</legend>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {HOME_SLOTS.map((slot) => {
                    const occupant = room.players.find(
                      (player) => player.id !== selfPlayerId && player.homeSlot === slot,
                    );
                    const active = self.homeSlot === slot;
                    // A held corner stays clickable: the server swaps the two seats.
                    const label = occupant
                      ? `Home corner ${HOME_CORNER_LABELS[slot]} (swap with ${occupant.name})`
                      : `Home corner ${HOME_CORNER_LABELS[slot]}`;
                    return (
                      <button
                        key={slot}
                        type="button"
                        className={`cursor-pointer rounded-xl border px-2 py-2 text-xs font-bold uppercase tracking-[0.1em] transition disabled:cursor-not-allowed disabled:opacity-30 ${
                          active
                            ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-100"
                            : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25"
                        }`}
                        data-active={active ? "true" : "false"}
                        disabled={self.ready}
                        aria-pressed={active}
                        aria-label={label}
                        title={label}
                        onClick={() =>
                          send({
                            version: PROTOCOL_VERSION,
                            requestId: requestId(),
                            kind: "SetHomeSlot",
                            code,
                            token,
                            homeSlot: slot,
                          })
                        }
                      >
                        {HOME_CORNER_LABELS[slot]}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
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
