"""⚠️  THROWAWAY SPIKE — NOT PRODUCTION CODE ⚠️

Offline board compositor — renders exactly what the demo page renders.

Ground, then structures/props in the demo's painter order (row ascending, then
column DESCENDING, because the oblique cap is displaced up-and-right so west is
nearer). Lets a defect be inspected at full bake resolution without a browser.

Usage: python compose.py [x0 y0 x1 y1]   (tile bounds, optional crop)
"""
import json, sys, os
from PIL import Image

ROOT = "C:/src/DevProjects/RoboArena"
ARENA = "rubble-two"
SRC = f"{ROOT}/public/spike/terrain/{ARENA}"
OUT = "C:/Users/manhe/AppData/Local/Temp/claude/C--src-DevProjects-RoboArena/78dae72d-4c48-41ab-9ada-1c6833286e98/scratchpad"

m = json.load(open(f"{SRC}/manifest.json"))
T = m["tilePx"]
board = Image.open(f"{SRC}/ground-lit.png").convert("RGBA")

cache = {}
def tex(name):
    if name not in cache:
        cache[name] = Image.open(f"{SRC}/{name}-lit.png").convert("RGBA")
    return cache[name]

placements = sorted(m["placements"], key=lambda p: (p["ty"], -p["tx"]))
for p in placements:
    if p["kind"] == "structure":
        im = tex(p["piece"])
        x = p["tx"] * T
        y = int(round((p["ty"] - p.get("lift", 0)) * T))
    else:
        im = tex(f'{p["kind"]}-{p.get("variant", 0)}')
        size = im.width
        cx = (p["tx"] + 0.5 + p.get("dx", 0)) * T
        cy = (p["ty"] + 0.5 + p.get("dy", 0)) * T
        x = int(round(cx - size / 2)); y = int(round(cy - size / 2))
    board.alpha_composite(im, (x, y))

if len(sys.argv) == 5:
    x0, y0, x1, y1 = (int(v) for v in sys.argv[1:5])
    board = board.crop((x0 * T, y0 * T, x1 * T, y1 * T))
    board = board.resize((board.width * 2, board.height * 2), Image.NEAREST)
    name = f"board_{x0}_{y0}.png"
else:
    name = "board_full.png"
board.save(os.path.join(OUT, name))
print("wrote", name, board.size)
