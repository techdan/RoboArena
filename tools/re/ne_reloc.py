"""NE relocation-aware analysis helpers.

Commands:
  callto <seg> <off>      list call sites whose far-call target = seg:off (off hex)
  relocs <seg>            dump relocations for a segment
  ctxr <seg> <off> <n>    disasm context with far-calls resolved
  funcs <seg>             list function starts (push bp/inc bp heuristics)
"""
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

# module names for imports
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

def target_str(atype, rt, t1, t2):
    if rt == 0:  # internal ref
        if t1 == 0xFF:
            return f"movable-entry#{t2}"
        return f"seg{t1}:0x{t2:04X}"
    elif rt == 1:
        return f"{modnames.get(t1,'?')}.ord{t2}"
    elif rt == 2:
        nm_p = ne + impname_off + t2
        ln = data[nm_p]
        return f"{modnames.get(t1,'?')}.{data[nm_p+1:nm_p+1+ln].decode('ascii','replace')}"
    return "osfixup"

fmt = Formatter(FormatterSyntax.NASM)

def disasm(segno):
    fofs, length, flags = SEG[segno]
    return list(Decoder(16, data[fofs:fofs+length], ip=0))

cmd = sys.argv[2]
if cmd == 'relocs':
    segno = int(sys.argv[3])
    for off, (a, rt, t1, t2) in sorted(relocs(segno).items()):
        print(f"  +0x{off:04X}: {target_str(a, rt, t1, t2)}")
elif cmd == 'callto':
    tseg, toff = int(sys.argv[3]), int(sys.argv[4], 16)
    for segno, (fofs, length, flags) in SEG.items():
        if flags & 1:
            continue
        for off, (a, rt, t1, t2) in relocs(segno).items():
            if rt == 0 and t1 == tseg and t2 == toff:
                print(f"  seg{segno} reloc at +0x{off:04X}")
elif cmd == 'ctxr':
    segno, target, n = int(sys.argv[3]), int(sys.argv[4], 0), int(sys.argv[5])
    rl = relocs(segno)
    instrs = disasm(segno)
    for idx, ins in enumerate(instrs):
        if ins.ip <= target < ins.ip + ins.len:
            lo, hi = max(0, idx - n), min(len(instrs), idx + n + 1)
            for j in range(lo, hi):
                ins2 = instrs[j]
                txt = fmt.format(ins2)
                # far call/jmp/mov seg ref: reloc applies at ip+1 (call) or +3 etc; check all bytes
                note = ''
                for b in range(ins2.len):
                    if ins2.ip + b in rl:
                        a, rt, t1, t2 = rl[ins2.ip + b]
                        note = f"   ; -> {target_str(a, rt, t1, t2)}"
                mark = '>>>' if j == idx else '   '
                print(f"{mark} +0x{ins2.ip:04X}: {txt}{note}")
            break
elif cmd == 'xrefstats':
    # count internal call targets across all segments
    from collections import Counter
    c = Counter()
    for segno, (fofs, length, flags) in SEG.items():
        if flags & 1:
            continue
        for off, (a, rt, t1, t2) in relocs(segno).items():
            if rt == 0 and t1 != 0xFF:
                c[(t1, t2)] += 1
    for (t1, t2), n in c.most_common(60):
        print(f"  seg{t1}:0x{t2:04X}  x{n}")
