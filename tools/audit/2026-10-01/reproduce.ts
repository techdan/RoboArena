import {
  makeFfaMatch,
  makeMatch,
  makeOpenArena,
  makeRobot,
} from "../../../src/engine/__fixtures__/match.js";
import { resolveTurn } from "../../../src/engine/resolver.js";
import { projectMatchState, projectTurnResult } from "../../../server/view.js";
import {
  activePlayerIds,
  createAuthoritativeMatch,
  emptyOrders,
  lockParticipantOrders,
  resolvePendingTurn,
  validateParticipantOrders,
} from "../../../server/matches.js";
import type { TurnOrders } from "../../../src/engine/types.js";

const print = (name: string, evidence: unknown) =>
  console.log(JSON.stringify({ name, evidence }, null, 2));

// The observer sees a scanner on its cone boundary, but cannot see its target.
const ffa = makeFfaMatch(
  [
    {
      id: "observer",
      robots: [makeRobot("a", "observer", "rifle", { x: 1, y: 1 }, { scanHeading: "N" })],
    },
    {
      id: "scanner",
      robots: [makeRobot("b", "scanner", "rifle", { x: 6, y: 1 }, { scanHeading: "S" })],
    },
    { id: "hidden", robots: [makeRobot("c", "hidden", "rifle", { x: 6, y: 3 })] },
  ],
  { turnLengthSeconds: 1 },
);
const scanOrders: TurnOrders = {
  turnNumber: 1,
  timelines: [
    {
      robotId: "b",
      segments: [{ kind: "scan-and-fire", weapon: "rifle", maxDistance: 18, seconds: 1 }],
    },
  ],
};
const ffaResult = resolveTurn({ state: ffa, orders: scanOrders, seed: "audit" });
if (ffaResult.outcome !== "resolved") throw new Error(ffaResult.message);
const projected = projectTurnResult(
  {
    initialState: ffa,
    events: ffaResult.events,
    turnNumber: 1,
    seed: "audit",
    resolutionNonce: "audit",
    orders: scanOrders,
    participantOrders: {},
    eventDigest: "",
    nextStateDigest: "",
  },
  "observer",
);
print("hidden third-party target leak", {
  initiallyVisible: projectMatchState(ffa, "observer").teams.flatMap((t) =>
    t.robots.map((r) => r.id),
  ),
  events: projected.events.filter((e) => e.kind === "scan-target-acquired" || e.kind === "fired"),
});

// Both programs validate independently. The opponent's movement then causes
// the scanner to consume its finite ammo before the following Aim command.
const missile = {
  ...makeRobot("m", "team-1", "missile", { x: 1, y: 1 }),
  ammo: { ...makeRobot("m", "team-1", "missile", { x: 1, y: 1 }).ammo, "missile-launcher": 1 },
};
const conditional = makeMatch({
  teamOneRobots: [missile],
  teamTwoRobots: [makeRobot("t", "team-2", "rifle", { x: 7, y: 1 })],
  arena: makeOpenArena(10, 8),
  turnLengthSeconds: 3,
});
const match = createAuthoritativeMatch(conditional, ["team-1", "team-2"]);
const first: TurnOrders = {
  turnNumber: 1,
  timelines: [
    {
      robotId: "m",
      segments: [
        { kind: "scan-and-fire", weapon: "missile-launcher", maxDistance: 5, seconds: 1 },
        { kind: "aim-and-fire", weapon: "missile-launcher", target: { x: 8, y: 1 }, repeat: false },
      ],
    },
  ],
};
const second: TurnOrders = {
  turnNumber: 1,
  timelines: [
    {
      robotId: "t",
      segments: [{ kind: "move", posture: "upright", path: [{ to: { x: 6, y: 1 } }] }],
    },
  ],
};
try {
  validateParticipantOrders(match, "team-1", first);
  validateParticipantOrders(match, "team-2", second);
  lockParticipantOrders(match, "team-1", first, "audit", "audit");
  lockParticipantOrders(match, "team-2", second, "audit", "audit");
  resolvePendingTurn(match);
  print("conditional ammo resolution", {
    phase: match.phase,
    pending: match.pendingResolution !== undefined,
  });
} catch (error) {
  print("conditional ammo validation", {
    error: String(error),
    phase: match.phase,
    locked: match.lockedPlayerIds,
    pending: match.pendingResolution !== undefined,
  });
}

const eliminatedState = makeFfaMatch([
  { id: "alive-a", robots: [makeRobot("a", "alive-a", "rifle", { x: 1, y: 1 })] },
  { id: "alive-b", robots: [makeRobot("b", "alive-b", "rifle", { x: 6, y: 1 })] },
  { id: "dead", robots: [makeRobot("d", "dead", "rifle", "dock", { hp: 0 })] },
]);
const eliminatedMatch = createAuthoritativeMatch(eliminatedState, ["alive-a", "alive-b", "dead"]);
lockParticipantOrders(eliminatedMatch, "alive-a", emptyOrders(1), "audit", "audit");
lockParticipantOrders(eliminatedMatch, "alive-b", emptyOrders(1), "audit", "audit");
print("eliminated seat participation", {
  active: activePlayerIds(eliminatedMatch),
  phase: eliminatedMatch.phase,
  pending: eliminatedMatch.pendingResolution !== undefined,
});
