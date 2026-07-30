#!/usr/bin/env python3
"""Phase B6 CI smoke: fixture deck → validate_pptx exit 0 (+ optional thumbnail).

Run from walkcroach/ repo root:
  python infra-backend/modules/lambda-creative/scripts/smoke_pptx.py

Exit 0 = pass. Thumbnail is best-effort when LibreOffice is absent.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]  # walkcroach/
SRC = Path(__file__).resolve().parents[1] / "codes" / "src"
SKILLS = ROOT / "skills" / "web"

sys.path.insert(0, str(SRC))

import os

os.environ.setdefault("WALKCROACH_WEB_SKILLS_DIR", str(SKILLS))

from render_pptx import render_pptx  # noqa: E402
from run_skill_script import run_skill_script  # noqa: E402


def main() -> int:
    brief = {
        "title": "WalkCroach Creative Smoke",
        "subtitle": "Phase B fixture deck",
        "slides": [
            {
                "title": "Why Creative Studio",
                "bullets": [
                    "Nova Pro drafts the brief",
                    "python-pptx renders 16:9 Graphite Lumen",
                    "validate_pptx fails closed",
                ],
            },
            {
                "title": "Hard gates",
                "bullets": [
                    "Paid plan for decks",
                    "Twenty credits per render",
                    "Images share the daily Canvas cap",
                ],
            },
            {
                "title": "Exit criteria",
                "bullets": [
                    "Five-slide deck downloadable",
                    "Thumbnail grid when LibreOffice is present",
                    "CI blocks on validate exit non-zero",
                ],
            },
            {
                "title": "Next",
                "bullets": [
                    "Flyer pipeline in Phase C",
                    "Video Studio in Phase D",
                ],
            },
            {
                "title": "Ship checklist",
                "bullets": [
                    "ConfirmCard before debit",
                    "creative_assets row ready",
                    "No literal bullet characters in runs",
                ],
            },
        ],
    }
    with tempfile.TemporaryDirectory(prefix="wc-smoke-") as td:
        out = Path(td) / "smoke.pptx"
        render_pptx(brief, out)
        result = run_skill_script("validate_pptx", [str(out), "--json"])
        print(result.stdout or result.stderr)
        if not result.ok:
            print(f"FAIL validate exit={result.exit_code}", file=sys.stderr)
            return 1
        parsed = json.loads(result.stdout)
        if not parsed.get("ok"):
            print(f"FAIL findings: {parsed}", file=sys.stderr)
            return 1

        thumb = run_skill_script(
            "thumbnail_pptx",
            [str(out), str(Path(td) / "grid"), "--cols", "3"],
            timeout_s=180,
        )
        if thumb.ok:
            print(f"OK thumbnail\n{thumb.stdout.strip()}")
        else:
            print(
                f"WARN thumbnail skipped (exit {thumb.exit_code}): "
                f"{(thumb.stderr or thumb.stdout)[:300]}"
            )
        print("OK validate_pptx")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
