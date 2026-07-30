#!/usr/bin/env python3
"""Assert Nova Canvas / still dimensions are Reel-safe (1280x720) when used as video refs.

WalkCroach original.

Usage:
  python assert_reel_still.py shot.png
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image", type=Path)
    ap.add_argument("--expect-w", type=int, default=1280)
    ap.add_argument("--expect-h", type=int, default=720)
    args = ap.parse_args()
    from PIL import Image

    with Image.open(args.image) as im:
        w, h = im.size
    if (w, h) != (args.expect_w, args.expect_h):
        print(
            f"FAIL: {args.image.name} is {w}x{h}, Nova Reel requires "
            f"{args.expect_w}x{args.expect_h}",
            file=sys.stderr,
        )
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
