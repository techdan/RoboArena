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

export const matchFlowCopy = (
  status: MatchSnapshotMessage["status"],
  turnNumber: number,
): MatchFlowCopy => {
  switch (status) {
    case "planning":
      return {
        eyebrow: `Turn ${turnNumber}`,
        heading: "Your Team is planning",
        detail: "Program privately, then lock the Turn when you are ready.",
        primaryAction: "Lock Turn",
      };
    case "waiting":
      return {
        eyebrow: `Turn ${turnNumber}`,
        heading: "Orders locked · Waiting",
        detail: "Your orders are saved. Resolution begins when every active player locks.",
        primaryAction: "Refresh status",
      };
    case "turn-ready":
      return {
        eyebrow: `Turn ${turnNumber}`,
        heading: "Turn movie ready",
        detail: "Playback is local; the resolved Turn is already saved by the room service.",
        primaryAction: `Acknowledge Turn ${turnNumber} and plan next`,
      };
    case "finished":
      return {
        eyebrow: "Finished",
        heading: "Finished",
        detail: "No further Turn action is required for this Team.",
        primaryAction: "Return home",
      };
  }
};
