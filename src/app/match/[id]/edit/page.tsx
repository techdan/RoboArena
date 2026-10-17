import type { Metadata } from "next";
import { MatchGate } from "../../../../components/setup/MatchGate";

export const metadata: Metadata = { title: "Match" };

export default async function MatchEditPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  return <MatchGate matchId={id} />;
}
