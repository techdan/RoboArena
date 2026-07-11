"""Dump disassembly context around every call to the game RNG seg55:0x0073 (and 0x00B5)."""
import struct, sys
from iced_x86 import Decoder, Formatter, FormatterSyntax

data = open(sys.argv[1], 'rb').read()
ne = struct.unpack_from('<I', data, 0x3C)[0]
(cseg,) = struct.unpack_from('<H', data, ne + 0x1C)
(segtab_off,) = struct.unpack_from('<H', data, ne + 0x22)
(align,) = struct.unpack_from('<H', data, ne + 0x32)
(modref_off,) = struct.unpack_from('<H', data, ne + 0x28)
(impname_off,) = struct.unpack_from('<H', data, ne + 0x2A)
(modref_cnt,) = struct.unpack_from('<H', data, ne + 0x1E)
shift = align or 9
modnames = {}
for i in range(modref_cnt):
    (noff,) = struct.unpack_from('<H', data, ne + modref_off + i * 2)
    p = ne + impname_off + noff
    ln = data[p]
    modnames[i + 1] = data[p+1:p+1+ln].decode('ascii', 'replace')

SEG = {}
for i in range(cseg):
    off = ne + segtab_off + i * 8
    sector, length, flags, minalloc = struct.unpack_from('<HHHH', data, off)
    SEG[i + 1] = (sector << shift, length or 65536, flags)

def relocs(segno):
    fofs, length, flags = SEG[segno]
    if not (flags & 0x100):
        return {}
    p = fofs + length
    (cnt,) = struct.unpack_from('<H', data, p)
    p += 2
    out = {}
    for _ in range(cnt):
        atype, rtype, off, t1, t2 = struct.unpack_from('<BBHHH', data, p)
        p += 8
        out[off] = (atype, rtype & 3, t1, t2)
    return out

def tstr(a, rt, t1, t2):
    if rt == 0:
        return f"seg{t1}:0x{t2:04X}" if t1 != 0xFF else f"entry#{t2}"
    if rt == 1:
        return f"{modnames.get(t1,'?')}.{t2}"
    if rt == 2:
        p = ne + impname_off + t2
        ln = data[p]
        return f"{modnames.get(t1,'?')}.{data[p+1:p+1+ln].decode('ascii','replace')}"
    return "fix"

fmt = Formatter(FormatterSyntax.NASM)
TARGETS = {(55, 0x0073): 'GAME_RND', (55, 0x00B5): 'FX_RND'}
BEFORE, AFTER = int(sys.argv[2]) if len(sys.argv) > 2 else 12, int(sys.argv[3]) if len(sys.argv) > 3 else 18

for segno in sorted(SEG):
    fofs, length, flags = SEG[segno]
    if flags & 1:
        continue
    rl = relocs(segno)
    sites = [off for off, (a, rt, t1, t2) in rl.items() if rt == 0 and (t1, t2) in TARGETS]
    if not sites:
        continue
    instrs = list(Decoder(16, data[fofs:fofs+length], ip=0))
    ipidx = {ins.ip: i for i, ins in enumerate(instrs)}
    for off in sorted(sites):
        # reloc offset points at the addr operand (call op starts 1 byte earlier for 9A far call)
        call_ip = off - 1
        idx = ipidx.get(call_ip)
        if idx is None:
            # search containing instruction
            for i, ins in enumerate(instrs):
                if ins.ip <= call_ip < ins.ip + ins.len:
                    idx = i
                    break
        a, rt, t1, t2 = rl[off]
        print(f"\n### {TARGETS[(t1, t2)]} call in seg{segno} at +0x{instrs[idx].ip:04X} (file 0x{fofs+instrs[idx].ip:06X})")
        lo, hi = max(0, idx - BEFORE), min(len(instrs), idx + AFTER + 1)
        for j in range(lo, hi):
            ins = instrs[j]
            note = ''
            for b in range(ins.len):
                if ins.ip + b in rl:
                    aa, rr, tt1, tt2 = rl[ins.ip + b]
                    note = f"   ; -> {tstr(aa, rr, tt1, tt2)}"
            mark = '>>>' if j == idx else '   '
            print(f"{mark} +0x{ins.ip:04X}: {fmt.format(ins)}{note}")
