"""Decode DIB chunks from a RoboSport .PRS/.TWN resource file to PNG.

Each DIB chunk payload is a standard Windows BITMAPINFOHEADER (40 bytes) +
palette + pixel data. We render with Pillow.
"""
import struct, sys, os

def chunks(d):
    off = 32
    while off + 26 <= len(d):
        tag = d[off:off+4].rstrip(b'\0').decode('ascii','replace')
        cid = struct.unpack_from('<H', d, off+4)[0]
        name = d[off+6:off+22].split(b'\0')[0].decode('ascii','replace')
        size = struct.unpack_from('<I', d, off+22)[0]
        yield tag, cid, name, d[off+26:off+size]
        off += size

def decode_dib(body):
    # BITMAPINFOHEADER
    (hsz, w, h, planes, bpp, comp, imgsz, xppm, yppm, clrused, clrimp) = \
        struct.unpack_from('<IiiHHIIiiII', body, 0)
    top_down = h < 0
    h = abs(h)
    pal_off = hsz
    ncolors = clrused if clrused else (1 << bpp if bpp <= 8 else 0)
    palette = []
    for i in range(ncolors):
        b, g, r, a = body[pal_off+i*4: pal_off+i*4+4]
        palette.append((r, g, b))
    px_off = pal_off + ncolors*4
    row_bytes = ((w * bpp + 31)//32)*4
    from PIL import Image
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        srcy = y if top_down else (h-1-y)
        base = px_off + srcy*row_bytes
        for x in range(w):
            if bpp == 8:
                idx = body[base+x] if base+x < len(body) else 0
                px[x, y] = palette[idx] if idx < len(palette) else (255,0,255)
            elif bpp == 4:
                bval = body[base + x//2] if base+x//2 < len(body) else 0
                idx = (bval >> 4) if (x & 1)==0 else (bval & 0xF)
                px[x, y] = palette[idx] if idx < len(palette) else (255,0,255)
            elif bpp == 24:
                o = base + x*3
                px[x, y] = (body[o+2], body[o+1], body[o])
    return img, w, h, bpp

path = sys.argv[1]
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)
want = set(sys.argv[3:]) if len(sys.argv) > 3 else None
d = open(path,'rb').read()
for tag, cid, name, body in chunks(d):
    if tag != 'DIB': continue
    if want and str(cid) not in want: continue
    try:
        img, w, h, bpp = decode_dib(body)
        out = os.path.join(outdir, f"{cid}_{name}.png")
        img.save(out)
        print(f"{name:14} id={cid:5} {w}x{h} {bpp}bpp -> {out}")
    except Exception as e:
        print(f"{name:14} id={cid:5} FAILED: {e}")
