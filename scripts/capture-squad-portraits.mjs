/**
 * Captures Boot Camp's four robot portraits from the real 3D renderer, using
 * the /movie/lineup scene (one robot of each class side by side).
 *
 * Re-run after any change to the robot models or arena look:
 *   1. start the site:   npm run dev
 *   2. capture:          node scripts/capture-squad-portraits.mjs [baseUrl]
 *
 * Writes public/assets/site/robots/<class>.jpg. The free camera is dollied in
 * over the lineup; each portrait is clipped around its robot's screen position.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "public/assets/site/robots");
const SETTLE_MS = 9_000;
const DOLLY_STEPS = 13;
// Robot centres as fractions of the canvas after the dolly (lineup tiles 8, 10, 12, 14).
const ROBOTS = {
  rifle: [0.253, 0.494],
  burst: [0.396, 0.512],
  auto: [0.531, 0.517],
  missile: [0.68, 0.512],
};
const SIZE = 150;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1200 },
    deviceScaleFactor: 2,
  });
  await page.goto(`${baseUrl}/movie/lineup`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: ".movie-view-toolbar { opacity: 0 !important; }" });
  await page.waitForTimeout(SETTLE_MS);
  await page.getByRole("button", { name: /free/i }).first().click();
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("The lineup canvas did not render.");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.52);
  for (let step = 0; step < DOLLY_STEPS; step += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1200);
  for (const [robotClass, [fx, fy]] of Object.entries(ROBOTS)) {
    const path = resolve(outDir, `${robotClass}.jpg`);
    await page.screenshot({
      path,
      type: "jpeg",
      quality: 85,
      clip: {
        x: box.x + box.width * fx - SIZE / 2,
        y: box.y + box.height * fy - SIZE / 2,
        width: SIZE,
        height: SIZE,
      },
    });
    console.log(`Wrote ${path}`);
  }
} finally {
  await browser.close();
}
