"""WalkCroach flyer renderer — HTML template pack → one-page PDF.

Phase C1: fills Graphite Lumen HTML templates, writes PDF (Playwright when
available, ReportLab twin otherwise so local/CI stay unblocked), then callers
run check_flyer_pdf + pdf_to_images.
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

from run_skill_script import skills_root

# Graphite Lumen defaults
DEFAULT_PALETTE = {
    "bg": "#0b0c0f",
    "panel": "#14161b",
    "fg": "#f2f3f5",
    "mist": "#9198a4",
    "accent": "#f0b429",
    "steel": "#6b9eff",
}

TEMPLATES = ("sale", "event", "announcement")


def _templates_dir() -> Path:
    return skills_root() / "walkcroach-flyer" / "templates"


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def resolve_template(name: str | None) -> str:
    t = (name or "sale").strip().lower()
    return t if t in TEMPLATES else "sale"


def fill_html(brief: dict[str, Any]) -> tuple[str, str]:
    """Return (template_name, filled_html)."""
    template = resolve_template(str(brief.get("template") or "sale"))
    path = _templates_dir() / f"{template}.html"
    if not path.is_file():
        raise FileNotFoundError(f"flyer template missing: {path}")
    raw = path.read_text(encoding="utf-8")

    palette = {**DEFAULT_PALETTE}
    user_palette = brief.get("palette")
    if isinstance(user_palette, dict):
        for k, v in user_palette.items():
            if k in palette and isinstance(v, str) and re.fullmatch(r"#?[0-9a-fA-F]{6}", v):
                palette[k] = v if v.startswith("#") else f"#{v}"
    elif isinstance(user_palette, list):
        # Map ordered hex list → bg, fg, accent, steel
        hexes = [
            (h if str(h).startswith("#") else f"#{h}")
            for h in user_palette
            if isinstance(h, str) and re.fullmatch(r"#?[0-9a-fA-F]{6}", str(h))
        ]
        if len(hexes) >= 1:
            palette["bg"] = hexes[0]
        if len(hexes) >= 2:
            palette["fg"] = hexes[1]
        if len(hexes) >= 3:
            palette["accent"] = hexes[2]
        if len(hexes) >= 4:
            palette["steel"] = hexes[3]

    fields = {
        "brand": str(brief.get("brand") or "WalkCroach")[:80],
        "eyebrow": str(brief.get("eyebrow") or "Now on")[:80],
        "headline": str(brief.get("headline") or brief.get("title") or "Untitled")[:120],
        "support": str(brief.get("support") or brief.get("subtitle") or "")[:280],
        "cta": str(brief.get("cta") or "Learn more")[:60],
        "meta": str(brief.get("meta") or "")[:120],
        "location": str(brief.get("location") or brief.get("meta") or "")[:120],
        **palette,
    }
    filled = raw
    for key, val in fields.items():
        filled = filled.replace("{{" + key + "}}", _esc(val) if key not in palette else val)
    # Strip any leftover placeholders
    filled = re.sub(r"\{\{[a-z_]+\}\}", "", filled)
    return template, filled


def _pdf_via_playwright(html_path: Path, out_pdf: Path) -> bool:
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        return False
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(html_path.resolve().as_uri(), wait_until="load")
            page.pdf(
                path=str(out_pdf),
                format="A4",
                print_background=True,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            )
            browser.close()
        return out_pdf.is_file()
    except Exception:
        return False


def _pdf_via_reportlab(brief: dict[str, Any], out_pdf: Path) -> None:
    """Twin layout for local/CI when Chromium is unavailable — same field map."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.colors import HexColor, Color
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm

    template = resolve_template(str(brief.get("template") or "sale"))
    palette = {**DEFAULT_PALETTE}
    user_palette = brief.get("palette")
    if isinstance(user_palette, list):
        hexes = [
            (h if str(h).startswith("#") else f"#{h}")
            for h in user_palette
            if isinstance(h, str) and re.fullmatch(r"#?[0-9a-fA-F]{6}", str(h))
        ]
        if len(hexes) >= 1:
            palette["bg"] = hexes[0]
        if len(hexes) >= 2:
            palette["fg"] = hexes[1]
        if len(hexes) >= 3:
            palette["accent"] = hexes[2]
        if len(hexes) >= 4:
            palette["steel"] = hexes[3]

    brand = str(brief.get("brand") or "WalkCroach")[:80]
    eyebrow = str(brief.get("eyebrow") or "Now on")[:80]
    headline = str(brief.get("headline") or brief.get("title") or "Untitled")[:120]
    support = str(brief.get("support") or brief.get("subtitle") or "")[:280]
    cta = str(brief.get("cta") or "Learn more")[:60]
    meta = str(brief.get("meta") or "")[:120]

    w, h = A4
    c = canvas.Canvas(str(out_pdf), pagesize=A4)

    if template == "announcement":
        bg, fg, accent, steel, mist = (
            HexColor(palette["fg"]),
            HexColor(palette["bg"]),
            HexColor(palette["accent"]),
            HexColor(palette["steel"]),
            HexColor(palette["mist"]),
        )
    else:
        bg, fg, accent, steel, mist = (
            HexColor(palette["bg"]),
            HexColor(palette["fg"]),
            HexColor(palette["accent"]),
            HexColor(palette["steel"]),
            HexColor(palette["mist"]),
        )

    c.setFillColor(bg)
    c.rect(0, 0, w, h, fill=1, stroke=0)

    # Soft atmosphere blobs (not purple gradients)
    c.setFillColor(Color(accent.red, accent.green, accent.blue, alpha=0.12))
    c.circle(w * 0.82, h * 0.78, 90 * mm, fill=1, stroke=0)
    c.setFillColor(Color(steel.red, steel.green, steel.blue, alpha=0.10))
    c.circle(w * 0.12, h * 0.18, 70 * mm, fill=1, stroke=0)

    left = 16 * mm
    y = h - 22 * mm
    c.setFillColor(fg)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left, y, brand.upper())

    y -= 28 * mm
    c.setFillColor(steel)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(left, y, eyebrow.upper())

    y -= 14 * mm
    c.setFillColor(fg)
    c.setFont("Helvetica-Bold", 32)
    # Simple wrap
    words = headline.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if c.stringWidth(trial, "Helvetica-Bold", 32) > w - 40 * mm and cur:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    if cur:
        lines.append(cur)
    for line in lines[:4]:
        c.drawString(left, y, line)
        y -= 12 * mm

    y -= 4 * mm
    c.setFillColor(mist)
    c.setFont("Helvetica", 12)
    sw = support
    while sw:
        chunk = sw
        while c.stringWidth(chunk, "Helvetica", 12) > w - 50 * mm and len(chunk) > 10:
            chunk = chunk.rsplit(" ", 1)[0]
        if not chunk:
            break
        c.drawString(left, y, chunk)
        y -= 6 * mm
        sw = sw[len(chunk) :].lstrip()
        if y < 60 * mm:
            break

    # CTA pill
    cta_y = 28 * mm
    c.setFillColor(accent)
    cta_w = c.stringWidth(cta, "Helvetica-Bold", 12) + 16 * mm
    c.roundRect(left, cta_y, cta_w, 10 * mm, 2 * mm, fill=1, stroke=0)
    c.setFillColor(HexColor(palette["bg"]) if template != "announcement" else HexColor(palette["fg"]))
    if template == "announcement":
        c.setFillColor(HexColor(palette["bg"]))
        c.setStrokeColor(accent)
        c.setLineWidth(2)
        c.roundRect(left, cta_y, cta_w, 10 * mm, 2 * mm, fill=0, stroke=1)
        c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left + 8 * mm, cta_y + 3.2 * mm, cta)

    if meta:
        c.setFillColor(mist)
        c.setFont("Helvetica", 9)
        c.drawString(left, 18 * mm, meta)

    # Sparse amber stripe
    c.setFillColor(accent)
    c.rect(left, 12 * mm, 18 * mm, 1.2 * mm, fill=1, stroke=0)

    c.showPage()
    c.save()


def render_flyer(
    brief: dict[str, Any],
    out_pdf: Path,
    *,
    html_out: Path | None = None,
) -> dict[str, Any]:
    """Render a one-page flyer PDF. Returns metadata including template + engine."""
    template, filled = fill_html(brief)
    html_path = html_out or out_pdf.with_suffix(".html")
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(filled, encoding="utf-8")

    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    engine = "playwright" if _pdf_via_playwright(html_path, out_pdf) else "reportlab"
    if engine == "reportlab":
        _pdf_via_reportlab(brief, out_pdf)

    if not out_pdf.is_file():
        raise RuntimeError("flyer PDF was not produced")

    return {
        "template": template,
        "engine": engine,
        "htmlPath": str(html_path),
        "pdfPath": str(out_pdf),
    }
