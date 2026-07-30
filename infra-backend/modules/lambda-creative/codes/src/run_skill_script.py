"""Allowlisted skill-script runner for WalkCroach lambda-creative.

Phase A7 / B4: only named scripts under skills/web/**/scripts may run.
Exit codes are load-bearing — callers must fail closed on non-zero.
"""
from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# Relative to SKILLS_ROOT (baked at /opt/skills/web in the container image).
ALLOWED_SCRIPTS: dict[str, str] = {
    "validate_pptx": "walkcroach-pptx/scripts/validate_pptx.py",
    "thumbnail_pptx": "walkcroach-pptx/scripts/thumbnail_pptx.py",
    "add_hd_image": "walkcroach-pptx/scripts/add_hd_image.py",
    "check_image_asset": "walkcroach-image-gen/scripts/check_image_asset.py",
    "check_flyer_pdf": "walkcroach-flyer/scripts/check_flyer_pdf.py",
    "pdf_to_images": "walkcroach-pdf/scripts/pdf_to_images.py",
    "assert_reel_still": "walkcroach-video-studio/scripts/assert_reel_still.py",
}


def skills_root() -> Path:
    env = os.environ.get("WALKCROACH_WEB_SKILLS_DIR")
    if env:
        return Path(env)
    # Container bake path
    opt = Path("/opt/skills/web")
    if opt.is_dir():
        return opt
    # Repo-relative (local / CI)
    here = Path(__file__).resolve()
    # codes/src → repo/skills/web
    candidate = here.parents[5] / "skills" / "web"
    if candidate.is_dir():
        return candidate
    # cwd fallback
    cwd = Path.cwd() / "skills" / "web"
    return cwd


@dataclass
class ScriptResult:
    name: str
    exit_code: int
    stdout: str
    stderr: str
    script_path: str

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def resolve_script(name: str) -> Path:
    rel = ALLOWED_SCRIPTS.get(name)
    if not rel:
        raise ValueError(
            f"script not allowlisted: {name}. "
            f"Allowed: {', '.join(sorted(ALLOWED_SCRIPTS))}"
        )
    path = skills_root() / rel
    if not path.is_file():
        raise FileNotFoundError(f"allowlisted script missing on disk: {path}")
    # Refuse path escape even if ALLOWED_SCRIPTS is later edited carelessly
    root = skills_root().resolve()
    resolved = path.resolve()
    if not str(resolved).startswith(str(root)):
        raise ValueError(f"script path escapes skills root: {resolved}")
    return resolved


def run_skill_script(
    name: str,
    args: list[str] | None = None,
    *,
    timeout_s: int = 120,
) -> ScriptResult:
    """Execute an allowlisted script. Never shells out with user-controlled names."""
    script = resolve_script(name)
    cmd = [sys.executable, str(script), *(args or [])]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout_s,
        check=False,
    )
    return ScriptResult(
        name=name,
        exit_code=proc.returncode,
        stdout=proc.stdout or "",
        stderr=proc.stderr or "",
        script_path=str(script),
    )
