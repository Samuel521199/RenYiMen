def build_multi_fusion_prompt(user_prompt: str, reference_count: int) -> str:
    prompt = (user_prompt or "").strip()
    if reference_count >= 2:
        prefix = (
            f"You are given {reference_count} reference images "
            f"(Image 1 through Image {reference_count}). "
            "Follow the instructions below to compose or fuse elements from these images "
            "into a single cohesive output image. "
            "Maintain consistent lighting, perspective, and style unless instructed otherwise."
        )
        return f"{prefix}\n\n{prompt}"
    if reference_count == 1:
        prefix = (
            "Use the provided reference image as guidance. "
            "Preserve key visual elements as described below."
        )
        return f"{prefix}\n\n{prompt}"
    return prompt
