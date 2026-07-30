#!/usr/bin/env python3
"""HD-safe image placement helper for WalkCroach slide assembly.

Refuse to place an image into a target box larger than its native pixel size
(prevents soft upscales). Used by render_pptx tooling.

Usage (library):
  from add_hd_image import assert_hd_fit, load_size
"""
from __future__ import annotations

from pathlib import Path


def load_size(path: Path) -> tuple[int, int]:
    from PIL import Image

    with Image.open(path) as im:
        return im.size  # (w, h)


def assert_hd_fit(
    image_path: Path,
    target_w_px: int,
    target_h_px: int,
) -> None:
    """Raise ValueError if target box exceeds native resolution on either axis."""
    w, h = load_size(image_path)
    if target_w_px > w or target_h_px > h:
        raise ValueError(
            f"HD enforcement: refuse upscale of {image_path.name} "
            f"native={w}x{h}px into target={target_w_px}x{target_h_px}px"
        )


def max_fit_box(
    image_path: Path,
    max_w_px: int,
    max_h_px: int,
) -> tuple[int, int]:
    """Largest box ≤ max_* that fits inside native pixels, preserving aspect."""
    w, h = load_size(image_path)
    scale = min(max_w_px / w, max_h_px / h, 1.0)
    return max(1, int(w * scale)), max(1, int(h * scale))


if __name__ == "__main__":
    import argparse
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("--max-w", type=int, required=True)
    ap.add_argument("--max-h", type=int, required=True)
    args = ap.parse_args()
    try:
        box = max_fit_box(args.image, args.max_w, args.max_h)
        print(f"{box[0]}x{box[1]}")
    except Exception as e:  # noqa: BLE001
        print(e, file=sys.stderr)
        raise SystemExit(1)
