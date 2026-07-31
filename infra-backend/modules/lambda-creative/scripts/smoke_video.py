"""Smoke: compose_video stub path (Phase D3)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "codes" / "src"))

os.environ.setdefault("VIDEO_STUDIO_STUB", "1")
os.environ.setdefault("LOCAL_ARTEFACTS_DIR", str(ROOT / ".local-artefacts"))

from handler import handler  # noqa: E402


def main() -> int:
    out = handler(
        {
            "action": "compose_video",
            "ownerId": "smoke-owner",
            "jobId": "00000000-0000-4000-8000-0000000000d3",
            "voiceoverScript": "WalkCroach presents a thirty second teaser.",
            "brand": "WalkCroach",
            "aspect": "16:9",
        }
    )
    print(json.dumps(out, indent=2)[:2000])
    if not out.get("ok"):
        print("FAIL", file=sys.stderr)
        return 1
    print("OK compose_video")
    # D5 crop path
    out2 = handler(
        {
            "action": "compose_video",
            "ownerId": "smoke-owner",
            "jobId": "00000000-0000-4000-8000-0000000000d5",
            "voiceoverScript": "Portrait crop smoke.",
            "brand": "WalkCroach",
            "aspect": "9:16",
        }
    )
    if not out2.get("ok"):
        print("FAIL 9:16", out2, file=sys.stderr)
        return 1
    print("OK compose_video 9:16")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
