"""Disassemble NE code segments; find immediates & patterns.

Usage:
  disasm.py ROBO.EXE imm 634 641        # find pushes/movs/cmps with these immediates
  disasm.py ROBO.EXE ctx <seg> <off> N  # print N instrs around seg:off
  disasm.py ROBO.EXE bytes AABBCC       # find raw byte pattern in code segs
"""
import struct, sys
from iced_x86 import Decoder, Formatter, FormatterSyntax, OpKind

data = open(sys.argv[1], 'rb').read()
ne = struct.unpack_from('<I', data, 0x3C)[0]
(cseg,) = struct.unpack_from('<H', data, ne + 0x1C)
(segtab_off,) = struct.unpack_from('<H', data, ne + 0x22)
(align,) = struct.unpack_from('<H', data, ne + 0x32)
shift = align or 9

SEGS = []
for i in range(cseg):
    off = ne + segtab_off + i * 8
    sector, length, flags, minalloc = struct.unpack_from('<HHHH', data, off)
    fofs = sector << shift
    if not (flags & 1):  # CODE
        SEGS.append((i + 1, fofs, length or 65536))

fmt = Formatter(FormatterSyntax.NASM)

def disasm_seg(segno, fofs, length):
    code = data[fofs:fofs + length]
    dec = Decoder(16, code, ip=0)
    out = []
    for ins in dec:
        out.append(ins)
    return out

cmd = sys.argv[2]
if cmd == 'imm':
    targets = set(int(x, 0) for x in sys.argv[3:])
    for segno, fofs, length in SEGS:
        for ins in disasm_seg(segno, fofs, length):
            hit = False
            for i in range(ins.op_count):
                k = ins.op_kind(i)
                if k in (OpKind.IMMEDIATE16, OpKind.IMMEDIATE8, OpKind.IMMEDIATE8TO16, OpKind.IMMEDIATE32):
                    try:
                        v = ins.immediate(i) & 0xFFFF
                    except Exception:
                        continue
                    if v in targets:
                        hit = True
            if hit:
                print(f"seg{segno:3} +0x{ins.ip:04X} (file 0x{fofs + ins.ip:06X}): {fmt.format(ins)}")
elif cmd == 'ctx':
    segno, target, n = int(sys.argv[3]), int(sys.argv[4], 0), int(sys.argv[5])
    for sn, fofs, length in SEGS:
        if sn == segno:
            instrs = disasm_seg(sn, fofs, length)
            for idx, ins in enumerate(instrs):
                if ins.ip <= target < ins.ip + ins.len:
                    lo, hi = max(0, idx - n), min(len(instrs), idx + n + 1)
                    for j in range(lo, hi):
                        mark = '>>>' if j == idx else '   '
                        print(f"{mark} +0x{instrs[j].ip:04X}: {fmt.format(instrs[j])}")
                    break
elif cmd == 'bytes':
    import re
    pat = bytes.fromhex(sys.argv[3])
    for segno, fofs, length in SEGS:
        seg = data[fofs:fofs + length]
        idx = seg.find(pat)
        while idx != -1:
            print(f"seg{segno:3} +0x{idx:04X} (file 0x{fofs + idx:06X})")
            idx = seg.find(pat, idx + 1)
