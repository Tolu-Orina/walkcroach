"""Compose Reel silent MP4 + Polly VO + branded outro (Phase D3).

Actions consumed by handler.compose_video:
  - Synthesize Polly neural voiceover (or skip if no AWS / stub)
  - ffmpeg mux + ~2s Graphite Lumen outro
  - Optional 9:16 center crop (D5)

Local/CI: VIDEO_STUDIO_STUB=1 or missing ffmpeg → minimal placeholder MP4.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def _which(bin_name: str) -> str | None:
    return shutil.which(bin_name)


def _stub_mode() -> bool:
    v = (os.environ.get("VIDEO_STUDIO_STUB") or "").strip().lower()
    return v in {"1", "true", "yes"}


def synthesize_polly(
    text: str,
    out_mp3: Path,
    *,
    voice_id: str = "Joanna",
    engine: str = "neural",
) -> dict:
    """Write MP3 via Polly. Stub writes silence-ish empty file marker."""
    script = (text or "").strip()[:2500]
    if _stub_mode() or not script:
        # Minimal valid-ish MPEG frame header padding — ffmpeg tolerates empty better with anvil
        out_mp3.write_bytes(b"")
        return {"ok": True, "stub": True, "bytes": 0}

    try:
        import boto3

        region = (
            os.environ.get("POLLY_REGION")
            or os.environ.get("AWS_REGION")
            or "us-east-1"
        )
        polly = boto3.client("polly", region_name=region)
        res = polly.synthesize_speech(
            Text=script,
            OutputFormat="mp3",
            VoiceId=voice_id,
            Engine=engine,
        )
        stream = res.get("AudioStream")
        if stream is None:
            return {"ok": False, "error": "Polly returned no AudioStream"}
        data = stream.read()
        out_mp3.write_bytes(data)
        return {"ok": True, "stub": False, "bytes": len(data)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _write_color_clip(path: Path, seconds: float, size: str = "1280x720") -> bool:
    ffmpeg = _which("ffmpeg")
    if not ffmpeg:
        return False
    w, h = size.split("x")
    cmd = [
        ffmpeg,
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=0x0b0c0f:s={w}x{h}:d={seconds}",
        "-f",
        "lavfi",
        "-i",
        f"anullsrc=r=44100:cl=stereo",
        "-c:v",
        "libx264",
        "-t",
        str(seconds),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return proc.returncode == 0 and path.is_file()


def _minimal_mp4(path: Path) -> None:
    """Write a tiny ftyp/mdat stub so local smoke has a downloadable file."""
    # Not a full MP4 — enough for artefact storage / JobCard download in stub mode.
    path.write_bytes(
        b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
        b"\x00\x00\x00\x08free"
        + b"\x00" * 64
    )


def compose_video(
    *,
    reel_mp4: Path | None,
    voiceover_script: str,
    out_mp4: Path,
    brand: str = "WalkCroach",
    aspect: str = "16:9",
    outro_sec: float = 2.0,
) -> dict:
    """
    Mux silent Reel (or color placeholder) + Polly + outro.
    aspect '9:16' → center-crop to 720x1280 after compose (D5).
    """
    ffmpeg = _which("ffmpeg")
    with tempfile.TemporaryDirectory(prefix="wc-compose-") as td:
        td_path = Path(td)
        audio = td_path / "vo.mp3"
        polly = synthesize_polly(voiceover_script, audio)
        if not polly.get("ok"):
            return {"ok": False, "error": f"polly failed: {polly.get('error')}"}

        base = td_path / "base.mp4"
        if reel_mp4 and reel_mp4.is_file() and reel_mp4.stat().st_size > 32:
            shutil.copyfile(reel_mp4, base)
        else:
            if not _write_color_clip(base, 30.0):
                if _stub_mode() or not ffmpeg:
                    _minimal_mp4(out_mp4)
                    return {
                        "ok": True,
                        "stub": True,
                        "path": str(out_mp4),
                        "note": "placeholder mp4 (no ffmpeg / no reel)",
                        "aspect": aspect,
                        "brand": brand,
                    }
                return {"ok": False, "error": "ffmpeg unavailable for placeholder reel"}

        outro = td_path / "outro.mp4"
        has_outro = _write_color_clip(outro, outro_sec)

        muxed = td_path / "muxed.mp4"
        if not ffmpeg:
            shutil.copyfile(base, out_mp4) if base.is_file() else _minimal_mp4(out_mp4)
            return {
                "ok": True,
                "stub": True,
                "path": str(out_mp4),
                "note": "copied reel without ffmpeg mux",
                "pollyStub": bool(polly.get("stub")),
                "aspect": aspect,
            }

        # Attach audio (replace or add)
        audio_args: list[str] = []
        if audio.is_file() and audio.stat().st_size > 0:
            audio_args = ["-i", str(audio)]
            map_args = ["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest"]
        else:
            map_args = ["-c", "copy"]

        cmd_mux = [
            ffmpeg,
            "-y",
            "-i",
            str(base),
            *audio_args,
            *map_args,
            str(muxed),
        ]
        proc = subprocess.run(cmd_mux, capture_output=True, text=True, timeout=180)
        partial_compose = False
        if proc.returncode != 0 or not muxed.is_file():
            # Fall back to video-only (Phase H2 — partial compose, not hard fail)
            shutil.copyfile(base, muxed)
            partial_compose = True

        final = muxed
        if has_outro and not partial_compose:
            concat_list = td_path / "concat.txt"
            concat_list.write_text(
                f"file '{muxed.as_posix()}'\nfile '{outro.as_posix()}'\n",
                encoding="utf-8",
            )
            with_outro = td_path / "with_outro.mp4"
            proc2 = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(concat_list),
                    "-c",
                    "copy",
                    str(with_outro),
                ],
                capture_output=True,
                text=True,
                timeout=180,
            )
            if proc2.returncode == 0 and with_outro.is_file():
                final = with_outro
            else:
                partial_compose = True

        # D5 — optional 9:16 center crop from 1280×720
        if aspect == "9:16" and not partial_compose:
            portrait = td_path / "portrait.mp4"
            # Center crop 720x1280 from 1280x720 is impossible without scale+pad;
            # scale to height 1280 then crop width 720.
            proc3 = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i",
                    str(final),
                    "-vf",
                    "scale=-2:1280,crop=720:1280",
                    "-c:a",
                    "copy",
                    str(portrait),
                ],
                capture_output=True,
                text=True,
                timeout=180,
            )
            if proc3.returncode == 0 and portrait.is_file():
                final = portrait
            else:
                partial_compose = True

        out_mp4.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(final, out_mp4)
        return {
            "ok": True,
            "stub": bool(polly.get("stub")) or _stub_mode(),
            "path": str(out_mp4),
            "bytes": out_mp4.stat().st_size,
            "aspect": aspect,
            "brand": brand,
            "pollyStub": bool(polly.get("stub")),
            "partialCompose": partial_compose,
            "note": "video-only mux fallback" if partial_compose else None,
        }
