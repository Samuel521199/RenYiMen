from __future__ import annotations

ANGLE_LABELS = {
    "REACTION": "吃瓜反应",
    "REACTION_ONLY": "吃瓜反应",
    "STANCE": "站队对抗",
    "RESULT": "结果情绪",
    "DISCUSSION": "评论引导",
    "LIGHT_GAME": "轻游戏带入",
}

IMAGE_TYPE_LABELS = {
    "REACTION": "单牛情绪图",
    "VS": "左右对抗图",
    "SCENE": "场景嵌入图",
}

COPY_STYLE_GUIDES = {
    "NEUTRAL": (
        "Write in a neutral, observational tone. "
        "No humor, no exaggeration, no game references. "
        "State the fact and the bull's reaction simply."
    ),
    "HYPE": (
        "Write with high energy and strong emotion. "
        "Use exclamation marks. Encourage audience interaction. "
        "Example ending: '你支持哪边？评论告诉我！'"
    ),
    "GOSSIP": (
        "Write in a gossipy, light-hearted tone. "
        "Sound like a friend sharing juicy news. "
        "Keep it casual and fun."
    ),
    "DISCUSS": (
        "Write as an open question inviting discussion. "
        "Stay neutral and balanced. "
        "End with a question to prompt comments."
    ),
    "FESTIVE": (
        "Write with joy and celebration. "
        "Keep it warm and inviting. "
        "A light game or activity reference is allowed."
    ),
}

RISK_CONSTRAINTS = {
    "HIGH": [
        "STRICT CONTENT RULES: No humor, no game elements, no entertainment framing.",
        "The bull's reaction must be neutral and observational only.",
        "Do NOT include casino chips, cards, dice, or any gambling imagery.",
    ],
    "MEDIUM": [
        "Keep content balanced and neutral.",
        "Do NOT include any game or gambling elements.",
    ],
    "LOW": [],
}

LANGUAGE_MAP = {
    "english": "English only",
    "taglish": "Taglish (Tagalog-English mix) only",
    "chinese": "Chinese (Simplified) only",
}


def build_draft_prompt(
    news_title: str,
    selected_angle: str,
    selected_action: str,
    selected_image_type: str,
    risk_level: str,
    allow_game_integration: bool,
    copy_style: str,
    image_language: str = "english",
    extra_prompt: str | None = None,
) -> str:
    parts: list[str] = []

    angle_label = ANGLE_LABELS.get(selected_angle, selected_angle)
    image_type_label = IMAGE_TYPE_LABELS.get(selected_image_type, selected_image_type)
    parts.append(
        f"Create a sketch draft for a social media image. "
        f"News topic: '{news_title}'. "
        f"Angle: {angle_label}. "
        f"Image layout: {image_type_label}. "
        f"Bull character action: {selected_action}."
    )

    if selected_image_type == "VS":
        parts.append(
            "Layout: two bull characters side by side facing each other, "
            "representing two opposing sides."
        )
    else:
        parts.append(
            "Single bull character centered. 3D cartoon style. "
            "Character must remain consistent with brand identity."
        )

    style_guide = COPY_STYLE_GUIDES.get(copy_style, "")
    if style_guide:
        parts.append(f"Caption style guidance: {style_guide}")

    for constraint in RISK_CONSTRAINTS.get(risk_level, []):
        parts.append(constraint)
    if not allow_game_integration:
        parts.append(
            "Do NOT include any game cards, casino chips, dice, "
            "slot machines, or gambling-related imagery."
        )

    if extra_prompt:
        parts.append(f"Additional notes: {extra_prompt}")

    lang_label = LANGUAGE_MAP.get(image_language, "English only")
    parts.append(f"IMPORTANT: All text visible in the image must be in {lang_label}.")
    parts.append(
        "The image is for Filipino Facebook audience. "
        "Keep all on-image text casual and short."
    )

    return "\n".join(parts)


