"""Shared helpers for distinguishing image vs video model configs."""

VIDEO_MODEL_KEYWORDS = (
    "kling",
    "video",
    "wan",
    "vidu",
    "runway",
    "sora",
    "minimax-video",
    "hailuo",
    "veo",
)


def normalize_model_token(value: str | None) -> str:
    return (value or "").lower().replace("_", "-").replace(" ", "-")


def is_video_model_config(*, provider: str | None, model_name: str | None, name: str | None = None) -> bool:
    provider_normalized = normalize_model_token(provider)
    if provider_normalized in {"kling_video", "veo", "runway"}:
        return True

    haystacks = (normalize_model_token(model_name), normalize_model_token(name))
    return any(
        keyword in haystack
        for keyword in VIDEO_MODEL_KEYWORDS
        for haystack in haystacks
        if haystack
    )
