#!/usr/bin/env python3
"""Render a labeled thumbnail grid from a .pptx via LibreOffice + Pillow.

WalkCroach original. Used after render_pptx so Nova Pro (or CI) can visually QA
without loading every slide XML into the context window.

Requires: LibreOffice (soffice), Pillow, poppler-utils optional fallback.

Usage:
  python thumbnail_pptx.py deck.pptx out/grid --cols 3
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

THUMB_W = 320
PAD = 16
DPI = 120


def soffice_to_pdf(pptx: Path, out_dir: Path) -> Path:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("LibreOffice (soffice) not found on PATH")
    cmd = [
        soffice,
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        str(out_dir),
        str(pptx),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    pdf = out_dir / (pptx.stem + ".pdf")
    if not pdf.is_file():
        # some soffice builds rename oddly
        pdfs = list(out_dir.glob("*.pdf"))
        if not pdfs:
            raise RuntimeError("soffice produced no PDF")
        pdf = pdfs[0]
    return pdf


def pdf_to_images(pdf: Path, out_dir: Path) -> list[Path]:
    # Prefer pdftoppm; fallback to pdf2image if available
    pdftoppm = shutil.which("pdftoppm")
    if pdftoppm:
        prefix = out_dir / "slide"
        subprocess.run(
            [pdftoppm, "-jpeg", "-r", str(DPI), str(pdf), str(prefix)],
            check=True,
        )
        return sorted(out_dir.glob("slide*.jpg"))
    try:
        from pdf2image import convert_from_path  # type: ignore

        pages = convert_from_path(str(pdf), dpi=DPI)
        paths: list[Path] = []
        for i, im in enumerate(pages, 1):
            p = out_dir / f"slide-{i:02d}.jpg"
            im.save(p, "JPEG", quality=92)
            paths.append(p)
        return paths
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"need pdftoppm or pdf2image: {e}") from e


def grid(images: list[Path], out_prefix: Path, cols: int) -> list[Path]:
    if not images:
        raise RuntimeError("no slide images")
    cols = max(1, min(cols, 6))
    thumbs: list[Image.Image] = []
    labels: list[str] = []
    for i, p in enumerate(images, 1):
        im = Image.open(p).convert("RGB")
        ratio = THUMB_W / im.width
        im = im.resize((THUMB_W, max(1, int(im.height * ratio))), Image.Resampling.LANCZOS)
        thumbs.append(im)
        labels.append(f"slide{i}")

    rows = (len(thumbs) + cols - 1) // cols
    cell_h = max(t.height for t in thumbs) + 28
    cell_w = THUMB_W + PAD
    sheet_w = cols * cell_w + PAD
    sheet_h = rows * cell_h + PAD
    sheet = Image.new("RGB", (sheet_w, sheet_h), (245, 246, 248))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default()
    except Exception:  # noqa: BLE001
        font = None

    for idx, (im, label) in enumerate(zip(thumbs, labels)):
        r, c = divmod(idx, cols)
        x = PAD + c * cell_w
        y = PAD + r * cell_h
        sheet.paste(im, (x, y))
        draw.rectangle([x, y, x + im.width, y + im.height], outline=(46, 51, 60), width=2)
        draw.text((x, y + im.height + 4), label, fill=(11, 12, 15), font=font)

    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    out = out_prefix.with_suffix(".jpg")
    sheet.save(out, "JPEG", quality=92)
    return [out]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pptx", type=Path)
    ap.add_argument("output_prefix", type=Path, nargs="?", default=Path("thumbnails"))
    ap.add_argument("--cols", type=int, default=3)
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        pdf = soffice_to_pdf(args.pptx, td_path)
        imgs = pdf_to_images(pdf, td_path)
        outs = grid(imgs, args.output_prefix, args.cols)
    for o in outs:
        print(o)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"Error: {e}", file=sys.stderr)
        raise SystemExit(2)
