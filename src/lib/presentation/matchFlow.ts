import type { MatchSnapshotMessage } from "../net/protocol";

export interface AuthorizedTeamSummary {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly side: 1 | 2 | 3 | 4;
}

export interface CeremonyScore {
  readonly teamId: string;
  readonly score: number;
}

export interface CeremonyPresentation {
  readonly kind: "winner" | "draw" | "legacy-winner" | "complete";
  readonly heading: string;
  readonly summary: string;
  readonly winningTeam?: AuthorizedTeamSummary;
  readonly rows: readonly (AuthorizedTeamSummary & { readonly score: number })[];
}

/** Build result copy from participant-authorized Team identity and canonical scores only. */
export const ceremonyPresentation = (input: {
  readonly teams: readonly AuthorizedTeamSummary[];
  readonly scores: readonly CeremonyScore[];
  readonly outcome?: "won" | "draw";
  readonly winningSide?: 1 | 2 | 3 | 4;
}): CeremonyPresentation => {
  const scoreByTeam = new Map(input.scores.map((entry) => [entry.teamId, entry.score]));
  const rows = input.teams.map((team) => ({ ...team, score: scoreByTeam.get(team.id) ?? 0 }));
  if (input.outcome === "draw") {
    return {
      kind: "draw",
      heading: "Match ends in a draw",
      summary: "No Team was left as the sole survivor.",
      rows,
    };
  }
  const winningTeam = input.teams.find((team) => team.side === input.winningSide);
  if (winningTeam !== undefined) {
    return {
      kind: "winner",
      heading: `${winningTeam.name} wins`,
      summary: "Winning Team · last Team standing",
      winningTeam,
      rows,
    };
  }
  if (input.outcome === "won" && input.winningSide !== undefined) {
    return {
      kind: "legacy-winner",
      heading: `Side ${input.winningSide} wins`,
      summary: "The winning Team identity is unavailable in this legacy result.",
      rows,
    };
  }
  return {
    kind: "complete",
    heading: "Participation finished",
    summary: "No final winner is available in this participant view.",
    rows,
  };
};

export interface MatchFlowCopy {
  readonly eyebrow: string;
  readonly heading: string;
  readonly detail: string;
  readonly primaryAction: string;
}

/** Status copy for the match shell. Async by design: nobody is named as holding a turn up. */
export const matchFlowCopy = (
  status: MatchSnapshotMessage["status"],
  turnNumber: number,
): MatchFlowCopy => {
  switch (status) {
    case "planning":
      return {
        eyebrow: `Turn ${turnNumber}`,
        heading: "Your turn",
        detail: "Program privately, then lock the turn when you are ready.",
        primaryAction: "Lock turn",
      };
    case "waiting":
      return {
        eyebrow: `Turn ${turnNumber}`,
        heading: "Orders locked",
        detail: `Turn ${turnNumber} plays out as soon as every team has locked. This page updates by itself, and you can close it: your orders are saved.`,
        primaryAction: "Check now",
      };
    case "turn-ready":
      return {
        eyebrow: `Turn ${turnNumber}`,
        heading: `Turn ${turnNumber} is ready to watch`,
        detail: "Playback runs on this device. The resolved turn is already saved on the server.",
        primaryAction: `Done watching Turn ${turnNumber}`,
      };
    case "finished":
      return {
        eyebrow: "Finished",
        heading: "Match finished",
        detail: "No further turns are needed from your team.",
        primaryAction: "Return home",
      };
  }
};

/**
 * The movie hand-off. The server reveals the outcome only once the match is
 * finished, so the next step is described without promising another turn.
 */
export const movieHandoffCopy = (
  turnNumber: number,
  spectating: boolean,
): { readonly question: string; readonly detail: string; readonly action: string } => ({
  question: `Finished watching Turn ${turnNumber}?`,
  detail: spectating
    ? "Your team is out. Continue to follow the remaining teams; other players move on independently."
    : `Next comes your Turn ${turnNumber + 1} planner, or the results if the match is over. Other players continue on their own.`,
  action: `Done watching Turn ${turnNumber}`,
});

/** Browser tab title for each match phase. */
export const matchTabTitle = (
  status: MatchSnapshotMessage["status"] | "checking" | "denied",
  turnNumber: number,
): string => {
  switch (status) {
    case "planning":
      return `Turn ${turnNumber} · Plan`;
    case "waiting":
      return `Turn ${turnNumber} · Locked`;
    case "turn-ready":
      return `Turn ${turnNumber} · Movie`;
    case "finished":
      return "Results";
    case "checking":
      return "Match";
    case "denied":
      return "Match unavailable";
  }
};
