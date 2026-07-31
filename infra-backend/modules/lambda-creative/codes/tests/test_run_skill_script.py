"""Unit tests for allowlisted run_skill_script (Phase A7 / B4 / E3)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
ROOT = Path(__file__).resolve().parents[5]  # walkcroach/
sys.path.insert(0, str(SRC))
os.environ["WALKCROACH_WEB_SKILLS_DIR"] = str(ROOT / "skills" / "web")

from run_skill_script import (  # noqa: E402
    ALLOWED_SCRIPTS,
    resolve_script,
    run_skill_script,
)


def test_allowlist_contains_pptx_gates():
    assert "validate_pptx" in ALLOWED_SCRIPTS
    assert "thumbnail_pptx" in ALLOWED_SCRIPTS
    assert "add_hd_image" in ALLOWED_SCRIPTS
    assert "check_creative_a11y" in ALLOWED_SCRIPTS


def test_unknown_script_rejected():
    with pytest.raises(ValueError, match="not allowlisted"):
        resolve_script("rm_rf_home")


def test_validate_pptx_exit_codes():
    missing = run_skill_script("validate_pptx", ["/no/such/deck.pptx", "--json"])
    assert missing.exit_code == 1

    with tempfile.TemporaryDirectory() as td:
        bad = Path(td) / "bad.pptx"
        with zipfile.ZipFile(bad, "w") as zf:
            zf.writestr("hello.txt", "no")
        bad_res = run_skill_script("validate_pptx", [str(bad), "--json"])
        assert bad_res.exit_code == 1


def test_flyer_templates_exist():
    root = Path(os.environ["WALKCROACH_WEB_SKILLS_DIR"])
    for name in ("sale", "event", "announcement"):
        assert (root / "walkcroach-flyer" / "templates" / f"{name}.html").is_file()


def test_check_creative_a11y_html_without_img_ok():
    root = Path(os.environ["WALKCROACH_WEB_SKILLS_DIR"])
    sale = root / "walkcroach-flyer" / "templates" / "sale.html"
    with tempfile.TemporaryDirectory() as td:
        html = Path(td) / "flyer.html"
        html.write_text(
            "<!DOCTYPE html><html lang='en'><body><h1>Sale</h1></body></html>",
            encoding="utf-8",
        )
        brief = Path(td) / "brief.json"
        brief.write_text(json.dumps({"estimatedImages": 0}), encoding="utf-8")
        res = run_skill_script(
            "check_creative_a11y",
            [str(html), "--brief", str(brief), "--json"],
        )
        assert res.ok, res.stderr or res.stdout
    assert sale.is_file()


def test_check_creative_a11y_brief_requires_alt_when_images():
    with tempfile.TemporaryDirectory() as td:
        html = Path(td) / "flyer.html"
        html.write_text("<html><body></body></html>", encoding="utf-8")
        brief = Path(td) / "brief.json"
        brief.write_text(json.dumps({"estimatedImages": 1}), encoding="utf-8")
        res = run_skill_script(
            "check_creative_a11y",
            [str(html), "--brief", str(brief), "--json"],
        )
        assert res.exit_code == 1
