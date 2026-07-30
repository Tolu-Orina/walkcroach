"""lambda-creative handler — render_pptx + allowlisted run_skill_script.

Invoked by agent-harness via Lambda Invoke (or locally via `python -m handler`).
Actions:
  render_pptx      — brief → pptx → validate (fail closed) → thumbnail → S3
  run_skill_script — allowlisted script only
"""
from __future__ import annotations

import base64
import json
import os
import tempfile
import traceback
import uuid
from pathlib import Path
from typing import Any

from render_pptx import render_pptx
from run_skill_script import ALLOWED_SCRIPTS, run_skill_script


def _s3():
    import boto3

    return boto3.client("s3", region_name=os.environ.get("AWS_REGION", "eu-west-2"))


def _bucket() -> str | None:
    return os.environ.get("ARTEFACTS_BUCKET") or os.environ.get("ARTIFACTS_BUCKET") or None


def _put_bytes(key: str, body: bytes, content_type: str) -> str | None:
    bucket = _bucket()
    if not bucket:
        # Local/dev — write under .local-artefacts
        root = Path(os.environ.get("LOCAL_ARTEFACTS_DIR", ".local-artefacts"))
        path = root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return f"file://{path.resolve()}"
    _s3().put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
    return key


def _download_image(key_or_url: str, dest: Path) -> Path | None:
    if key_or_url.startswith("file://"):
        src = Path(key_or_url[7:])
        if src.is_file():
            dest.write_bytes(src.read_bytes())
            return dest
        return None
    if key_or_url.startswith("data:"):
        # data:image/png;base64,...
        try:
            b64 = key_or_url.split(",", 1)[1]
            dest.write_bytes(base64.b64decode(b64))
            return dest
        except Exception:
            return None
    bucket = _bucket()
    if not bucket:
        return None
    try:
        obj = _s3().get_object(Bucket=bucket, Key=key_or_url)
        dest.write_bytes(obj["Body"].read())
        return dest
    except Exception:
        return None


def handle_render_pptx(event: dict[str, Any]) -> dict[str, Any]:
    brief = event.get("brief") or {}
    owner_id = str(event.get("ownerId") or "anonymous")
    asset_id = str(event.get("assetId") or uuid.uuid4())
    image_refs: dict[str, str] = event.get("imageRefs") or {}

    with tempfile.TemporaryDirectory(prefix="wc-pptx-") as td:
        td_path = Path(td)
        out_pptx = td_path / f"{asset_id}.pptx"

        # Materialize optional slide images
        image_paths: dict[str, Path] = {}
        for key, ref in image_refs.items():
            dest = td_path / f"img-{key}.png"
            got = _download_image(str(ref), dest)
            if got:
                image_paths[key] = got

        render_pptx(brief, out_pptx, image_paths)

        # B4 — fail closed on validate
        validation = run_skill_script(
            "validate_pptx",
            [str(out_pptx), "--json"],
            timeout_s=60,
        )
        if not validation.ok:
            return {
                "ok": False,
                "error": "validate_pptx failed",
                "exitCode": validation.exit_code,
                "stdout": validation.stdout,
                "stderr": validation.stderr,
            }

        preview_key = None
        preview_note = None
        thumb_out = td_path / "grid"
        thumbnail = run_skill_script(
            "thumbnail_pptx",
            [str(out_pptx), str(thumb_out), "--cols", "3"],
            timeout_s=180,
        )
        if thumbnail.ok:
            # stdout is the .jpg path
            jpg_line = next(
                (ln.strip() for ln in thumbnail.stdout.splitlines() if ln.strip().endswith(".jpg")),
                None,
            )
            if jpg_line and Path(jpg_line).is_file():
                preview_bytes = Path(jpg_line).read_bytes()
                preview_key = f"creative/{owner_id}/{asset_id}/preview.jpg"
                _put_bytes(preview_key, preview_bytes, "image/jpeg")
            else:
                preview_note = "thumbnail produced no jpeg path"
        else:
            # LibreOffice may be absent in local/dev — deck still ships if validate passed
            preview_note = (
                f"thumbnail_pptx exit {thumbnail.exit_code}: "
                f"{(thumbnail.stderr or thumbnail.stdout)[:400]}"
            )

        pptx_bytes = out_pptx.read_bytes()
        s3_key = f"creative/{owner_id}/{asset_id}/deck.pptx"
        stored = _put_bytes(
            s3_key,
            pptx_bytes,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )

        title = str(brief.get("title") or "deck").strip() or "deck"
        safe_name = "".join(c if c.isalnum() or c in "-_ " else "" for c in title)[:60].strip() or "deck"
        return {
            "ok": True,
            "assetId": asset_id,
            "s3Key": s3_key if _bucket() else stored,
            "previewS3Key": preview_key,
            "previewNote": preview_note,
            "downloadName": f"{safe_name}.pptx",
            "slideCount": 1 + len(brief.get("slides") or []),
            "validation": json.loads(validation.stdout)
            if validation.stdout.strip().startswith("{")
            else {"ok": True},
        }


def handle_run_skill_script(event: dict[str, Any]) -> dict[str, Any]:
    name = str(event.get("script") or "")
    args = event.get("args") or []
    if not isinstance(args, list) or any(not isinstance(a, str) for a in args):
        return {"ok": False, "error": "args must be a list of strings"}
    if name not in ALLOWED_SCRIPTS:
        return {
            "ok": False,
            "error": f"script not allowlisted: {name}",
            "allowed": sorted(ALLOWED_SCRIPTS),
        }
    result = run_skill_script(name, args, timeout_s=int(event.get("timeoutS") or 120))
    return {
        "ok": result.ok,
        "exitCode": result.exit_code,
        "stdout": result.stdout[-8000:],
        "stderr": result.stderr[-4000:],
        "scriptPath": result.script_path,
    }


def handler(event: dict[str, Any], _context: Any = None) -> dict[str, Any]:
    action = str(event.get("action") or "render_pptx")
    try:
        if action == "render_pptx":
            return handle_render_pptx(event)
        if action == "run_skill_script":
            return handle_run_skill_script(event)
        return {"ok": False, "error": f"unknown action: {action}"}
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "error": str(e),
            "trace": traceback.format_exc()[-2000:],
        }


# Local CLI: python handler.py '{"action":"run_skill_script","script":"validate_pptx","args":["x.pptx"]}'
if __name__ == "__main__":
    import sys as _sys

    raw = _sys.stdin.read() if not _sys.argv[1:] else _sys.argv[1]
    print(json.dumps(handler(json.loads(raw)), indent=2))
