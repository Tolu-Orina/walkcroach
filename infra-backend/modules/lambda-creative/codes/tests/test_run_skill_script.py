"""Unit tests for allowlisted run_skill_script (Phase A7 / B4)."""
from __future__ import annotations

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


def test_unknown_script_rejected():
    with pytest.raises(ValueError, match="not allowlisted"):
        resolve_script("rm_rf_home")


def test_validate_pptx_exit_codes():
    # Empty / missing file → fail
    missing = run_skill_script("validate_pptx", ["/no/such/deck.pptx", "--json"])
    assert missing.exit_code == 1

    # Minimal valid OOXML zip is not enough (missing ppt parts) → fail
    with tempfile.TemporaryDirectory() as td:
        bad = Path(td) / "bad.pptx"
        with zipfile.ZipFile(bad, "w") as zf:
            zf.writestr("hello.txt", "no")
        bad_res = run_skill_script("validate_pptx", [str(bad), "--json"])
        assert bad_res.exit_code == 1
