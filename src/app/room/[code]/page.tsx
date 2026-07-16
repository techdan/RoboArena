import { RoomSetup } from "../../../components/setup/RoomSetup";

export default async function RoomPage({
  params,
}: {
  readonly params: Promise<{ readonly code: string }>;
}) {
  const { code } = await params;
  return <RoomSetup code={code.toUpperCase()} />;
}
