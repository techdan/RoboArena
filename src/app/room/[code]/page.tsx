import type { Metadata } from "next";
import { RoomSetup } from "../../../components/setup/RoomSetup";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return { title: `Room ${code.toUpperCase()}` };
}

export default async function RoomPage({
  params,
}: {
  readonly params: Promise<{ readonly code: string }>;
}) {
  const { code } = await params;
  return <RoomSetup code={code.toUpperCase()} />;
}
