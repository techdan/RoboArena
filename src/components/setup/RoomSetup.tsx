"use client";

import { Check, Clipboard, Home, Link2, LockKeyhole, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PROTOCOL_VERSION, type PublicRoom, type ServerMessage } from "../../lib/net/protocol";
import {
  forgetRoom,
  rememberMatch,
  rememberRoom,
  requestId,
  roomToken,
  RoomSocket,
} from "../../lib/net/client";
import { ROBOTS_PER_TEAM_BY_LENGTH } from "../../engine/constants";
import type { Arena } from "../../engine/types";
import { ARENA_CATALOG, ARENA_TOWNS, arenaCatalogEntry, loadArena } from "../../lib/arenas";
import { terrainCounts, type Corner } from "../../lib/presentation/arenaSchematic";
import {
  arenaThemeSchema,
  configForLength,
  DEFAULT_ARENA_FOR_LENGTH,
  DEFAULT_ARENA_THEME_ID,
  roomConfigSchema,
  HOME_CORNER_LABELS,
  HOME_SLOTS,
  type PlayerColor,
  type RoomConfig,
} from "../../lib/setup/validate";
import { ARENA_THEME_ORDER, ARENA_THEMES } from "../../renderer3d/themes";
import { ArenaSchematic, type SchematicHome } from "../site/ArenaSchematic";
import { ResetLocalData } from "../site/ResetLocalData";
import { RoomCode } from "../site/RoomCode";
import { SiteHeader } from "../site/SiteHeader";
import { TeamColorPicker } from "../site/TeamColorPicker";
import { OpenSeat, TeamRow } from "./TeamRow";
import { BootCampLink, BootCampPrompt } from "../help/BootCampPrompt";
import { FieldGuideButton } from "../help/HelpProvider";

const FORMATION_ORDER: readonly RoomConfig["formation"][] = ["beginner", "standard"];
const GAME_LENGTHS = ["melee", "battle"] as const;
const SEAT_COUNT = 4;
const SLOW_REJOIN_MS = 6000;

/** Lobby names and one-line rules summaries for the Quick Start formations. */
const FORMATION_LABELS: Readonly<
  Record<RoomConfig["formation"], { readonly name: string; readonly tagline: string }>
> = {
  beginner: { name: "Beginner", tagline: "All enemies visible, missiles only." },
  standard: {
    name: "Standard",
    tagline: "Hidden enemies, grenades, Zap and one Time Bomb per team.",
  },
};

const LENGTH_LABELS: Readonly<Record<(typeof GAME_LENGTHS)[number], string>> = {
  melee: "Melee",
  battle: "Battle",
};

const CONNECTION_LABELS = {
  connecting: { text: "Connecting", tone: "muted" },
  connected: { text: "Live", tone: "live" },
  resumed: { text: "Reconnected", tone: "live" },
  retrying: { text: "Reconnecting", tone: "rail" },
  "incompatible-protocol": { text: "Update needed", tone: "danger" },
} as const;

