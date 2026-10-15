"""Independent audit reader: no import of the existing RE exporter/verifier."""
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ORIGINAL = ROOT / 'RoboSport (1991)/games/RoboSpor/ROBOWIN'
exe = (ORIGINAL / 'ROBO.EXE').read_bytes()
ne = struct.unpack_from('<I', exe, 0x3c)[0]
assert exe[ne:ne+2] == b'NE'
segment_table = struct.unpack_from('<H', exe, ne+0x22)[0]
shift = struct.unpack_from('<H', exe, ne+0x32)[0] or 9
data_segment = struct.unpack_from('<H', exe, ne+0x0e)[0]
data_base = struct.unpack_from('<H', exe, ne+segment_table+(data_segment-1)*8)[0] << shift
print('Executable SHA256:', hashlib.sha256(exe).hexdigest())
print('Human accuracy additions indexed by 0=Aim, 1..18=Scan maximum distance:', [struct.unpack_from('<h', exe, data_base+0x1596+2*i)[0] for i in range(19)])
print('AI branch field 1/2/3 additions:', {1:struct.unpack_from('<h',exe,data_base+0x15b2)[0],2:struct.unpack_from('<h',exe,data_base+0x15a2)[0],3:struct.unpack_from('<h',exe,data_base+0x15aa)[0]})

town = (ORIGINAL / 'RUBBLE.TWN').read_bytes()
chunks = {}
at = 32
while at + 26 <= len(town):
    tag = town[at:at+4].rstrip(b'\0').decode('ascii')
    identifier = struct.unpack_from('<H',town,at+4)[0]
    length = struct.unpack_from('<I',town,at+22)[0]
    assert length >= 26
    chunks[tag,identifier] = town[at+26:at+length]
    at += length
terrain = {(2,2,0,0):'open',(2,1,0,0):'rough',(2,1,1,0):'bush',(3,1,1,0):'low-wall',(4,0,2,0):'wall',(2,0,0,0):'crevice',(2,2,0,15):'outer-wall'}
for filename in ['rubble-two.json','rubble-three.json']:
    shipped = json.loads((ROOT/'src/lib/arenas'/filename).read_text())
    cells = chunks['MAP',shipped['metadata']['mapId']]
    assert len(cells) == shipped['width']*shipped['height']
    for index, cell in enumerate(cells):
        properties = chunks['TIL',300+(cell>>4)][(cell&15)*4:(cell&15)*4+4]
        expected = terrain[tuple(properties)]
        y,x = divmod(index,shipped['width'])
        assert shipped['tiles'][y][x]['terrain'] == expected, (filename,x,y,expected)
    assert hashlib.sha256(town).hexdigest() == shipped['metadata']['sourceSha256']
    print(filename, 'all',len(cells),'terrain cells and source hash match')
