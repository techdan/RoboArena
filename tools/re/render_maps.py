"""Render all MAP chunks of a .TWN as terrain-class ASCII grids."""
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

CLASS = {
    (4, 0, 2, 0): 'W',   # wall
    (3, 1, 1, 0): 'L',   # low wall
    (2, 1, 1, 0): 'B',   # bush
    (2, 1, 0, 0): 'R',   # rough
    (2, 0, 0, 0): 'C',   # crevice
    (2, 2, 0, 0): '.',   # open
    (2, 2, 0, 15): 'H',  # special set-15
}

# map dims from INF: (w,h) per id
DIMS = {}

path = sys.argv[1]
tils, maps, inf = {}, {}, None
for tag, cid, body in chunks_of(path):
    if tag == 'TIL':
        tils[cid - 300] = [tuple(body[i*4:i*4+4]) for i in range(16)]
    elif tag == 'MAP':
        maps[cid] = body
    elif tag == 'INF':
        inf = body

nmaps = struct.unpack_from('<H', inf, 0)[0]
ws = list(inf[0x22:0x22+8])
hs = list(inf[0x32:0x32+8])
names = []
# name records start at 0x52, stride appears to be 14+8=22 bytes
off = 0x52
for i in range(16):
    nm = inf[off:off+14].split(b'\0')[0].decode('ascii', 'replace')
    names.append(nm)
    off += 22
print("num maps:", nmaps, "widths:", ws, "heights:", hs)
print("names:", names[:8])

only = int(sys.argv[2]) if len(sys.argv) > 2 else None
for cid in sorted(maps):
    if only is not None and cid != only:
        continue
    body = maps[cid]
    w, h = ws[cid], hs[cid]
    assert w * h == len(body), (cid, w, h, len(body))
    print(f"\n=== MAP {cid}: {names[cid]!r} {w}x{h}")
    header = '    ' + ''.join(str(x % 10) for x in range(w))
    print(header)
    for y in range(h):
        row = body[y*w:(y+1)*w]
        s = ''.join(CLASS.get(tils[b >> 4][b & 0xF], '?') for b in row)
        print(f"{y:3} {s}")
