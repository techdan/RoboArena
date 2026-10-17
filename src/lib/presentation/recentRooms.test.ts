import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type PublicPlayer, type RoomSnapshotMessage } from "../net/protocol";
import { DEFAULT_ROOM_CONFIG } from "../setup/validate";
import {
  checkingRoom,
  rejoinRoom,
  sortRecentRooms,
  summarizeRoom,
  unavailableRoom,
} from "./recentRooms";

const player = (id: string, name: string, ready = false): PublicPlayer => ({
  id,
  name,
  color: "red",
  ready,
  connected: true,
  isHost: id === "a",
});

const snapshot = (
  overrides: Partial<Pick<RoomSnapshotMessage, "matchStatus">> & {
    readonly players?: readonly PublicPlayer[];
    readonly phase?: "setup" | "active";
  } = {},
): RoomSnapshotMessage => ({
  version: PROTOCOL_VERSION,
  requestId: "r",
  kind: "RoomSnapshot",
  selfPlayerId: "a",
  room: {
    code: "ABC234",
    phase: overrides.phase ?? "active",
    hostPlayerId: "a",
    config: { ...DEFAULT_ROOM_CONFIG, arenaName: "rubble-two" },
    players: overrides.players ?? [player("a", "Ember Unit"), player("b", "Azure Unit")],
  },
  ...(overrides.matchStatus === undefined ? {} : { matchStatus: overrides.matchStatus }),
});

describe("summarizeRoom", () => {
  it("marks a planning turn as the player's action with a Resume prompt", () => {
    const summary = summarizeRoom(
      snapshot({ matchStatus: { status: "planning", turnNumber: 3, waitingForPlayers: 2 } }),
    );
    expect(summary).toEqual({
      code: "ABC234",
      tone: "action",
      headline: "Your turn · Turn 3",
      detail: "Ember Unit vs Azure Unit · Rubble Two",
      cta: "Resume",
    });
  });

  it("offers Watch when a resolved turn is waiting", () => {
    const summary = summarizeRoom(
      snapshot({ matchStatus: { status: "turn-ready", turnNumber: 4, waitingForPlayers: 0 } }),
    );
    expect(summary.tone).toBe("action");
    expect(summary.cta).toBe("Watch");
  });

  it("describes locked orders without asking for action", () => {
    const one = summarizeRoom(
      snapshot({ matchStatus: { status: "waiting", turnNumber: 2, waitingForPlayers: 1 } }),
    );
    const two = summarizeRoom(
      snapshot({ matchStatus: { status: "waiting", turnNumber: 2, waitingForPlayers: 2 } }),
    );
    expect(one.headline).toBe("Orders locked · 1 team still planning");
    expect(two.headline).toBe("Orders locked · 2 teams still planning");
    expect(one.cta).toBeUndefined();
  });

  it("counts lobby readiness and seats", () => {
    const summary = summarizeRoom(
      snapshot({ phase: "setup", players: [player("a", "Ember", true), player("b", "Azure")] }),
    );
    expect(summary.tone).toBe("lobby");
    expect(summary.headline).toBe("Lobby · 1 of 2 ready");
    expect(summary.detail).toBe("2 of 4 seats · Ember vs Azure · Rubble Two");
  });

  it("calls a fully ready lobby ready", () => {
    const summary = summarizeRoom(
      snapshot({
        phase: "setup",
        players: [player("a", "Ember", true), player("b", "Azure", true)],
      }),
    );
    expect(summary.headline).toBe("Lobby · everyone ready");
  });

  it("summarizes more than two teams by count", () => {
    const summary = summarizeRoom(
      snapshot({
        players: [player("a", "A"), player("b", "B"), player("c", "C")],
        matchStatus: { status: "finished", turnNumber: 9, waitingForPlayers: 0 },
      }),
    );
    expect(summary.detail).toBe("3 teams · Rubble Two");
    expect(summary.cta).toBe("Results");
  });
});

describe("sortRecentRooms", () => {
  it("lifts rooms that need the player and keeps recency otherwise", () => {
    const lobby = summarizeRoom(snapshot({ phase: "setup" }));
    const turn = {
      ...summarizeRoom(
        snapshot({ matchStatus: { status: "planning", turnNumber: 1, waitingForPlayers: 2 } }),
      ),
      code: "TURN22",
    };
    const sorted = sortRecentRooms([
      unavailableRoom("GONE22"),
      lobby,
      checkingRoom("CHEK22"),
      rejoinRoom("SEAT22"),
      turn,
    ]);
    expect(sorted.map((room) => room.code)).toEqual([
      "TURN22",
      "SEAT22",
      "ABC234",
      "GONE22",
      "CHEK22",
    ]);
  });
});
