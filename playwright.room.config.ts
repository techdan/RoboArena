import { defineConfig, devices } from "@playwright/test";

const managedWebServers = [
  {
    command: "node --import tsx server/index.ts",
    url: "http://localhost:3001/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ROOM_DATABASE_PATH: "test-results/phase8-browser.sqlite", PORT: "3001" },
  },
  {
    command: "node tools/testing/start-next.mjs",
    url: "http://localhost:3000/",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { HOSTNAME: "127.0.0.1", PORT: "3000" },
  },
] as const;

export default defineConfig({
  testDir: "./tests/room",
  fullyParallel: false,
  reporter: [["list"], ["./tools/testing/completion-reporter.mjs"]],
  timeout: 45_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(process.env.PLAYWRIGHT_EXTERNAL_SERVER === "true" ? {} : { webServer: managedWebServers }),
});
