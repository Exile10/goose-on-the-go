#!/usr/bin/env python3
"""Reject Android archives containing 64-bit ELF libraries incompatible with 16 KB pages."""
import argparse
import struct
import zipfile


def check(path):
    count = 0
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not name.endswith(".so") or not any(abi in name.split("/") for abi in ("arm64-v8a", "x86_64")):
                continue
            data = archive.read(name)
            assert data[:6] == b"\x7fELF\x02\x01", f"Unsupported ELF format: {name}"
            offset = struct.unpack_from("<Q", data, 32)[0]
            size, number = struct.unpack_from("<HH", data, 54)
            assert size >= 56 and number > 0, f"Missing program headers: {name}"
            loads = 0
            for index in range(number):
                kind, flags, file_offset, virtual, physical, file_size, memory_size, alignment = struct.unpack_from("<IIQQQQQQ", data, offset + size * index)
                if kind == 1:
                    loads += 1
                    assert alignment >= 16384 and alignment & (alignment - 1) == 0, f"{name}: LOAD alignment {alignment} is below 16 KB"
                    assert (virtual - file_offset) % 16384 == 0, f"{name}: LOAD offsets are not congruent at 16 KB"
            assert loads, f"Missing LOAD segments: {name}"
            count += 1
    assert count, "No 64-bit native libraries found"
    print(f"PASS: {count} native libraries have 16 KB ELF alignment")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", help="APK or AAR to verify")
    check(parser.parse_args().archive)