def build_final_prompt(
    news_title: str,
    selected_angle: str,
    selected_action: str,
    selected_image_type: str,
    risk_level: str,
    allow_game_integration: bool,
    copy_style: str,
    ad_size: str = "1080x1080",
    image_language: str = "english",
    extra_prompt: str | None = None,
) -> str:
    parts: list[str] = []

    angle_label = ANGLE_LABELS.get(selected_angle, selected_angle)
    image_type_label = IMAGE_TYPE_LABELS.get(selected_image_type, selected_image_type)

    size_labels = {
        "1080x1080": "1080x1080px square (Facebook post)",
        "1080x1920": "1080x1920px vertical (TikTok/Reels)",
        "1080x566": "1080x566px landscape (Facebook cover)",
    }
    size_label = size_labels.get(ad_size, "1080x1080px square")

    parts.append(
        f"Create a high-quality final social media image. "
        f"News topic: '{news_title}'. "
        f"Angle: {angle_label}. "
        f"Image layout: {image_type_label}. "
        f"Bull character action: {selected_action}. "
        f"Output size: {size_label}."
    )

    if selected_image_type == "VS":
        parts.append(
            "Two bull characters placed on left and right halves, "
            "facing each other. Each side represents an opposing stance. "
            "3D cartoon render, vivid colors, clean background."
        )
    else:
        parts.append(
            "Single bull character. 3D cartoon render. "
            "Consistent character design: same proportions, colors, and style as brand identity. "
            "Clean composition suitable for social media feed."
        )

    parts.append(
        "Visual quality: unified color palette, consistent material and lighting, "
        "sharp details, professional finish."
    )

    style_guide = COPY_STYLE_GUIDES.get(copy_style, "")
    if style_guide:
        parts.append(f"Caption style: {style_guide}")

    for constraint in RISK_CONSTRAINTS.get(risk_level, []):
        parts.append(constraint)
    if not allow_game_integration:
        parts.append(
            "Do NOT include any game cards, casino chips, dice, "
            "slot machines, or gambling-related imagery."
        )

    if extra_prompt:
        parts.append(f"Additional notes: {extra_prompt}")

    lang_label = LANGUAGE_MAP.get(image_language, "English only")
    parts.append(f"IMPORTANT: All text visible in the image must be in {lang_label}.")
    parts.append(
        "The image is for Filipino Facebook audience. "
        "Keep all on-image text casual and short."
    )

    return "\n".join(parts)


def build_refine_prompt(
    original_prompt: str,
    refine_instructions: str,
) -> str:
    parts: list[str] = [
        "Refine the existing image based on the following instructions.",
        f"Refinement instructions: {refine_instructions}",
        "Maintain: character consistency, color palette, material, lighting, and overall composition.",
        "Do not change the core scene or character identity.",
        original_prompt,
    ]
    return "\n".join(parts)


def build_news_draft_prompt(
    title: str,
    topic_type: str,
    event_summary: str | None,
    main_entities: list[str] | None,
    event_action: str | None,
    event_result: str | None,
    emotion_direction: str | None,
    selected_angle: str,
    selected_action: str,
    selected_image_type: str,
    risk_level: str,
    allow_game_integration: bool,
    copy_style: str,
    ad_size: str = "1080x1080",
    image_language: str = "english",
    extra_prompt: str | None = None,
) -> str:
    """富字段版 Prompt，用于新闻推送工作流（trending-news）"""
    parts: list[str] = []

    angle_label = ANGLE_LABELS.get(selected_angle, selected_angle)
    image_type_label = IMAGE_TYPE_LABELS.get(selected_image_type, selected_image_type)

    size_labels = {
        "1080x1080": "1080x1080px square (Facebook post)",
        "1080x1920": "1080x1920px vertical (TikTok/Reels)",
        "1080x566": "1080x566px landscape (Facebook cover)",
    }
    size_label = size_labels.get(ad_size, "1080x1080px square")

    parts.append(
        f"Create a high-quality social media image for a news trending topic. "
        f"News headline: '{title}'. "
        f"Angle: {angle_label}. "
        f"Image layout: {image_type_label}. "
        f"Bull character action: {selected_action}. "
        f"Output size: {size_label}."
    )

    if event_summary:
        parts.append(f"Event context: {event_summary}")

    if main_entities:
        parts.append(f"Key entities involved: {', '.join(main_entities)}")

    if event_action:
        parts.append(f"What happened: {event_action}")
    if event_result:
        parts.append(f"Current situation: {event_result}")

    if emotion_direction:
        parts.append(f"Emotional tone of the audience: {emotion_direction}")

    if selected_image_type == "VS":
        parts.append(
            "Two bull characters placed on left and right halves, "
            "facing each other. 3D cartoon render, vivid colors."
        )
    else:
        parts.append(
            "Single bull character. 3D cartoon render. "
            "Consistent character design. Clean composition."
        )

    parts.append(
        "Visual quality: unified color palette, consistent material and lighting, "
        "sharp details, professional finish."
    )

    style_guide = COPY_STYLE_GUIDES.get(copy_style, "")
    if style_guide:
        parts.append(f"Caption style: {style_guide}")

    for constraint in RISK_CONSTRAINTS.get(risk_level, []):
        parts.append(constraint)
    if not allow_game_integration:
        parts.append(
            "Do NOT include any game cards, casino chips, dice, "
            "slot machines, or gambling-related imagery."
        )

    if extra_prompt:
        parts.append(f"Additional notes: {extra_prompt}")

    lang_label = LANGUAGE_MAP.get(image_language, "English only")
    parts.append(f"IMPORTANT: All text visible in the image must be in {lang_label}.")
    parts.append(
        "The image is for Filipino Facebook audience. "
        "Keep all on-image text casual and short."
    )

    return "\n".join(parts)
