#!/usr/bin/env python3
"""Convert PDF flyer pages to PNG for visual QA / Chat previews.

WalkCroach original. Deterministic — run in lambda-creative after render_flyer.

Usage:
  python pdf_to_images.py flyer.pdf out_dir/
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def convert(pdf: Path, out_dir: Path, dpi: int = 150, max_dim: int = 1600) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    pdftoppm = shutil.which("pdftoppm")
    paths: list[Path] = []
    if pdftoppm:
        prefix = out_dir / "page"
        subprocess.run(
            [pdftoppm, "-png", "-r", str(dpi), str(pdf), str(prefix)],
            check=True,
        )
        paths = sorted(out_dir.glob("page*.png"))
    else:
        from pdf2image import convert_from_path  # type: ignore

        for i, im in enumerate(convert_from_path(str(pdf), dpi=dpi), 1):
            w, h = im.size
            if max(w, h) > max_dim:
                scale = max_dim / max(w, h)
                im = im.resize((int(w * scale), int(h * scale)))
            p = out_dir / f"page_{i}.png"
            im.save(p)
            paths.append(p)
    if not paths:
        raise RuntimeError("no pages produced")
    return paths


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--dpi", type=int, default=150)
    args = ap.parse_args()
    for p in convert(args.pdf, args.out_dir, dpi=args.dpi):
        print(p)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"Error: {e}", file=sys.stderr)
        raise SystemExit(2)
