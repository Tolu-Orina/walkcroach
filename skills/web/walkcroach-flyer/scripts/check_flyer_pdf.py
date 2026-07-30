#!/usr/bin/env python3
"""Basic flyer/PDF layout QA: page count, min size, optional text extract scan.

WalkCroach original. Complements visual review via pdf_to_images.py.

Usage:
  python check_flyer_pdf.py flyer.pdf [--max-pages 1]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PLACEHOLDER_RE = re.compile(r"\b(lorem|ipsum|TODO|xxx+)\b", re.I)


def check(pdf: Path, max_pages: int) -> list[str]:
    findings: list[str] = []
    try:
        from pypdf import PdfReader  # type: ignore
    except ImportError:
        return ["pypdf not installed"]

    reader = PdfReader(str(pdf))
    n = len(reader.pages)
    if n == 0:
        findings.append("PDF has zero pages")
    if n > max_pages:
        findings.append(f"expected ≤{max_pages} page(s), found {n}")

    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    if PLACEHOLDER_RE.search(text):
        findings.append("placeholder/lorem-like text in PDF")
    if len(text.strip()) < 8:
        findings.append("WARN almost no extractable text — check if type is raster-only")

    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--max-pages", type=int, default=1)
    args = ap.parse_args()
    findings = check(args.pdf, args.max_pages)
    errors = [f for f in findings if not f.startswith("WARN")]
    for f in findings:
        print(f)
    if not findings:
        print("OK")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
