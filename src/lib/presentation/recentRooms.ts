import type { RoomSnapshotMessage } from "../net/protocol";
import { arenaCatalogEntry } from "../arenas/catalog";

/**
 * How a remembered room reads on the home page. `action` rooms need this
 * player now (their turn, or a new movie) and sort to the top.
 */
export type RecentRoomTone = "action" | "waiting" | "lobby" | "finished" | "attention" | "muted";

export interface RecentRoomSummary {
  readonly code: string;
  readonly tone: RecentRoomTone;
  readonly headline: string;
  readonly detail: string;
  /** Call to action for rooms that need this player; absent otherwise. */
  readonly cta?: string;
}

const TONE_ORDER: Readonly<Record<RecentRoomTone, number>> = {
  action: 0,
  attention: 1,
  lobby: 2,
  waiting: 3,
  finished: 4,
  muted: 5,
};

const roster = (snapshot: RoomSnapshotMessage): string => {
  const names = snapshot.room.players.map((player) => player.name);
  const map = arenaCatalogEntry(snapshot.room.config.arenaName).name;
  if (names.length === 0) return map;
  const teams = names.length <= 2 ? names.join(" vs ") : `${names.length} teams`;
  return `${teams} · ${map}`;
};

/** Summarize an authorized room snapshot for this participant. */
export const summarizeRoom = (snapshot: RoomSnapshotMessage): RecentRoomSummary => {
  const { room, matchStatus } = snapshot;
  const code = room.code;
  const detail = roster(snapshot);
  switch (matchStatus?.status) {
    case "planning":
      return {
        code,
        tone: "action",
        headline: `Your turn · Turn ${matchStatus.turnNumber}`,
        detail,
        cta: "Resume",
      };
    case "turn-ready":
      return {
        code,
        tone: "action",
        headline: `Turn ${matchStatus.turnNumber} is ready to watch`,
        detail,
        cta: "Watch",
      };
    case "waiting":
      return {
        code,
        tone: "waiting",
        headline:
          matchStatus.waitingForPlayers === 1
            ? `Orders locked · 1 team still planning`
            : `Orders locked · ${matchStatus.waitingForPlayers} teams still planning`,
        detail,
      };
    case "finished":
      return { code, tone: "finished", headline: "Match finished", detail, cta: "Results" };
    case undefined:
      break;
  }
  if (room.phase === "active")
    return { code, tone: "waiting", headline: "Match in progress", detail };
  const ready = room.players.filter((player) => player.ready).length;
  const seats = `${room.players.length} of 4 seats`;
  if (room.players.length >= 2 && ready === room.players.length) {
    return {
      code,
      tone: "lobby",
      headline: `Lobby · everyone ready`,
      detail: `${seats} · ${detail}`,
    };
  }
  return {
    code,
    tone: "lobby",
    headline: `Lobby · ${ready} of ${room.players.length} ready`,
    detail: `${seats} · ${detail}`,
  };
};

export const checkingRoom = (code: string): RecentRoomSummary => ({
  code,
  tone: "muted",
  headline: "Checking…",
  detail: "Asking the room service for this room's status",
});

export const rejoinRoom = (code: string): RecentRoomSummary => ({
  code,
  tone: "attention",
  headline: "Seat not saved on this device",
  detail: "Open the room to claim a seat again",
  cta: "Rejoin",
});

export const unavailableRoom = (code: string): RecentRoomSummary => ({
  code,
  tone: "muted",
  headline: "Room unavailable",
  detail: "The room service did not answer. Try again later.",
});

/** Rooms that need this player first; otherwise keep most-recent-first order. */
export const sortRecentRooms = (
  rooms: readonly RecentRoomSummary[],
): readonly RecentRoomSummary[] =>
  rooms
    .map((room, index) => ({ room, index }))
    .sort((a, b) => TONE_ORDER[a.room.tone] - TONE_ORDER[b.room.tone] || a.index - b.index)
    .map(({ room }) => room);
