"""Find ALL callers of a target seg:offset in an NE executable.

Handles the three ways one function reaches another in Win16 NE:
  1. near call (E8 rel16) within the same segment  -- not relocated
  2. far call (9A seg:off) to a *fixed* segment      -- reloc type INTERNALREF, t1=segno
  3. far call through a *movable* entry-table slot   -- reloc t1=0xFF, t2=ordinal

Usage:
  xref.py ROBO.EXE callers <seg> <offset-hex>
  xref.py ROBO.EXE entry   <seg> <offset-hex>   # just show the movable-entry ordinal, if any
"""
import struct, sys
from iced_x86 import Decoder

def load_ne(path):
    data = open(path, 'rb').read()
    ne = struct.unpack_from('<I', data, 0x3C)[0]
    cseg = struct.unpack_from('<H', data, ne + 0x1C)[0]
    segtab = struct.unpack_from('<H', data, ne + 0x22)[0]
    entrytab = struct.unpack_from('<H', data, ne + 0x04)[0]     # offset of entry table (rel to NE)
    entrylen = struct.unpack_from('<H', data, ne + 0x06)[0]
    align = struct.unpack_from('<H', data, ne + 0x32)[0] or 9
    SEG = {}
    for i in range(cseg):
        o = ne + segtab + i * 8
        sec, ln, fl, ma = struct.unpack_from('<HHHH', data, o)
        SEG[i + 1] = (sec << align, ln or 65536, fl)
    return data, ne, SEG, entrytab, entrylen

def parse_entry_table(data, ne, entrytab, entrylen):
    """Return {ordinal: (segno, offset)} for movable + fixed entries."""
    out = {}
    p = ne + entrytab
    end = p + entrylen
    ordinal = 1
    while p < end:
        cnt = data[p]; seg_ind = data[p + 1]; p += 2
        if cnt == 0:
            break
        if seg_ind == 0x00:      # unused bundle: skip `cnt` ordinals
            ordinal += cnt
            continue
        if seg_ind == 0xFF:      # movable entries: 6 bytes each (flags, INT3F, segno, offset)
            for _ in range(cnt):
                flags = data[p]; segno = data[p + 3]
                off = struct.unpack_from('<H', data, p + 4)[0]
                out[ordinal] = (segno, off); ordinal += 1; p += 6
        else:                    # fixed entries: 3 bytes each (flags, offset) in segment seg_ind
            for _ in range(cnt):
                off = struct.unpack_from('<H', data, p + 1)[0]
                out[ordinal] = (seg_ind, off); ordinal += 1; p += 3
    return out

def relocs(data, SEG, segno):
    fofs, length, flags = SEG[segno]
    if not (flags & 0x100):
        return []
    p = fofs + length
    cnt = struct.unpack_from('<H', data, p)[0]; p += 2
    out = []
    for _ in range(cnt):
        a, rt, off, t1, t2 = struct.unpack_from('<BBHHH', data, p); p += 8
        out.append((off, a, rt & 3, t1, t2))
    return out

def main():
    path = sys.argv[1]; cmd = sys.argv[2]
    tseg = int(sys.argv[3]); toff = int(sys.argv[4], 16)
    data, ne, SEG, entrytab, entrylen = load_ne(path)
    entries = parse_entry_table(data, ne, entrytab, entrylen)
    ord_for = {v: k for k, v in entries.items()}
    my_ord = ord_for.get((tseg, toff))

    if cmd == 'entry':
        print(f"seg{tseg}:0x{toff:04X} movable-entry ordinal = {my_ord}")
        return

    print(f"target seg{tseg}:0x{toff:04X}  (movable-entry ordinal: {my_ord})")
    hits = 0
    for segno, (fofs, length, flags) in SEG.items():
        if flags & 1:  # DATA
            continue
        rl = relocs(data, SEG, segno)
        # far calls (fixed + movable)
        for off, a, rt, t1, t2 in rl:
            if rt == 0 and t1 == tseg and t2 == toff:
                print(f"  FAR-fixed   from seg{segno}:reloc@0x{off:04X}"); hits += 1
            elif rt == 0 and t1 == 0xFF and my_ord is not None and t2 == my_ord:
                print(f"  FAR-movable from seg{segno}:reloc@0x{off:04X} (ordinal {my_ord})"); hits += 1
        # near calls within this segment (only meaningful if segno==tseg)
        if segno == tseg:
            code = data[fofs:fofs+length]
            for ins in Decoder(16, code, ip=0):
                b = code[ins.ip:ins.ip+ins.len]
                if b and b[0] == 0xE8 and ins.len == 3:
                    rel = struct.unpack_from('<h', b, 1)[0]
                    if ((ins.ip + 3 + rel) & 0xFFFF) == toff:
                        print(f"  NEAR        from seg{segno}:0x{ins.ip:04X}"); hits += 1
    if not hits:
        print("  (no callers found)")

if __name__ == '__main__':
    main()
