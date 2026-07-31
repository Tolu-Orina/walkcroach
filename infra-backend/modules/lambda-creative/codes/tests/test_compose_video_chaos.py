"""Phase H2 — compose chaos: Polly fail + partial mux fallback."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from compose_video import compose_video  # noqa: E402


def test_polly_fail_hard_fails_compose(tmp_path: Path):
    out = tmp_path / "out.mp4"
    with patch("compose_video.synthesize_polly", return_value={"ok": False, "error": "boom"}):
        result = compose_video(
            reel_mp4=None,
            voiceover_script="Hello world",
            out_mp4=out,
        )
    assert result["ok"] is False
    assert "polly failed" in result["error"]


def test_mux_fail_marks_partial_compose(tmp_path: Path):
    out = tmp_path / "out.mp4"
    reel = tmp_path / "reel.mp4"
    reel.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64)

    fake_proc_fail = MagicMock(returncode=1, stdout="", stderr="mux fail")
    fake_proc_ok = MagicMock(returncode=0, stdout="", stderr="")

    def run_side_effect(cmd, **_kwargs):
        # color clip / anullsrc succeed; mux fails
        joined = " ".join(str(c) for c in cmd)
        if "libx264" in joined or "lavfi" in joined:
            # Write output path (last arg)
            Path(cmd[-1]).write_bytes(b"\x00" * 32)
            return fake_proc_ok
        Path(cmd[-1]).write_bytes(b"")  # empty → treated as fail path
        return fake_proc_fail

    with (
        patch.dict("os.environ", {"VIDEO_STUDIO_STUB": "0"}, clear=False),
        patch("compose_video._which", return_value="/usr/bin/ffmpeg"),
        patch(
            "compose_video.synthesize_polly",
            return_value={"ok": True, "stub": False, "bytes": 8},
        ),
        patch("compose_video.subprocess.run", side_effect=run_side_effect),
    ):
        # Ensure audio file exists for mux branch
        result = compose_video(
            reel_mp4=reel,
            voiceover_script="Voice over line",
            out_mp4=out,
            aspect="16:9",
        )

    assert result["ok"] is True
    assert result.get("partialCompose") is True
    assert out.is_file()
