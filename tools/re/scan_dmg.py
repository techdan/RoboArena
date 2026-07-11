"""Scan all code segments for RND-driven small-integer patterns:
  call GAME_RND/FX_RND ; and ax,MASK ; (opt imul) ; add ax/dx,BASE
Report BASE/MASK so we can spot weapon-damage rolls (e.g. base 18 mask 7)."""
import struct
from iced_x86 import Decoder, Formatter, FormatterSyntax, Mnemonic, Register, OpKind

data = open('ROBO.EXE','rb').read()
ne = struct.unpack_from('<I', data, 0x3C)[0]
(cseg,) = struct.unpack_from('<H', data, ne+0x1C)
(segtab,) = struct.unpack_from('<H', data, ne+0x22)
(align,) = struct.unpack_from('<H', data, ne+0x32); shift=align or 9
SEG={}
for i in range(cseg):
    o=ne+segtab+i*8
    sec,ln,fl,ma=struct.unpack_from('<HHHH',data,o)
    SEG[i+1]=(sec<<shift, ln or 65536, fl)

def relocs(segno):
    fofs,length,flags=SEG[segno]
    if not (flags&0x100): return {}
    p=fofs+length; (cnt,)=struct.unpack_from('<H',data,p); p+=2; out={}
    for _ in range(cnt):
        a,rt,off,t1,t2=struct.unpack_from('<BBHHH',data,p); p+=8; out[off]=(a,rt&3,t1,t2)
    return out

fmt=Formatter(FormatterSyntax.NASM)
RNG={(55,0x0073):'G',(55,0x00B5):'F'}
for segno,(fofs,length,flags) in SEG.items():
    if flags&1: continue
    rl=relocs(segno)
    code=data[fofs:fofs+length]
    instrs=list(Decoder(16,code,ip=0))
    for i,ins in enumerate(instrs):
        # is this a far call to RNG?
        isrng=False
        for b in range(ins.len):
            if ins.ip+b in rl:
                a,rt,t1,t2=rl[ins.ip+b]
                if rt==0 and (t1,t2) in RNG: isrng=True; tag=RNG[(t1,t2)]
        if not isrng: continue
        # look at next few instrs for AND then ADD
        mask=basev=None
        window=instrs[i+1:i+8]
        parts=[]
        for w in window:
            m=w.mnemonic
            if m==Mnemonic.AND and w.op_count>=2 and w.op_kind(1) in (OpKind.IMMEDIATE8,OpKind.IMMEDIATE16,OpKind.IMMEDIATE8TO16):
                mask=w.immediate(1)&0xFFFF
            if m==Mnemonic.ADD and w.op_count>=2 and w.op_kind(1) in (OpKind.IMMEDIATE8,OpKind.IMMEDIATE16,OpKind.IMMEDIATE8TO16):
                basev=w.immediate(1)&0xFFFF
            parts.append(fmt.format(w))
            if basev is not None: break
        if mask is not None:
            rng_lo=basev if basev else 0
            rng_hi=(basev or 0)+mask
            print(f"seg{segno:3} +0x{ins.ip:04X} [{tag}] mask={mask} base={basev}  -> {rng_lo}..{rng_hi}   | {' ; '.join(parts[:4])}")
