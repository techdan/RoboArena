import { HomeSetup } from "../components/setup/HomeSetup";
import { loadArena } from "../lib/arenas";

export default async function HomePage() {
  const arena = await loadArena("rubble-two");
  return <HomeSetup arena={arena} />;
}
