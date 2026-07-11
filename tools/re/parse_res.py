"""Parse the 'RoboSport Resources' chunked format used by .TWN/.PRS files."""
import sys, struct, collections

def parse(path, list_all=True):
    data = open(path, 'rb').read()
    print(f"=== {path}  ({len(data)} bytes)")
    sig = data[:32]
    print("sig:", sig)
    off = 32
    counts = collections.Counter()
    chunks = []
    while off + 26 <= len(data):
        tag = data[off:off+4].rstrip(b'\0').decode('ascii', 'replace')
        cid = struct.unpack_from('<H', data, off+4)[0]
        name = data[off+6:off+22].split(b'\0')[0].decode('ascii', 'replace')
        size = struct.unpack_from('<I', data, off+22)[0]
        if size < 26 or off + size > len(data):
            print(f"  !! bad chunk at 0x{off:X}: tag={tag!r} size={size}")
            break
        chunks.append((off, tag, cid, name, size))
        counts[(tag, name)] += 1
        off += size
    print(f"parsed {len(chunks)} chunks, ended at 0x{off:X} / 0x{len(data):X}")
    for (tag, name), n in counts.most_common():
        sizes = sorted({c[4] for c in chunks if c[1] == tag and c[3] == name})
        ids = sorted(c[2] for c in chunks if c[1] == tag and c[3] == name)
        idrange = f"{min(ids)}..{max(ids)}" if ids else ""
        print(f"  {tag:6} {name:20} x{n:4}  ids {idrange:12} sizes {sizes[:8]}")
    if list_all:
        for off, tag, cid, name, size in chunks:
            print(f"    0x{off:06X} {tag:4} id={cid:5} {name:18} size={size}")
    return chunks, data

if __name__ == '__main__':
    for p in sys.argv[1:]:
        parse(p, list_all=('-v' in sys.argv))