const hexColor = (value: number): string => `#${value.toString(16).padStart(6, "0")}`;

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
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<PlayerColor>("red");
  const [error, setError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [slowRejoin, setSlowRejoin] = useState(false);
  const [arena, setArena] = useState<Arena>();
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "retrying" | "resumed" | "incompatible-protocol"
  >("connecting");

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
    const socket = new RoomSocket({ code });
    socketRef.current = socket;
    const unsubscribe = socket.subscribe(handleMessage);
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectDelay = 500;
    let incompatibleProtocol = false;
    let connectedBefore = false;
    const storedToken = roomToken(code);
    tokenRef.current = storedToken ?? undefined;
    if (storedToken === null) setNeedsJoin(true);
    else setToken(storedToken);

    const connect = () => {
      void socket.connect().catch((caught: unknown) => {
        if (disposed) return;
        setConnectionStatus("retrying");
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
      if (!isConnected) {
        if (incompatibleProtocol) return;
        setConnectionStatus("retrying");
        if (!disposed) setError("Connection lost. Reconnecting…");
        scheduleReconnect();
        return;
      }
      setConnectionStatus(connectedBefore ? "resumed" : "connected");
      connectedBefore = true;
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
    const unsubscribeProtocolError = socket.subscribeProtocolError((caught) => {
      incompatibleProtocol = true;
      setConnectionStatus("incompatible-protocol");
      setError(caught.message);
    });
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      unsubscribe();
      unsubscribeConnection();
      unsubscribeProtocolError();
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
    if (selfPlayer === undefined || editing) return;
    setEditName(selfPlayer.name);
    setEditColor(selfPlayer.color);
  }, [editing, selfPlayer?.color, selfPlayer?.id, selfPlayer?.name]);

  // Readying up locks the seat; close an open editor rather than strand it.
  useEffect(() => {
    if (selfPlayer?.ready === true) setEditing(false);
  }, [selfPlayer?.ready]);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = setTimeout(() => setCopyStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  const waitingForRoom = room === undefined || selfPlayerId === undefined || token === undefined;
  useEffect(() => {
    if (!waitingForRoom || needsJoin) {
      setSlowRejoin(false);
      return;
    }
    const timer = setTimeout(() => setSlowRejoin(true), SLOW_REJOIN_MS);
    return () => clearTimeout(timer);
  }, [needsJoin, waitingForRoom]);

  const arenaName = room?.config.arenaName;
  useEffect(() => {
    if (arenaName === undefined) return;
    let cancelled = false;
    void loadArena(arenaName).then((loaded) => {
      if (!cancelled) setArena(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [arenaName]);

  const players = room?.players;
  const schematicHomes = useMemo(() => {
    const homes: Partial<Record<Corner, SchematicHome>> = {};
    for (const slot of HOME_SLOTS) {
      const corner = HOME_CORNER_LABELS[slot] as Corner;
      const occupant = players?.find((player) => player.homeSlot === slot);
      homes[corner] =
        occupant === undefined
          ? {}
          : {
              color: occupant.color,
              label: occupant.name,
              self: occupant.id === selfPlayerId,
            };
    }
    return homes;
  }, [players, selfPlayerId]);

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(text);
      } else {
        // Clipboard API is unavailable outside a secure context (e.g. a plain
        // http:// LAN address during device testing). Fall back to the
        // legacy select-and-copy technique so the invite link still copies.
        const textarea = document.createElement("textarea");
        textarea.value = text;
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
      <main className="site-page site-center-page">
        <div className="site-hero" data-blur="true" aria-hidden="true">
          <div className="site-hero-image" />
        </div>
        <SiteHeader>
          <BootCampLink returnTo={`/room/${code}`} />
          <FieldGuideButton />
        </SiteHeader>
        <div className="site-center">
          <section className="site-panel site-claim" aria-labelledby="claim-title">
            <p className="site-label" data-tone="rail">
              You’re invited
            </p>
            <RoomCode code={code} />
            <h1 id="claim-title" className="site-display site-claim-title">
              Claim your seat
            </h1>
            <form className="site-claim-form" onSubmit={join}>
              <div className="site-field">
                <label className="site-label" htmlFor="claim-team-name">
                  Team name
                </label>
                <input
                  id="claim-team-name"
                  className="site-input"
                  name="team-name"
                  autoComplete="off"
                  spellCheck={false}
                  value={name}
                  maxLength={24}
                  onChange={(event) => setName(event.currentTarget.value)}
                  required
                />
              </div>
              <TeamColorPicker value={color} onChange={setColor} />
              {error === undefined ? null : (
                <div className="site-claim-error">
                  <p className="site-alert" role="alert">
                    {error}
                  </p>
                  <ResetLocalData />
                </div>
              )}
              <button className="site-button" data-variant="go" data-size="lg" type="submit">
                Join room
              </button>
              <p className="site-fine">
                Seats stay open until the host starts the match. Up to four teams can play.
              </p>
            </form>
          </section>
        </div>
      </main>
    );
  }

  if (waitingForRoom) {
    return (
      <main className="site-page site-center-page">
        <div className="site-center">
          <div className="site-loader" role="status">
            <p className="site-label">Rejoining room</p>
            <RoomCode code={code} />
            <span className="site-scan" aria-hidden="true" />
            <p className="site-fine">Restoring your seat from this browser…</p>
            {error === undefined ? null : (
              <p className="site-alert" role="alert">
                {error}
              </p>
            )}
            {slowRejoin || error !== undefined ? (
              <Link className="site-button" href="/">
                <Home size={15} aria-hidden="true" /> Back to home
              </Link>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  const self = room.players.find((player) => player.id === selfPlayerId)!;
  const isHost = self.isHost;
  const readyCount = room.players.filter((player) => player.ready).length;
  const allReady = room.players.length >= 2 && readyCount === room.players.length;
  const openSeats = Math.max(0, SEAT_COUNT - room.players.length);
  const inviteUrl =
    typeof window === "undefined" ? `/room/${code}` : `${window.location.origin}/room/${code}`;
  const theme = room.config.arenaTheme ?? DEFAULT_ARENA_THEME_ID;
  const connection = CONNECTION_LABELS[connectionStatus];
  const counts = arena === undefined ? undefined : terrainCounts(arena);
  const catalogEntry = arenaCatalogEntry(room.config.arenaName);

  const updateConfig = (config: RoomConfig) =>
    send({
      version: PROTOCOL_VERSION,
      requestId: requestId(),
      kind: "UpdateConfig",
      code,
      token,
      config,
    });
  const claimCorner = (slot: (typeof HOME_SLOTS)[number]) => {
    if (self.ready) return;
    send({
      version: PROTOCOL_VERSION,
      requestId: requestId(),
      kind: "SetHomeSlot",
      code,
      token,
      homeSlot: slot,
    });
  };
  const saveTeam = (event: FormEvent) => {
    event.preventDefault();
    if (editName !== self.name || editColor !== self.color) {
      send({
        version: PROTOCOL_VERSION,
        requestId: requestId(),
        kind: "UpdatePlayer",
        code,
        token,
        name: editName,
        color: editColor,
      });
    }
    setEditing(false);
  };

  const dockMessage =
    room.players.length < 2
      ? "A match needs at least two teams. Share the code; players can join any time before the start."
      : allReady
        ? isHost
          ? "Everyone seated is ready. Start now, or wait for more players to join."
          : "Everyone seated is ready. The host can start the match."
        : isHost
          ? "You can start once everyone seated is ready. Players can still join."
          : "The host starts once everyone seated is ready. Players can still join.";

  return (
    <main className="site-page site-lobby">
      <SiteHeader rail>
        <BootCampLink returnTo={`/room/${code}`} />
        <FieldGuideButton />
        <Link className="site-button" data-variant="ghost" href="/">
          <Home size={15} aria-hidden="true" /> Home
        </Link>
      </SiteHeader>

      <div className="site-lobby-prompt">
        <BootCampPrompt returnTo={`/room/${code}`} />
      </div>

      <section className="site-lobby-head" aria-labelledby="lobby-title">
        <div className="site-field">
          <h1 id="lobby-title" className="site-label">
            Private room
          </h1>
          <RoomCode code={code} />
        </div>
        <div className="site-lobby-share">
          <p>Send the code or invite link. Players can join until the host starts.</p>
          <div className="site-lobby-share-actions">
            <button type="button" className="site-button" onClick={() => void copyText(inviteUrl)}>
              <Link2 size={15} aria-hidden="true" /> Copy invite link
            </button>
            <button
              type="button"
              className="site-button"
              data-variant="ghost"
              onClick={() => void copyText(code)}
            >
              <Clipboard size={15} aria-hidden="true" /> Copy code
            </button>
            <span className="site-fine" role="status">
              {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Couldn't copy" : ""}
            </span>
          </div>
        </div>
        <span className="site-pill" data-tone={connection.tone} role="status">
          <span className="site-lamp" aria-hidden="true" />
          {connection.text}
        </span>
      </section>

      <ul
        className="site-lineup"
        aria-label={`Teams, ${room.players.length} of ${SEAT_COUNT} seats claimed`}
      >
        {room.players.map((player) => (
          <TeamRow
            key={player.id}
            player={player}
            isSelf={player.id === selfPlayerId}
            editing={player.id === selfPlayerId && editing}
            {...(player.id === selfPlayerId ? { onEdit: () => setEditing(true) } : {})}
          >
            <form className="site-seat-editor" onSubmit={saveTeam}>
              <label className="site-label" htmlFor="lobby-team-name">
                Team name
              </label>
              <input
                id="lobby-team-name"
                className="site-input"
                name="team-name"
                autoComplete="off"
                spellCheck={false}
                value={editName}
                maxLength={24}
                onChange={(event) => setEditName(event.currentTarget.value)}
                required
              />
              <TeamColorPicker value={editColor} onChange={setEditColor} />
              <div className="site-confirm-actions">
                <button type="submit" className="site-button" data-variant="go">
                  Save
                </button>
                <button
                  type="button"
                  className="site-button"
                  data-variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </TeamRow>
        ))}
        {Array.from({ length: openSeats }, (_, index) => (
          <OpenSeat key={`open-${index}`} code={code} first={index === 0} />
        ))}
      </ul>

      <div className="site-lobby-setup">
        <section className="site-panel site-map-card" aria-labelledby="lobby-map-title">
          <div className="site-map-art">
            {arena === undefined ? (
              <div className="site-schematic site-schematic-placeholder" aria-hidden="true" />
            ) : (
              <ArenaSchematic
                arena={arena}
                theme={theme}
                homes={schematicHomes}
                label={`${catalogEntry.name} map with home corners`}
                {...(self.ready
                  ? {}
                  : {
                      onCornerSelect: (corner: Corner) => {
                        const slot = HOME_SLOTS.find((s) => HOME_CORNER_LABELS[s] === corner);
                        if (slot !== undefined) claimCorner(slot);
                      },
                    })}
              />
            )}
          </div>
          <div className="site-map-info">
            <div className="site-field">
              <label id="lobby-map-title" className="site-label" htmlFor="lobby-map">
                Map
              </label>
              <select
                id="lobby-map"
                className="site-input site-select"
                value={room.config.arenaName}
                disabled={!isHost}
                onChange={(event) => {
                  const config = roomConfigSchema.safeParse({
                    ...room.config,
                    arenaName: event.currentTarget.value,
                  });
                  if (config.success) updateConfig(config.data);
                }}
              >
                {ARENA_TOWNS.map(({ town, label }) => (
                  <optgroup key={town} label={label}>
                    {ARENA_CATALOG.filter((entry) => entry.town === town).map((entry) => (
                      <option key={entry.slug} value={entry.slug}>
                        {entry.name} · {entry.width}×{entry.height}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <dl className="site-stats">
              <div>
                <dt className="site-label">Size</dt>
                <dd>
                  {catalogEntry.width}×{catalogEntry.height}
                </dd>
              </div>
              <div>
                <dt className="site-label">Walls</dt>
                <dd>{counts === undefined ? "–" : counts.walls + counts.lowWalls}</dd>
              </div>
              <div>
                <dt className="site-label">Bushes</dt>
                <dd>{counts === undefined ? "–" : counts.bushes}</dd>
              </div>
            </dl>
            <fieldset className="site-fieldset" disabled={self.ready}>
              <legend className="site-label">Your home corner</legend>
              <div className="site-corners">
                {HOME_SLOTS.map((slot) => {
                  const occupant = room.players.find((player) => player.homeSlot === slot);
                  const mine = self.homeSlot === slot;
                  const other = occupant !== undefined && !mine ? occupant : undefined;
                  // A held corner stays clickable: the server swaps the two seats.
                  const label = other
                    ? `Home corner ${HOME_CORNER_LABELS[slot]} (swap with ${other.name})`
                    : `Home corner ${HOME_CORNER_LABELS[slot]}`;
                  return (
                    <button
                      key={slot}
                      type="button"
                      className="site-corner"
                      {...(occupant === undefined ? {} : { "data-team": occupant.color })}
                      aria-pressed={mine}
                      aria-label={label}
                      title={label}
                      onClick={() => claimCorner(slot)}
                    >
                      <strong>{HOME_CORNER_LABELS[slot]}</strong>
                      <span>{mine ? "You" : (other?.name ?? "Open")}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <p className="site-fine">
              {self.ready
                ? "Click Ready to change your corner."
                : "Pick a corner here or on the map. Taking a held corner swaps seats with its owner."}
            </p>
          </div>
        </section>

        <section className="site-panel site-rules" aria-label="Match settings">
          <fieldset className="site-fieldset" disabled={!isHost}>
            <legend className="site-label">Game length</legend>
            <div className="site-options" data-columns="2">
              {GAME_LENGTHS.map((gameLength) => (
                <button
                  key={gameLength}
                  type="button"
                  className="site-option"
                  aria-pressed={room.config.gameLength === gameLength}
                  onClick={() => {
                    if (room.config.gameLength === gameLength) return;
                    // Keep a map the host picked; follow the classic pairing otherwise.
                    const keepArena =
                      room.config.arenaName !== DEFAULT_ARENA_FOR_LENGTH[room.config.gameLength];
                    const next = configForLength(gameLength);
                    updateConfig({
                      ...next,
                      arenaName: keepArena ? room.config.arenaName : next.arenaName,
                      formation: room.config.formation,
                      arenaTheme: room.config.arenaTheme ?? DEFAULT_ARENA_THEME_ID,
                    });
                  }}
                >
                  <strong>{LENGTH_LABELS[gameLength]}</strong>
                  <span>{ROBOTS_PER_TEAM_BY_LENGTH[gameLength]} robots per team</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="site-fieldset" disabled={!isHost}>
            <legend className="site-label">Formation</legend>
            <div className="site-options" data-columns="2">
              {FORMATION_ORDER.map((formation) => (
                <button
                  key={formation}
                  type="button"
                  className="site-option"
                  aria-pressed={room.config.formation === formation}
                  onClick={() => {
                    const config = roomConfigSchema.safeParse({ ...room.config, formation });
                    if (config.success) updateConfig(config.data);
                  }}
                >
                  <strong>{FORMATION_LABELS[formation].name}</strong>
                  <span>{FORMATION_LABELS[formation].tagline}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="site-fieldset" disabled={!isHost}>
            <legend className="site-label">Arena look</legend>
            <div className="site-options" data-columns="4">
              {ARENA_THEME_ORDER.map((id) => {
                const look = ARENA_THEMES[id];
                return (
                  <button
                    key={id}
                    type="button"
                    className="site-option site-look"
                    aria-pressed={theme === id}
                    title={look.tagline}
                    onClick={() => {
                      const arenaTheme = arenaThemeSchema.safeParse(id);
                      if (arenaTheme.success)
                        updateConfig({ ...room.config, arenaTheme: arenaTheme.data });
                    }}
                  >
                    <span
                      className="site-look-swatch"
                      aria-hidden="true"
                      style={{
                        background: `linear-gradient(180deg, ${look.sky[0]}, ${look.sky[1]} 45%, ${look.sky[2]} 70%, ${look.floor.base} 71%)`,
                        boxShadow: `inset 0 -2px 0 ${hexColor(look.rim.color)}`,
                      }}
                    />
                    <strong>{look.name}</strong>
                  </button>
                );
              })}
            </div>
            <p className="site-fine">{ARENA_THEMES[theme].tagline}</p>
          </fieldset>
          {isHost ? null : (
            <p className="site-fine site-lock-note">
              <LockKeyhole size={13} aria-hidden="true" />
              The host sets the match. Changes appear here live.
            </p>
          )}
        </section>
      </div>

      {error === undefined ? null : (
        <div className="site-lobby-error">
          <p className="site-alert" role="alert">
            {error}
          </p>
          {connectionStatus === "incompatible-protocol" ? <ResetLocalData /> : null}
        </div>
      )}

      <div className="site-dock">
        <div className="site-dock-meter" aria-hidden="true">
          {room.players.map((player) => (
            <span key={player.id} data-team={player.color} data-ready={player.ready} />
          ))}
        </div>
        <p id="lobby-dock-status" className="site-dock-text" role="status">
          <strong>
            {readyCount} of {room.players.length} ready.
          </strong>{" "}
          {dockMessage}
        </p>
        <span className="site-fine site-dock-rules">
          Survival · {room.config.turnLengthSeconds}s turns
        </span>
        <button
          type="button"
          className="site-button"
          data-size="lg"
          {...(self.ready ? {} : { "data-variant": "go" })}
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
              <Check size={16} aria-hidden="true" />
              Ready · click to change
            </>
          ) : (
            "Ready up"
          )}
        </button>
        {isHost ? (
          <button
            type="button"
            className="site-button"
            data-variant="go"
            data-size="lg"
            disabled={!allReady}
            aria-describedby="lobby-dock-status"
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
            <Play size={15} className="fill-current" aria-hidden="true" />
            Start match
          </button>
        ) : null}
      </div>
    </main>
  );
}
