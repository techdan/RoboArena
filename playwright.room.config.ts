import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/room",
  fullyParallel: false,
  reporter: "list",
  timeout: 45_000,
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node ./node_modules/tsx/dist/cli.mjs server/index.ts",
      url: "http://localhost:3001/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ROOM_DATABASE_PATH: "test-results/phase8-browser.sqlite", PORT: "3001" },
    },
    {
      command: "node ./node_modules/next/dist/bin/next start",
      url: "http://localhost:3000/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
