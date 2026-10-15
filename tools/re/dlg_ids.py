"""Dump dialog templates with control ids, classes and styles.

Usage: dlg_ids.py ROBO.EXE [dialog-id ...]
"""
import struct, sys
data = open(sys.argv[1],'rb').read()
ne = struct.unpack_from('<I', data, 0x3C)[0]
(restab_off,) = struct.unpack_from('<H', data, ne + 0x24)
rt = ne + restab_off
(shift,) = struct.unpack_from('<H', data, rt)
res = {}
p = rt + 2
while True:
    (tid,) = struct.unpack_from('<H', data, p)
    if tid == 0: break
    (cnt,) = struct.unpack_from('<H', data, p + 2)
    p += 8
    for j in range(cnt):
        so, sl, sf, sid = struct.unpack_from('<HHHH', data, p)
        res.setdefault(tid & 0x7FFF, []).append((sid, so << shift, sl << shift))
        p += 12
def cstr(p):
    e = data.index(b'\0', p); return data[p:e].decode('cp1252','replace'), e+1
CLS={0x80:'BUTTON',0x81:'EDIT',0x82:'STATIC',0x83:'LISTBOX',0x84:'SCROLLBAR',0x85:'COMBOBOX'}
want = set(int(x) for x in sys.argv[2:])
for sid, off, ln in res.get(5,[]):
    i = sid & 0x7FFF
    if want and i not in want: continue
    p = off
    style, n = struct.unpack_from('<IB', data, p); p+=5
    x,y,cx,cy = struct.unpack_from('<4H', data, p); p+=8
    if data[p]==0xFF: menu='#%d'%struct.unpack_from('<H',data,p+1)[0]; p+=3
    else: menu,p=cstr(p)
    cls,p=cstr(p); cap,p=cstr(p)
    if style & 0x40:
        p+=2; font,p=cstr(p)
    print(f'DLG #{i} "{cap}" menu={menu} items={n}')
    for k in range(n):
        x,y,cx,cy,cid = struct.unpack_from('<5H', data, p); p+=10
        st, = struct.unpack_from('<I', data, p); p+=4
        if data[p]>=0x80: c=CLS.get(data[p],hex(data[p])); p+=1
        else: c,p=cstr(p)
        if data[p]==0xFF: t='#%d'%struct.unpack_from('<H',data,p+1)[0]; p+=3
        else: t,p=cstr(p)
        ex=data[p]; p+=1+ex
        print(f'  id={cid:5d} {c:9s} st={st:08X} ({x},{y},{cx},{cy}) "{t}"')
