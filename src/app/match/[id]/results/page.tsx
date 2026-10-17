import type { Metadata } from "next";
import { MatchGate } from "../../../../components/setup/MatchGate";

export const metadata: Metadata = { title: "Results" };

export default async function MatchResultsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return <MatchGate matchId={id} />;
}
