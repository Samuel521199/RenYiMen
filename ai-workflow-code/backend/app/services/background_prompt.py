from __future__ import annotations

from collections.abc import Iterable


SIZE_MAP = {
    "1:1": "1024x1024",
    "4:5": "1024x1280",
    "16:9": "1920x1080",
    "9:16": "1080x1920",
}

GAME_FEEL_MAP = {
    "strong": "Strong fantasy game world atmosphere, magical lighting, vivid saturated colors, epic scene composition.",
    "medium": "Subtle game-inspired atmosphere, slightly magical lighting and color tone, feels like a game world without specific game props.",
    "weak": "Natural scene, clean and realistic, no game elements.",
}


def map_size_ratio_to_pixels(size_ratio: str) -> str:
    return SIZE_MAP.get(str(size_ratio or "").strip(), "1024x1024")


def _normalize_items(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = [item.strip() for item in value.replace(",", "、").split("、")]
        return [item for item in parts if item]
    if isinstance(value, Iterable):
        normalized: list[str] = []
        for item in value:
            text = str(item or "").strip()
            if text:
                normalized.append(text)
        return normalized
    text = str(value).strip()
    return [text] if text else []


def _join_for_label(value: object) -> str:
    items = _normalize_items(value)
    return ", ".join(items) if items else "Not specified"


def _join_whitespace_positions(value: object) -> str:
    items = _normalize_items(value)
    if not items:
        return "appropriate areas"
    if len(items) == 1:
        return f"{items[0]} area"
    if len(items) == 2:
        return f"{items[0]} and {items[1]} areas"
    return f"{', '.join(items[:-1])}, and {items[-1]} areas"


def build_background_prompt(batch: object) -> str:
    localized = bool(getattr(batch, "localized", False))
    localized_line = (
        "Subtle Philippines atmosphere, tropical lighting, Southeast Asia lifestyle hints."
        if localized
        else ""
    )
    purpose_value = str(getattr(batch, "purpose", "") or "").strip() or "Not specified"
    scene_value = str(getattr(batch, "scene", "") or "").strip() or "Not specified"
    color_style_value = str(getattr(batch, "color_style", "") or "").strip() or "Not specified"
    game_feel_value = str(getattr(batch, "game_feel", "") or "").strip().lower() or "medium"
    game_feel_line = GAME_FEEL_MAP.get(game_feel_value, GAME_FEEL_MAP["medium"])
    extra_prompt_value = str(getattr(batch, "extra_prompt", "") or "").strip()
    lines = [
        "Generate a high-quality social media background for a Philippines gaming platform.",
        "",
        f"Purpose: {purpose_value}",
        f"Scene: {scene_value}",
        f"Mood: {_join_for_label(getattr(batch, 'mood', []))}",
        f"Color style: {color_style_value}",
        f"Game feel direction: {game_feel_line}",
        "",
        "Style: High-quality 3D commercial social media background, clean, vibrant but controlled saturation, modern mobile game campaign style.",
        "",
        "Composition:",
        f"- {_join_whitespace_positions(getattr(batch, 'whitespace_positions', []))} reserved for text overlay",
        "- Clear depth and layering",
        "- Background should not compete with foreground elements",
        "",
    ]
    if localized_line:
        lines.extend([localized_line, ""])
    if extra_prompt_value:
        lines.extend(
            [
                "Additional details:",
                extra_prompt_value,
                "",
            ]
        )
    lines.extend(
        [
            f"Output size: {str(getattr(batch, 'size_ratio', '') or '').strip() or '16:9'}",
            "",
            "Restrictions:",
            "- No text, no logo, no watermark, no readable signs",
            "- No identifiable faces",
            "- No clutter, no distortion",
            "- No game props, coins, treasure boxes, or UI elements in the scene.",
            "- Keep whitespace areas clean and uncluttered",
            "",
            "Output: Reusable clean background asset",
        ]
    )
    return "\n".join(lines)


def append_refinement_instructions(prompt: str, refine_prompt: str | None) -> str:
    clean_refine_prompt = str(refine_prompt or "").strip()
    if not clean_refine_prompt:
        return prompt

    marker = "\nRestrictions:"
    if marker not in prompt:
        return "\n".join([prompt.rstrip(), "", "Refinement instructions:", clean_refine_prompt])

    prompt_head, prompt_tail = prompt.split(marker, 1)
    return "\n".join(
        [
            prompt_head.rstrip(),
            "",
            "Refinement instructions:",
            clean_refine_prompt,
            "",
            f"Restrictions:{prompt_tail}",
        ]
    )
