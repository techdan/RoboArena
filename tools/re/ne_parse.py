"""Parse NE (Win16) header of ROBO.EXE: segments + resources."""
import struct, sys

data = open(sys.argv[1], 'rb').read()
ne_off = struct.unpack_from('<I', data, 0x3C)[0]
assert data[ne_off:ne_off+2] == b'NE', data[ne_off:ne_off+2]
(cseg,) = struct.unpack_from('<H', data, ne_off + 0x1C)
(segtab_off,) = struct.unpack_from('<H', data, ne_off + 0x22)
(restab_off,) = struct.unpack_from('<H', data, ne_off + 0x24)
(align,) = struct.unpack_from('<H', data, ne_off + 0x32)
(autodata,) = struct.unpack_from('<H', data, ne_off + 0x0E)
print(f"NE at 0x{ne_off:X}, {cseg} segments, align shift {align}, autodata seg #{autodata}")
shift = align or 9
for i in range(cseg):
    off = ne_off + segtab_off + i * 8
    sector, length, flags, minalloc = struct.unpack_from('<HHHH', data, off)
    fofs = sector << shift
    kind = 'DATA' if flags & 1 else 'CODE'
    print(f"  seg {i+1:2}: file 0x{fofs:06X}..0x{fofs + (length or 65536):06X} len {length or 65536:6} {kind} flags=0x{flags:04X} minalloc={minalloc or 65536}")

# resource table
rt = ne_off + restab_off
(shift_res,) = struct.unpack_from('<H', data, rt)
print(f"\nresources (align shift {shift_res}):")
p = rt + 2
while True:
    (type_id,) = struct.unpack_from('<H', data, p)
    if type_id == 0:
        break
    (count,) = struct.unpack_from('<H', data, p + 2)
    if type_id & 0x8000:
        tname = f"#{type_id & 0x7FFF}"
    else:
        ln = data[rt + type_id]
        tname = data[rt + type_id + 1: rt + type_id + 1 + ln].decode('ascii', 'replace')
    p += 8
    entries = []
    for j in range(count):
        s_off, s_len, s_flags, s_id = struct.unpack_from('<HHHH', data, p)
        if s_id & 0x8000:
            rname = f"#{s_id & 0x7FFF}"
        else:
            ln = data[rt + s_id]
            rname = data[rt + s_id + 1: rt + s_id + 1 + ln].decode('ascii', 'replace')
        entries.append((s_off << shift_res, s_len << shift_res, rname))
        p += 12
    print(f"  type {tname}: {count} items")
    for fo, ln, rn in entries[:40]:
        print(f"     file 0x{fo:06X} len {ln:6} name={rn}")
