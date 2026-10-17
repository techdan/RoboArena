/* global console, process, window -- Node script; window is used inside page.evaluate. */
// Locked-camera arena comparison for art reviews.
//
// Renders the same top-down patch of /movie/showcase at the same tick for each
// variant, on the real GPU, and writes one labelled side-by-side PNG into
// public/ so the owner can open it from the dev server. Output PNGs are review
// artefacts: do not commit them.
//
//   node tools/visual/compare-arena.mjs <out-name> "<label>|<query>" ...
//   node tools/visual/compare-arena.mjs compare-white-space \
//     "Today|" "New, robots 1.15|&art=next&wallInset=0.1" \
//     "New, robots 1.15, step-back 0.15|&art=next"
//
// Requires the dev server on http://localhost:3000 (npm run dev) and Python
// with Pillow for the montage. Options via env: TICK (default 40), THEME
// (coliseum), CENTER ("12,14.5" tile coordinates), HEIGHT (13), and
// VIEW=overview to capture each variant's own default overview framing (full
// canvas, no crop) instead of the locked close-up.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const [name, ...specs] = process.argv.slice(2);
if (name === undefined || specs.length === 0) {
  console.error('usage: compare-arena.mjs <out-name> "<label>|<query>" ...');
  process.exit(1);
}
const tick = Number(process.env.TICK ?? 40);
const theme = process.env.THEME ?? "coliseum";
const [cx, cz] = (process.env.CENTER ?? "12,14.5").split(",").map(Number);
const height = Number(process.env.HEIGHT ?? 13);
const overview = process.env.VIEW === "overview";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "arena-compare-"));

const browser = await chromium.launch({
  headless: false,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--window-position=-2400,0"],
});
const shots = [];
for (const [index, spec] of specs.entries()) {
  const [label, query = ""] = spec.split("|");
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`http://localhost:3000/movie/showcase?capture&theme=${theme}&t=${tick}${query}`);
  await page.waitForFunction(() => window.__movie3d !== undefined, null, { timeout: 120000 });
  const canvas = page.locator("canvas[data-movie-renderer='3d']");
  await canvas.scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ tick, cx, cz, height, overview }) => {
      const scene = window.__movie3d.scene;
      scene.enableManualClock();
      window.__movie3d.show(tick, false);
      scene.advance(1.5);
      if (overview) {
        scene.setCameraMode("overview");
        scene.advance(12);
        return;
      }
      scene.setFov(24);
      scene.lookFrom({ x: cx, y: height, z: cz + 0.1 }, { x: cx, y: 0, z: cz });
      scene.advance(0.2);
    },
    { tick, cx, cz, height, overview },
  );
  const file = path.join(work, `${index}.png`);
  await canvas.screenshot({ path: file });
  shots.push([file, label]);
  await page.close();
}
await browser.close();

const out = path.resolve("public", `${name}.png`);
const montage = `
import json, sys
from PIL import Image, ImageDraw, ImageFont
shots, out, mode = json.loads(sys.argv[1]), sys.argv[2], sys.argv[3]
try: font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 28)
except OSError: font = ImageFont.load_default()
images = [Image.open(f).convert("RGB") for f, _ in shots]
w, h = images[0].size
if mode == "full":
    cw, ch, box = w, h, (0, 0, w, h)
else:
    cw, ch = min(760, w), min(480, h - 60)
    box = ((w - cw) // 2, (h - ch) // 2 + 30, (w + cw) // 2, (h + ch) // 2 + 30)
gap, label = 10, 44
sheet = Image.new("RGB", (cw * len(images) + gap * (len(images) - 1), ch + label), (14, 16, 18))
draw = ImageDraw.Draw(sheet)
for i, (image, (_, text)) in enumerate(zip(images, shots)):
    x = i * (cw + gap)
    sheet.paste(image.crop(box), (x, label))
    draw.text((x + 10, 6), text, fill=(220, 220, 220) if i == 0 else (190, 240, 120), font=font)
sheet.save(out)
`;
execFileSync(
  "python",
  ["-I", "-c", montage, JSON.stringify(shots), out, overview ? "full" : "crop"],
  {
    stdio: "inherit",
  },
);
fs.rmSync(work, { recursive: true, force: true });
console.log(`http://localhost:3000/${name}.png`);
