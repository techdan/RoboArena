import { PlannerConcept, type ConceptShot } from "../../components/concept/PlannerConcept";
import { createPlannerConcept } from "../../lib/replays/plannerConcept";
import { isArenaThemeId } from "../../renderer3d/themes";

const SHOTS: readonly ConceptShot[] = ["overview", "command", "aim", "rehearse"];

export default async function PlannerConceptPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly shot?: string;
    readonly theme?: string;
    readonly view?: string;
  }>;
}) {
  const query = await searchParams;
  const shot = SHOTS.find((candidate) => candidate === query.shot) ?? "overview";
  const theme = isArenaThemeId(query.theme) ? query.theme : "coliseum";
  const view = query.view === "tilt" ? "tilt" : "top";
  return <PlannerConcept concept={createPlannerConcept()} shot={shot} theme={theme} view={view} />;
}
