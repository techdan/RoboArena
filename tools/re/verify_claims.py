"""Independently verify committed RE claims against the local original files.

This intentionally does not import export_data.py. It derives NE segment file
locations from the executable header and checks data values, reachable selector
rows, code-slice fingerprints, and arena dimensions from the claim ledger.

Usage:
  python tools/re/verify_claims.py <ROBOWIN-dir> [claims.json]
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path


def fail(message: str) -> None:
    raise AssertionError(message)


def parse_ne_segments(data: bytes) -> tuple[int, int, dict[int, tuple[int, int, int]]]:
    ne_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[ne_offset : ne_offset + 2] != b"NE":
        fail("ROBO.EXE is not a Win16 NE executable")
    segment_count = struct.unpack_from("<H", data, ne_offset + 0x1C)[0]
    autodata = struct.unpack_from("<H", data, ne_offset + 0x0E)[0]
    segment_table = struct.unpack_from("<H", data, ne_offset + 0x22)[0]
    align_shift = struct.unpack_from("<H", data, ne_offset + 0x32)[0] or 9
    segments: dict[int, tuple[int, int, int]] = {}
    for index in range(segment_count):
        entry = ne_offset + segment_table + index * 8
        sector, length, flags, _ = struct.unpack_from("<HHHH", data, entry)
        segments[index + 1] = (sector << align_shift, length or 65536, flags)
    return segment_count, autodata, segments


def read_values(data: bytes, base: int, claim: dict[str, object]) -> list[int]:
    offset = int(str(claim["offset"]), 0)
    expected = list(claim["values"])
    encoding = claim["encoding"]
    if encoding == "u8":
        return list(data[base + offset : base + offset + len(expected)])
    if encoding == "u16le":
        return [
            struct.unpack_from("<H", data, base + offset + index * 2)[0]
            for index in range(len(expected))
        ]
    fail(f"unsupported claim encoding: {encoding}")
    return []


def read_town_dimensions(path: Path) -> list[list[int]]:
    data = path.read_bytes()
    offset = 32
    while offset + 26 <= len(data):
        tag = data[offset : offset + 4].rstrip(b"\0")
        size = struct.unpack_from("<I", data, offset + 22)[0]
        if tag == b"INF":
            body = data[offset + 26 : offset + size]
            count = struct.unpack_from("<H", body, 0)[0]
            widths = body[0x22 : 0x22 + count]
            heights = body[0x32 : 0x32 + count]
            return [[widths[i], heights[i]] for i in range(count)]
        if size <= 0:
            fail(f"invalid chunk size in {path}")
        offset += size
    fail(f"INF chunk not found in {path}")
    return []


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    robowin = Path(sys.argv[1]) if len(sys.argv) > 1 else repo_root / "RoboSport (1991)" / "games" / "RoboSpor" / "ROBOWIN"
    claims_path = Path(sys.argv[2]) if len(sys.argv) > 2 else repo_root / "references" / "re-claims.json"
    claims = json.loads(claims_path.read_text(encoding="utf-8"))
    exe = (robowin / claims["binary"]["filename"]).read_bytes()

    actual_hash = hashlib.sha256(exe).hexdigest()
    expected_hash = claims["binary"]["sha256"]
    if actual_hash != expected_hash:
        fail(f"binary SHA-256 mismatch: expected {expected_hash}, got {actual_hash}")

    segment_count, autodata, segments = parse_ne_segments(exe)
    if segment_count != claims["binary"]["segment_count"]:
        fail(f"segment count mismatch: {segment_count}")
    if autodata != claims["binary"]["dgroup_segment"]:
        fail(f"DGROUP/autodata segment mismatch: {autodata}")
    dgroup_base = segments[autodata][0]

    checked = 0
    for claim in claims["data_claims"]:
        actual = read_values(exe, dgroup_base, claim)
        if actual != claim["values"]:
            fail(f"{claim['id']} mismatch: expected {claim['values']}, got {actual}")
        checked += 1

    selector_claim = claims["selector_claims"]
    table_offset = int(selector_claim["table_offset"], 0)
    checked_rows = 0
    for group in selector_claim["row_groups"]:
        if "range" in group:
            first, last = group["range"]
            selectors = list(range(first, last + 1))
            expected_rows = [group["row"] for _ in selectors]
        else:
            selectors = group["selectors"]
            expected_rows = group["rows"]
        actual_rows = []
        for selector in selectors:
            start = dgroup_base + table_offset + selector * 4
            actual_rows.append(list(exe[start : start + 4]))
        if actual_rows != expected_rows:
            fail(
                f"selector rows {selectors[0]}..{selectors[-1]} mismatch: "
                f"expected {expected_rows}, got {actual_rows}"
            )
        checked_rows += len(selectors)
    expected_count = selector_claim.get("row_count")
    if expected_count is not None and checked_rows != expected_count:
        fail(f"selector row coverage mismatch: expected {expected_count}, checked {checked_rows}")
    checked += 1

    for claim in claims["code_slices"]:
        segment_base, segment_length, _ = segments[claim["segment"]]
        offset = int(claim["offset"], 0)
        length = claim["length"]
        if offset + length > segment_length:
            fail(f"{claim['id']} exceeds segment bounds")
        digest = hashlib.sha256(exe[segment_base + offset : segment_base + offset + length]).hexdigest()
        if digest != claim["sha256"]:
            fail(f"{claim['id']} code fingerprint mismatch: {digest}")
        checked += 1

    for filename, expected in claims["arena_claims"].items():
        actual = read_town_dimensions(robowin / filename)
        if actual != expected:
            fail(f"{filename} dimensions mismatch: expected {expected}, got {actual}")
        checked += 1

    print(f"verified {checked} RE claims against {actual_hash}")


if __name__ == "__main__":
    main()
