"""Export reverse-engineered RoboSport data tables to JSON.

Reads ROBO.EXE (NE/Win16) DGROUP data segment and the *.TWN resource files,
emits docs/extracted/robosport-data.json.

Run from the ROBOWIN directory that contains ROBO.EXE and RUBBLE.TWN etc:
    python export_data.py <path-to-ROBOWIN-dir> <out.json>

All offsets are documented in docs/reverse-engineering.md.
"""
import struct, sys, json, os, math

def load(path):
    return open(path, 'rb').read()

# ── ROBO.EXE DGROUP (data segment) base ──────────────────────────────────────
# seg 101 is the sole DATA segment; its file image maps to DS:0 (DGROUP).
DGROUP_FILE_BASE = 0x07D600

def dg_u8(d, off, n):  return [d[DGROUP_FILE_BASE + off + i] for i in range(n)]
def dg_u16(d, off, n): return [struct.unpack_from('<H', d, DGROUP_FILE_BASE + off + i*2)[0] for i in range(n)]
def dg_s16(d, off, n): return [struct.unpack_from('<h', d, DGROUP_FILE_BASE + off + i*2)[0] for i in range(n)]

# ── TWN chunk reader ─────────────────────────────────────────────────────────
def twn_chunks(d):
    off = 32
    while off + 26 <= len(d):
        tag = d[off:off+4].rstrip(b'\0').decode('ascii', 'replace')
        cid = struct.unpack_from('<H', d, off+4)[0]
        size = struct.unpack_from('<I', d, off+22)[0]
        yield tag, cid, d[off+26:off+size]
        off += size

TERRAIN_CLASS = {
    (2, 2, 0, 0):  "open",
    (2, 1, 0, 0):  "rough",
    (2, 1, 1, 0):  "bush",
    (3, 1, 1, 0):  "low_wall",
    (4, 0, 2, 0):  "wall",
    (2, 0, 0, 0):  "crevice",
    (2, 2, 0, 15): "special",   # uniform tileset 315; fence/home candidate
}

def extract_town(d):
    tils, maps, inf = {}, {}, None
    for tag, cid, body in twn_chunks(d):
        if tag == 'TIL':
            tils[cid - 300] = [tuple(body[i*4:i*4+4]) for i in range(16)]
        elif tag == 'MAP':
            maps[cid] = body
        elif tag == 'INF':
            inf = body
    nmaps = struct.unpack_from('<H', inf, 0)[0]
    widths  = list(inf[0x22:0x22+8])
    heights = list(inf[0x32:0x32+8])
    names = []
    p = 0x52
    for _ in range(16):
        names.append(inf[p:p+14].split(b'\0')[0].decode('ascii', 'replace'))
        p += 22
    out = []
    for cid in sorted(maps):
        w, h = widths[cid], heights[cid]
        body = maps[cid]
        if w * h != len(body):
            continue
        grid = []
        for y in range(h):
            row = []
            for x in range(w):
                b = body[y*w + x]
                props = tils[b >> 4][b & 0xF]
                row.append(TERRAIN_CLASS.get(props, "unknown"))
            grid.append(row)
        out.append({"id": cid, "name": names[cid], "width": w, "height": h, "terrain": grid})
    return out

