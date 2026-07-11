"""Dump RT_STRING (6), RT_DIALOG (5), RT_MENU (4) resources from a NE exe."""
import struct, sys

data = open(sys.argv[1], 'rb').read()
ne = struct.unpack_from('<I', data, 0x3C)[0]
(restab_off,) = struct.unpack_from('<H', data, ne + 0x24)
rt = ne + restab_off
(shift,) = struct.unpack_from('<H', data, rt)

res = {}
p = rt + 2
while True:
    (tid,) = struct.unpack_from('<H', data, p)
    if tid == 0:
        break
    (cnt,) = struct.unpack_from('<H', data, p + 2)
    p += 8
    for j in range(cnt):
        so, sl, sf, sid = struct.unpack_from('<HHHH', data, p)
        res.setdefault(tid & 0x7FFF, []).append((sid & 0x7FFF, so << shift, sl << shift))
        p += 12

def cstrings(blob):
    out, cur = [], []
    for b in blob:
        if b == 0:
            if cur:
                out.append(bytes(cur).decode('cp1252', 'replace'))
                cur = []
        elif 9 <= b < 256:
            cur.append(b)
    if cur:
        out.append(bytes(cur).decode('cp1252', 'replace'))
    return out

what = sys.argv[2] if len(sys.argv) > 2 else 'strings'

if what == 'strings':
    for sid, off, ln in sorted(res.get(6, [])):
        blob = data[off:off+ln]
        base = (sid - 1) * 16
        p2 = 0
        for i in range(16):
            if p2 >= len(blob):
                break
            sl2 = blob[p2]
            s = blob[p2+1:p2+1+sl2].decode('cp1252', 'replace')
            if s:
                print(f"STR {base + i:5}: {s}")
            p2 += 1 + sl2
elif what == 'dialogs':
    for sid, off, ln in sorted(res.get(5, [])):
        blob = data[off:off+ln]
        strs = cstrings(blob)
        print(f"DLG #{sid}: {' | '.join(s for s in strs if len(s) > 1)}")
elif what == 'menus':
    for sid, off, ln in sorted(res.get(4, [])):
        blob = data[off:off+ln]
        strs = cstrings(blob)
        print(f"MENU #{sid}: {' | '.join(s for s in strs if len(s) > 1)}")
