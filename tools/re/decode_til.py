"""Decode TIL property tables and cross-reference MAP cells.

Map byte hypothesis: high nibble = tile-set index (TIL 300+hi), low nibble = variant.
TIL body = 16 variants x 4 bytes of properties.
"""
import sys, struct

def chunks_of(path):
    data = open(path, 'rb').read()
    off = 32
    while off + 26 <= len(data):
        tag = data[off:off+4].rstrip(b'\0').decode('ascii', 'replace')
        cid = struct.unpack_from('<H', data, off+4)[0]
        size = struct.unpack_from('<I', data, off+22)[0]
        yield tag, cid, data[off+26:off+size]
        off += size

path = sys.argv[1]
tils = {}
maps = {}
for tag, cid, body in chunks_of(path):
    if tag == 'TIL':
        tils[cid - 300] = [tuple(body[i*4:i*4+4]) for i in range(16)]
    elif tag == 'MAP':
        maps[cid] = body

print("TIL property tables (tileset -> 16 variants of 4 bytes):")
for t in sorted(tils):
    print(f"  set {t:2} (TIL {t+300}):")
    for v, props in enumerate(tils[t]):
        print(f"     v{v:2X}: {props}")

# distinct property tuples across all sets
from collections import Counter
c = Counter()
for t, vs in tils.items():
    for props in vs:
        c[props] += 1
print("\ndistinct property tuples:", len(c))
for props, n in c.most_common():
    print(f"   {props}  x{n}")

# check known cells in map id=2 (32x32, believed Rubble Three)
if 2 in maps:
    grid = maps[2]
    w = 32
    print("\nmap id=2 row y=11 (x: byte hi/lo -> props):")
    for x in range(32):
        b = grid[11*w + x]
        hi, lo = b >> 4, b & 0xF
        props = tils.get(hi, [None]*16)[lo]
        print(f"   x={x:2}  byte=0x{b:02X} set={hi:2} var={lo:2X} props={props}")
