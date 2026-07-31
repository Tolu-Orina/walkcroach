#!/usr/bin/env python3
"""Phase C smoke: sale flyer → check_flyer_pdf exit 0 (+ optional PNG preview).

Run from walkcroach/infra-backend:
  python modules/lambda-creative/scripts/smoke_flyer.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SRC = Path(__file__).resolve().parents[1] / "codes" / "src"
SKILLS = ROOT / "skills" / "web"

sys.path.insert(0, str(SRC))

import os

os.environ.setdefault("WALKCROACH_WEB_SKILLS_DIR", str(SKILLS))

from render_flyer import render_flyer  # noqa: E402
from run_skill_script import run_skill_script  # noqa: E402


def main() -> int:
    brief = {
        "brand": "Northside Bakery",
        "eyebrow": "Weekend only",
        "headline": "Sourdough sale — 20% off",
        "support": "Fresh loaves Friday through Sunday. Bring a friend, share the crust.",
        "cta": "Visit the shop",
        "meta": "42 Mill Lane · Sat–Sun 8am–2pm",
        "template": "sale",
        "philosophy": {
            "name": "Market Dawn",
            "notes": "Warm graphite field, amber CTA, one headline.",
        },
        "palette": ["#0b0c0f", "#f2f3f5", "#f0b429", "#6b9eff"],
    }
    with tempfile.TemporaryDirectory(prefix="wc-flyer-smoke-") as td:
        out = Path(td) / "sale.pdf"
        meta = render_flyer(brief, out)
        print(f"engine={meta['engine']} template={meta['template']}")
        check = run_skill_script(
            "check_flyer_pdf", [str(out), "--max-pages", "1"]
        )
        print(check.stdout or check.stderr)
        if not check.ok:
            print(f"FAIL check exit={check.exit_code}", file=sys.stderr)
            return 1

        imgs = run_skill_script("pdf_to_images", [str(out), str(Path(td) / "pages")])
        if imgs.ok:
            print(f"OK preview\n{imgs.stdout.strip()}")
        else:
            print(
                f"WARN pdf_to_images skipped (exit {imgs.exit_code}): "
                f"{(imgs.stderr or imgs.stdout)[:300]}"
            )
        print("OK check_flyer_pdf")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
