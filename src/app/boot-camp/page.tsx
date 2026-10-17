import type { Metadata } from "next";
import { BootCamp } from "../../components/bootcamp/BootCamp";
import { safeReturnPath } from "../../lib/help/bootCampStorage";

export const metadata: Metadata = {
  title: "Boot Camp",
  description: "A two-minute quick-start: robot classes, weapons, cover, and your first turn.",
};

export default async function BootCampPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return <BootCamp returnTo={safeReturnPath(next)} />;
}
