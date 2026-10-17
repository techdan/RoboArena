/**
 * Captures the home page's Floodlit Coliseum still from the real 3D movie
 * renderer, so the home page can show the arena without running WebGL.
 *
 * Re-run after any change to the arena's look (the image is a snapshot):
 *   1. start the site:   npm run dev
 *   2. capture:          node scripts/capture-site-hero.mjs [baseUrl]
 *
 * Writes public/assets/site/coliseum-hero.jpg from /movie/showcase at a fixed
 * tick, with the movie's view toolbar hidden. Uses the GPU via ANGLE so the
 * capture matches the Cinematic preset.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public/assets/site/coliseum-hero.jpg");
const SETTLE_MS = 14_000;

mkdirSync(dirname(output), { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1200 },
    deviceScaleFactor: 2,
  });
  await page.goto(`${baseUrl}/movie/showcase?t=120`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: ".movie-view-toolbar { display: none !important; }" });
  await page.waitForTimeout(SETTLE_MS);
  await page.locator("canvas").first().screenshot({ path: output, type: "jpeg", quality: 80 });
  console.log(`Wrote ${output}`);
} finally {
  await browser.close();
}