def main():
    robowin = sys.argv[1] if len(sys.argv) > 1 else '.'
    out_path = sys.argv[2] if len(sys.argv) > 2 else 'robosport-data.json'
    exe = load(os.path.join(robowin, 'ROBO.EXE'))

    # Robot class stats: DGROUP 0x0CA8, 5 classes x 4 bytes [accTier, armor, col2, col3]
    raw = dg_u8(exe, 0x0CA8, 20)
    classes = ["rifle", "burst", "auto", "missile", "stealth"]
    robot_stats = {}
    for i, name in enumerate(classes):
        a, armor, c2, c3 = raw[i*4:i*4+4]
        robot_stats[name] = {"accuracy_tier": a, "armor": armor, "col2": c2, "col3": c3}

    # Planner/preview hit table: DGROUP 0x213A, 14 entries (index 0..13), /256 (seg96)
    hit_thresholds_preview = dg_u8(exe, 0x213A, 14)
    # accuracy tier -> base index (jump table seg96:0x09DE..)
    acc_tier_to_base = {0: 0, 1: 2, 2: 4, 3: 6, "default": 10}

    # AUTHORITATIVE fire-resolution hit table: DGROUP 0x1570, 20 words (score 0..19), /256 (seg6:0x35D1)
    # (code indexes [score*2 + 0x156E]; word[0x156E]=0 then the ramp begins at 0x1570)
    hit_thresholds_fire = [struct.unpack_from('<H', exe, DGROUP_FILE_BASE + 0x156E + i*2)[0]
                           for i in range(20)]

    # Bullet damage: rolled at FIRE time in seg6:0x35D1, stored on projectile +0x0F, applied at impact.
    #   damage = weaponRoll[slot] + postureAdjust + distanceAdjust, floored at 0 (0 => no damage).
    # Weapon jump table seg6:0x38C5 selects the roll by (robotField_0x5C - 5):
    bullet_damage = {
        "_where": "seg6:0x35D1 (resolver) -> projectile +0x0F -> seg6:0x5A2B (apply)",
        "weapon_rolls_by_slot": {
            "0": {"expr": "(rand&7)+10",  "min": 10, "max": 17},
            "1": {"expr": "(rand&7)+10",  "min": 10, "max": 17},
            "2": {"expr": "0", "min": 0, "max": 0, "note": "explosive: damage handled by blast"},
            "3": {"expr": "(rand&0xF)+8", "min": 8,  "max": 23},
            "4": {"expr": "(rand&0xF)+8", "min": 8,  "max": 23},
            "5": {"expr": "0", "min": 0, "max": 0, "note": "explosive: damage handled by blast"},
            "6": {"expr": "(rand&0xF)+6", "min": 6,  "max": 21},
            "7": {"expr": "(rand&0xF)+6", "min": 6,  "max": 21},
        },
        "posture_adjust_by_class": {"1": -4, "2": 0, "3": 0, "4": +4},   # seg6:0x38BD, class = seg87:0x1BF8 output
        "distance_adjust": {"lt5": +4, "gt12": -4},                     # dist<5 => +4, dist>12 => -4
        "floor": "if result < 1 => 0",
        "weapon_selector": "weapon-property lookup seg13:0x060E + kind table 0x7F4 (bullet=1/explosive=3); slot = class-5",
        "weapon_kind_table_0x7F4_col0": [1, 1, 1, 3, 1, 3, 3, 1],       # 1=direct-fire, 3=explosive
        "slot_labels_provisional": {"rifle": "10-17", "auto": "8-23", "burst": "6-21 per bullet"},
    }

    # Explosive damage tables (seg6:0x5F7E). Each category: base[i] + (rnd & mask[i]).
    def pack(mask_off, base_off, n):
        masks = dg_u16(exe, mask_off, n)
        bases = dg_u16(exe, base_off, n)
        return [{"radius": i, "base": bases[i], "mask": masks[i],
                 "min": bases[i], "max": bases[i] + masks[i]} for i in range(n)]
    explosive = {
        "category0_small":  pack(0x15EE, 0x15F4, 3),   # 45-76 / 25-40 / 5-12
        "category1_missile": pack(0x15FA, 0x1600, 3),  # 60-91 / 40-55 / 10-17
        "category2_large":  pack(0x1606, 0x1610, 5),   # 120-151 ... 10-17 (radius 4)
    }
    # posture/cover reduction applied after roll (seg6:0x5FFD): idx->multiplier
    posture_mult = {"0": 1.0, "1": 0.5, "2": 0.75, "3": 0.875}

    data = {
        "_source": "RoboSport for Windows (1991), ROBO.EXE + RUBBLE/SUBURBS/COMPUTER.TWN",
        "_note": "See docs/reverse-engineering.md for byte offsets and disassembly provenance.",
        "rng": {
            "type": "16-bit-shift LFSR, xor 0xA300 on odd, two independent streams",
            "game_stream_state_dgroup": ["0x3CD8", "0x3CDA"],
            "fx_stream_state_dgroup":   ["0x3CD4", "0x3CD6"],
            "func_game": "seg55:0x0073", "func_fx": "seg55:0x00B5",
        },
        "distance_metric": {
            "kind": "floored Euclidean via precomputed isqrt table",
            "func": "seg56:0x02A0",
            "table": "32x32 byte table = floor(sqrt(dx^2+dy^2)), built at startup seg9:0x0485",
            "max_weapon_range": 18,
        },
        "robot_stats": robot_stats,
        "hit_chance_preview": {
            "_role": "planner targeting preview + AI; NOT the live fire roll",
            "func": "seg96:0x09AF",
            "table_dgroup": "0x213A",
            "thresholds_over_256": hit_thresholds_preview,
            "probabilities": [round(v/256, 4) for v in hit_thresholds_preview],
            "accuracy_tier_to_base_index": acc_tier_to_base,
            "formula": "idx = accBase + scanBonus + terrainMod + distBonus; clamp(0,13); hit = (rnd&0xFF) < table[idx]",
        },
        "hit_chance_fire": {
            "_role": "AUTHORITATIVE live fire resolution (movie playback)",
            "func": "seg6:0x35D1",
            "table_dgroup": "0x156E",
            "thresholds_over_256": hit_thresholds_fire,
            "probabilities": [round(v/256, 4) for v in hit_thresholds_fire],
            "score_range": [0, 19],
            "formula": ("score = (accTier+4)-based init by cover class {1:4,2:8,3:12,4:18} "
                        "+ distance weighting + target-terrain add + weapon add(0x1596) "
                        "- posture penalty; clamp(0,19); hit = (rnd&0xFF) < table[score]"),
        },
        "bullet_damage": bullet_damage,
        "explosive_damage": explosive,
        "explosive_posture_multiplier": posture_mult,
        "arenas": {},
    }

    for fn, key in [("RUBBLE.TWN", "rubble"), ("SUBURBS.TWN", "suburbs"), ("COMPUTER.TWN", "computer")]:
        p = os.path.join(robowin, fn)
        if os.path.exists(p):
            data["arenas"][key] = extract_town(load(p))

    with open(out_path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"wrote {out_path}")
    print("robot_stats:", json.dumps(robot_stats, indent=2))
    print("preview hit thresholds/256:", hit_thresholds_preview)
    print("live-fire hit thresholds/256:", hit_thresholds_fire)

if __name__ == '__main__':
    main()
