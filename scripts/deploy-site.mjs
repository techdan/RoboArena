// Builds and deploys the site to Cloudflare with the production room-service
// address. NEXT_PUBLIC_ROOM_WS_URL is baked into the client bundle at build
// time; without it the build silently falls back to ws://localhost:3001 and
// nobody can create or join a room. An exported value still wins.
import { spawnSync } from "node:child_process";

const PRODUCTION_ROOM_WS_URL = "wss://roboarena-rooms.manheim.workers.dev";
const env = {
  ...process.env,
  NEXT_PUBLIC_ROOM_WS_URL: process.env.NEXT_PUBLIC_ROOM_WS_URL || PRODUCTION_ROOM_WS_URL,
};
console.log(`Building with NEXT_PUBLIC_ROOM_WS_URL=${env.NEXT_PUBLIC_ROOM_WS_URL}`);

for (const step of ["build", "deploy"]) {
  const result = spawnSync("npx", ["opennextjs-cloudflare", step], {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
