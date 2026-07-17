import { defineConfig, devices } from "@playwright/test";

const managedWebServer = {
  command: "node tools/testing/start-next.mjs",
  url: "http://localhost:3000/preview",
  reuseExistingServer: false,
  timeout: 120_000,
  env: { HOSTNAME: "127.0.0.1", PORT: "3000" },
} as const;

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["./tools/testing/completion-reporter.mjs"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    viewport: { width: 1440, height: 1100 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(process.env.PLAYWRIGHT_EXTERNAL_SERVER === "true" ? {} : { webServer: managedWebServer }),
});
