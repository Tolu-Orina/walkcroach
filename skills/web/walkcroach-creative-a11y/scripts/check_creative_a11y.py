#!/usr/bin/env python3
"""Basic a11y checks for WalkCroach creatives (Phase E3).

- PPTX: every pic:pic / a:blip must have a non-empty cNvPr descr or title (alt)
- Flyer HTML: every <img> must have non-empty alt=
- Brief JSON (optional --brief): if estimatedImages>0, require altText / alt_text

Usage:
  python check_creative_a11y.py deck.pptx
  python check_creative_a11y.py flyer.html
  python check_creative_a11y.py deck.pptx --brief brief.json --json
Exit 0 = pass, 1 = fail.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.I)
ALT_RE = re.compile(r'\balt\s*=\s*("([^"]*)"|\'([^\']*)\')', re.I)
PIC_RE = re.compile(r"<p:pic\b[\s\S]*?</p:pic>", re.I)
CNVPR_RE = re.compile(
    r'<p:cNvPr\b[^>]*\b(?:descr|title)\s*=\s*("([^"]*)"|\'([^\']*)\')',
    re.I,
)


def check_pptx(path: Path) -> list[str]:
    findings: list[str] = []
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return ["not a valid ZIP/OOXML package"]
    slides = sorted(
        n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)
    )
    for name in slides:
        raw = zf.read(name).decode("utf-8", errors="replace")
        pics = PIC_RE.findall(raw)
        for i, pic in enumerate(pics, 1):
            m = CNVPR_RE.search(pic)
            alt = ""
            if m:
                alt = (m.group(2) or m.group(3) or "").strip()
            if not alt:
                findings.append(f"{name}: image {i} missing non-empty alt (cNvPr descr/title)")
    return findings


def check_html(path: Path) -> list[str]:
    findings: list[str] = []
    raw = path.read_text(encoding="utf-8", errors="replace")
    for i, tag in enumerate(IMG_TAG_RE.findall(raw), 1):
        m = ALT_RE.search(tag)
        if not m:
            findings.append(f"img {i}: missing alt attribute")
            continue
        alt = (m.group(2) or m.group(3) or "").strip()
        if not alt:
            findings.append(f"img {i}: empty alt attribute")
        if alt.lower() in {"image", "img", "photo", "picture"}:
            findings.append(f"img {i}: non-descriptive alt '{alt}'")
    return findings


def check_brief(path: Path) -> list[str]:
    findings: list[str] = []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return [f"brief json unreadable: {exc}"]
    if not isinstance(data, dict):
        return ["brief must be a JSON object"]
    estimated = int(data.get("estimatedImages") or 0)
    alt = str(data.get("altText") or data.get("alt_text") or "").strip()
    if estimated > 0 and not alt:
        findings.append(
            "brief.estimatedImages > 0 but altText/alt_text is missing — "
            "provide accessible alt text for generated stills"
        )
    return findings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", type=Path, help="pptx, html, or pdf path (pdf skipped)")
    ap.add_argument("--brief", type=Path, default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    findings: list[str] = []
    suffix = args.path.suffix.lower()
    if suffix == ".pptx":
        findings.extend(check_pptx(args.path))
    elif suffix in {".html", ".htm"}:
        findings.extend(check_html(args.path))
    elif suffix == ".pdf":
        # PDF raster a11y is out of scope for v1 — brief check still applies.
        pass
    else:
        findings.append(f"unsupported file type: {suffix}")

    if args.brief:
        findings.extend(check_brief(args.brief))

    payload = {"ok": len(findings) == 0, "findings": findings}
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        if findings:
            for f in findings:
                print(f"FAIL: {f}", file=sys.stderr)
        else:
            print("OK")
    return 0 if not findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
