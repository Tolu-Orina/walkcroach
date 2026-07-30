#!/usr/bin/env python3
"""Quick structural checks after Canvas write (exists, non-empty, decodable).

Usage:
  python check_image_asset.py out.png [--min-edge 512]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image", type=Path)
    ap.add_argument("--min-edge", type=int, default=320)
    args = ap.parse_args()
    if not args.image.is_file() or args.image.stat().st_size < 64:
        print("FAIL: missing or empty image", file=sys.stderr)
        return 1
    from PIL import Image

    with Image.open(args.image) as im:
        im.verify()
    with Image.open(args.image) as im:
        w, h = im.size
        if min(w, h) < args.min_edge:
            print(f"FAIL: edge {min(w, h)} < {args.min_edge}", file=sys.stderr)
            return 1
        # Nova Canvas: sides divisible by 16 for generation config; output may vary
        print(f"OK {w}x{h}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
