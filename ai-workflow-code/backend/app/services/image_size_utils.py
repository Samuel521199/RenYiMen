"""Normalize ad/task sizes before calling image generation providers."""

from __future__ import annotations

# Common UI/marketing sizes -> provider-safe pixels (multiples of 16).
_SIZE_ALIASES: dict[str, str] = {
    "1080x1080": "1024x1024",
    "1080x1920": "1088x1920",
    "1080x1350": "1088x1344",
    "1200x628": "1200x624",
}


def _snap_to_multiple(value: int, step: int = 16) -> int:
    if value <= 0:
        return step
    snapped = round(value / step) * step
    return max(step, snapped)


def normalize_generation_size(size: str | None) -> str:
    raw = str(size or "").strip().lower().replace(" ", "")
    if not raw:
        return "1024x1024"
    if raw in _SIZE_ALIASES:
        return _SIZE_ALIASES[raw]
    if "x" not in raw:
        return raw
    width_text, height_text = raw.split("x", 1)
    try:
        width = int(width_text)
        height = int(height_text)
    except ValueError:
        return raw
    return f"{_snap_to_multiple(width)}x{_snap_to_multiple(height)}"
