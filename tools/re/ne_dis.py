"""Relocation-aware NE disassembler (2026-10-15 extraction pass; see docs/re-map/).

Follows chained relocations and movable-entry (0xFF) far calls, so every
cross-segment call prints its segN:0xOFF or MODULE.ordN target.

Usage:
  ne_dis.py ROBO.EXE d <seg> <start-hex> <end-hex>    # disassemble a range
  ne_dis.py ROBO.EXE jt <seg> <off-hex> <n> [base]    # dump a near jump table
  ne_dis.py ROBO.EXE callers seg6:0x1DCE              # far callers of a target
  ne_dis.py ROBO.EXE segcallers <seg>                 # far callers into a segment
  ne_dis.py ROBO.EXE dumpall <outdir>                 # whole-binary listing, one file per segment
"""
import struct, sys
from iced_x86 import Decoder, Formatter, FormatterSyntax, Mnemonic, FlowControl
data=open(sys.argv[1],'rb').read()
ne=struct.unpack_from('<I',data,0x3C)[0]
cseg=struct.unpack_from('<H',data,ne+0x1C)[0]
segtab=struct.unpack_from('<H',data,ne+0x22)[0]
align=struct.unpack_from('<H',data,ne+0x32)[0] or 9
modref_off=struct.unpack_from('<H',data,ne+0x28)[0]
impname_off=struct.unpack_from('<H',data,ne+0x2A)[0]
modref_cnt=struct.unpack_from('<H',data,ne+0x1E)[0]
entrytab=struct.unpack_from('<H',data,ne+4)[0]; entrylen=struct.unpack_from('<H',data,ne+6)[0]
SEG={}
for i in range(cseg):
    o=ne+segtab+i*8; sec,ln,fl,ma=struct.unpack_from('<HHHH',data,o); SEG[i+1]=(sec<<align, ln or 65536, fl)
modnames={}
for i in range(modref_cnt):
    noff=struct.unpack_from('<H',data,ne+modref_off+i*2)[0]; p=ne+impname_off+noff; modnames[i+1]=data[p+1:p+1+data[p]].decode()
ENT={}
p=ne+entrytab; end=p+entrylen; o=1
while p<end:
    cnt=data[p]; si=data[p+1]; p+=2
    if cnt==0: break
    if si==0: o+=cnt; continue
    if si==0xFF:
        for _ in range(cnt): ENT[o]=(data[p+3],struct.unpack_from('<H',data,p+4)[0]); o+=1; p+=6
    else:
        for _ in range(cnt): ENT[o]=(si,struct.unpack_from('<H',data,p+1)[0]); o+=1; p+=3
RC={}
def relocs(s):
    if s in RC: return RC[s]
    fofs,length,fl=SEG[s]; out={}
    if fl&0x100:
        p=fofs+length; cnt=struct.unpack_from('<H',data,p)[0]; p+=2
        for _ in range(cnt):
            a,rt,off,t1,t2=struct.unpack_from('<BBHHH',data,p); p+=8
            if rt&3==0:
                tgt = (f"seg{ENT[t2][0]}:0x{ENT[t2][1]:04X}" if t1==0xFF else f"seg{t1}:0x{t2:04X}")
            elif rt&3==1: tgt=f"{modnames.get(t1)}.ord{t2}"
            elif rt&3==2:
                q=ne+impname_off+t2; tgt=f"{modnames.get(t1)}.{data[q+1:q+1+data[q]].decode()}"
            else: tgt='os'
            # follow chain unless additive
            cur=off; n=0
            while True:
                out[cur]=tgt
                if rt&4: break
                nxt=struct.unpack_from('<H',data,fofs+cur)[0]
                if nxt==0xFFFF or n>500 or nxt>=length: break
                cur=nxt; n+=1
    RC[s]=out; return out
fmt=Formatter(FormatterSyntax.NASM)
def dis(s,start,end):
    fofs,length,fl=SEG[s]; rl=relocs(s)
    end=min(end,length); dec=Decoder(16,data[fofs+start:fofs+end],ip=start)
    for ins in dec:
        note=''
        for b in range(1,ins.len):
            if ins.ip+b in rl: note='  ; -> '+rl[ins.ip+b]; break
        print(f"  {s}:{ins.ip:04X}  {fmt.format(ins)}{note}")
def jt(s,off,n):
    fofs=SEG[s][0]; return [struct.unpack_from('<H',data,fofs+off+2*i)[0] for i in range(n)]
if __name__=='__main__':
    c=sys.argv[2]
    if c=='d': dis(int(sys.argv[3]),int(sys.argv[4],16),int(sys.argv[5],16))
    elif c=='jt':
        s=int(sys.argv[3]); off=int(sys.argv[4],16); n=int(sys.argv[5]); base=int(sys.argv[6]) if len(sys.argv)>6 else 0
        for i,v in enumerate(jt(s,off,n)): print(base+i, hex(v))
    elif c=='callers':
        tgt=sys.argv[3]  # e.g. seg6:0x1DCE
        for s in SEG:
            if SEG[s][2]&1: continue
            for off,t in relocs(s).items():
                if t==tgt: print(f"seg{s}:0x{off-1:04X}")

def allcallers_to_seg(tseg):
    from collections import defaultdict
    r=defaultdict(list)
    for s in SEG:
        if SEG[s][2]&1: continue
        for off,t in relocs(s).items():
            if t.startswith(f"seg{tseg}:"): r[t].append(f"seg{s}:0x{off-1:04X}")
    return r
if __name__=='__main__' and sys.argv[2]=='segcallers':
    for k,v in sorted(allcallers_to_seg(int(sys.argv[3])).items()): print(k, len(v), ' '.join(v[:12]))

def dump_all(outdir):
    import os
    os.makedirs(outdir, exist_ok=True)
    for s,(fofs,length,fl) in SEG.items():
        if fl&1: continue
        rl=relocs(s)
        with open(os.path.join(outdir,f"seg{s}.asm"),"w") as w:
            for ins in Decoder(16,data[fofs:fofs+length],ip=0):
                note=''
                for b in range(1,ins.len):
                    if ins.ip+b in rl: note='  ; -> '+rl[ins.ip+b]; break
                w.write(f"{s}:{ins.ip:04X}  {fmt.format(ins)}{note}\n")
if __name__=='__main__' and sys.argv[2]=='dumpall':
    dump_all(sys.argv[3])
