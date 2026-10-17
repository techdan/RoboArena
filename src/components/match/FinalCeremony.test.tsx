import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ceremonyPresentation,
  matchFlowCopy,
  matchTabTitle,
  movieHandoffCopy,
} from "../../lib/presentation/matchFlow";
import { HelpProvider } from "../help/HelpProvider";
import { FinalCeremony } from "./FinalCeremony";
import { MatchFlowHeader } from "./MatchFlowHeader";

const teams = [
  { id: "alpha", name: "Alpha Unit", color: "red", side: 1 as const },
  { id: "bravo", name: "Bravo Guard", color: "blue", side: 2 as const },
  { id: "charlie", name: "Charlie Line", color: "green", side: 3 as const },
];
const scores = [
  { teamId: "alpha", score: 150 },
  { teamId: "bravo", score: 700 },
  { teamId: "charlie", score: 0 },
];

describe("Final Ceremony presentation", () => {
  it("maps a winning Side to an authorized Team identity", () => {
    const view = ceremonyPresentation({ teams, scores, outcome: "won", winningSide: 2 });
    expect(view).toMatchObject({
      kind: "winner",
      heading: "Bravo Guard wins",
      winningTeam: teams[1],
    });
  });

  it("presents draws without implying a winner", () => {
    const html = renderToStaticMarkup(
      <FinalCeremony teams={teams} scores={scores} outcome="draw" />,
    );
    expect(html).toContain("Match ends in a draw");
    expect(html).not.toContain("Winning Team");
  });

  it("falls back to a legacy Side number when no authorized Team maps to it", () => {
    expect(
      ceremonyPresentation({ teams: teams.slice(0, 2), scores, outcome: "won", winningSide: 3 }),
    ).toMatchObject({ kind: "legacy-winner", heading: "Side 3 wins" });
  });

  it("keeps canonical Team order and authoritative score values", () => {
    const view = ceremonyPresentation({ teams, scores, outcome: "won", winningSide: 2 });
    expect(view.rows.map(({ id, score }) => [id, score])).toEqual([
      ["alpha", 150],
      ["bravo", 700],
      ["charlie", 0],
    ]);
  });

  it("renders non-color Team identity, Home navigation, and no rematch action", () => {
    const html = renderToStaticMarkup(
      <FinalCeremony teams={teams} scores={scores} outcome="won" winningSide={2} />,
    );
    expect(html).toContain("Bravo Guard wins");
    expect(html).toContain("Winning Team");
    expect(html).toContain('href="/"');
    expect(html).toContain("Return home");
    expect(html.toLowerCase()).not.toContain("rematch");
  });
});

describe("match-flow phase copy", () => {
  it("names waiting, movie, and finished phases with one primary action each", () => {
    expect(matchFlowCopy("waiting", 4)).toMatchObject({
      heading: "Orders locked",
      primaryAction: "Check now",
    });
    expect(matchFlowCopy("turn-ready", 4)).toMatchObject({
      heading: "Turn 4 is ready to watch",
      primaryAction: "Done watching Turn 4",
    });
    expect(matchFlowCopy("finished", 5)).toMatchObject({
      heading: "Match finished",
      primaryAction: "Return home",
    });
  });

  it("never promises another turn before the server reveals the outcome", () => {
    const handoff = movieHandoffCopy(3, false);
    expect(handoff.action).toBe("Done watching Turn 3");
    expect(handoff.detail).toContain("or the results if the match is over");
    expect(movieHandoffCopy(3, true).detail).toContain("Your team is out");
  });

  it("names browser tabs by phase", () => {
    expect(matchTabTitle("planning", 2)).toBe("Turn 2 · Plan");
    expect(matchTabTitle("turn-ready", 2)).toBe("Turn 2 · Movie");
    expect(matchTabTitle("finished", 9)).toBe("Results");
  });

  it("renders authorized Room, Team, Turn, saved-state, and Field Guide context", () => {
    const html = renderToStaticMarkup(
      <HelpProvider>
        <MatchFlowHeader
          roomCode="ABC234"
          matchId="match-4"
          team={{ name: "Alpha Unit", color: "red" }}
          turnNumber={4}
          status="waiting"
        />
      </HelpProvider>,
    );
    expect(html).toContain("Room ABC234");
    expect(html).toContain("Alpha Unit");
    expect(html).toContain("Turn 4");
    expect(html).toContain("Room state saved");
    expect(html).toContain("Field Guide");
    expect(html).not.toContain("robotId");
  });
});
