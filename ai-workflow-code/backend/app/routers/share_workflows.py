from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.asset import Asset
from app.models.gallery_tag import GalleryTag
from app.models.image import FinalImage
from app.models.model_config import ModelConfig
from app.models.task import Task
from app.models.workflow_session import WorkflowSession
from app.schemas.generate import ImageGenerateRequest
from app.schemas.share import (
    ShareBackgroundCreate,
    ShareBackgroundResponse,
    ShareBullActionCreate,
    ShareBullActionResponse,
    ShareColorMoodCreate,
    ShareColorMoodResponse,
    ShareGameInstructionCreate,
    ShareGameInstructionResponse,
    ShareGameInstructionUpdate,
    ShareJobCreate,
    ShareJobQCRequest,
    ShareJobRefineRequest,
    ShareJobResponse,
)
from app.services import ai_gateway
from app.utils.response import err, ok
from app.models.share import (
    ShareBackground,
    ShareBullAction,
    ShareColorMood,
    ShareGameInstruction,
    ShareJob,
)


router = APIRouter(tags=["share"])

SHARE_LANGUAGE_OPTIONS = {
    "english": "English only",
    "taglish": "Taglish (Tagalog-English mix) only",
    "chinese": "Chinese (Simplified) only",
}

SHARE_PROMPT_TEMPLATES = {
    "benefit": """
Create a high-conversion Facebook share image for a mobile card game.
THEME: Reward / bonus / limited-time benefit
CORE IDEA: User feels they will MISS OUT if not sharing
TEXT CONTENT: "{core_text}"
VISUAL: Bull mascot holding coins/reward/gift, excited expression, strong reward signal
STYLE: Clean 3D game style, bright, strong contrast
COMPOSITION: Big readable headline, reward visual center, minimal clutter
TEXT RULES: Very short (max 8 words), urgent or valuable
This image must make users want to share to friends to get benefits.
Do not add extra elements. Do not include long sentences.
CHARACTER CONSISTENCY: Same bull character, same proportions, face, outfit.
QUALITY: High quality 3D render, clean edges, no noise.
PLATFORM: Designed for Facebook feed, mobile-first readability.
""".strip(),
    "emotion": """
Create a highly relatable Facebook share image for card game players.
THEME: Strong emotional moment (lose, win, frustration, hype)
CORE IDEA: User shares because "THIS IS ME"
TEXT CONTENT: "{core_text}"
VISUAL: Bull mascot expressing strong emotion (rage, shock, hype), dynamic pose, exaggerated expression
STYLE: 3D cartoon, cinematic lighting, slight dramatic shadows
COMPOSITION: Focus on character emotion, simple background
TEXT RULES: Feels like a meme, casual, conversational
This image should feel like a meme users want to send to friends.
Do not add extra elements. Feels like something people send in chat.
CHARACTER CONSISTENCY: Same bull character, same proportions, face, outfit.
QUALITY: High quality 3D render, clean edges, no noise.
PLATFORM: Designed for Facebook feed, mobile-first readability.
""".strip(),
    "identity": """
Create a Facebook share image that expresses player identity.
THEME: Player type / skill level / personality
CORE IDEA: User shares to express identity
TEXT CONTENT: "{core_text}"
VISUAL: Bull mascot in specific role (pro player/newbie/risky player), confident or signature pose
STYLE: Clean 3D, slight stylized lighting
COMPOSITION: Character dominant, clear visual identity
TEXT RULES: Feels like a label, easy to understand instantly
User should feel proud or strongly identified with this image.
Do not add extra elements.
CHARACTER CONSISTENCY: Same bull character, same proportions, face, outfit.
QUALITY: High quality 3D render, clean edges, no noise.
PLATFORM: Designed for Facebook feed, mobile-first readability.
""".strip(),
    "information": """
Create a Facebook share image that delivers useful game tips.
THEME: Helpful advice / trick / strategy
CORE IDEA: User shares because it helps others
TEXT CONTENT: "{core_text}"
VISUAL: Bull mascot explaining or pointing, game-related elements (cards, table)
STYLE: Clean and clear, informational layout
COMPOSITION: Text readable first, supporting visuals
TEXT RULES: Clear and practical, no fluff
User should feel this is worth sharing to help friends.
Do not add extra elements.
CHARACTER CONSISTENCY: Same bull character, same proportions, face, outfit.
QUALITY: High quality 3D render, clean edges, no noise.
PLATFORM: Designed for Facebook feed, mobile-first readability.
""".strip(),
}


class ShareGenerateRequest(BaseModel):
    reference_asset_ids: list[int] = Field(default_factory=list)
    model_config_id: int
    game_instruction_contents: str = ""


class ShareGameTypeRenameRequest(BaseModel):
    old_game_type: str
    new_game_type: str


def error_response(message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=err(message, status_code))


def serialize_share_job(job: ShareJob) -> dict[str, Any]:
    if getattr(job, "image_language", None) is None:
        job.image_language = "english"
    if getattr(job, "game_type", None) is None:
        job.game_type = "Tongits"
    if getattr(job, "size", None) is None:
        job.size = "1080x1080"
    return ShareJobResponse.model_validate(job).model_dump(mode="json")


def serialize_share_option(option: Any, schema: type[Any]) -> dict[str, Any]:
    return schema.model_validate(option).model_dump(mode="json")


async def get_share_job_or_none(db: AsyncSession, job_id: int) -> ShareJob | None:
    result = await db.execute(select(ShareJob).where(ShareJob.id == job_id))
    return result.scalar_one_or_none()


async def get_workflow_session_or_none(
    db: AsyncSession,
    session_id: int | None,
) -> WorkflowSession | None:
    if session_id is None:
        return None
    result = await db.execute(select(WorkflowSession).where(WorkflowSession.id == session_id))
    return result.scalar_one_or_none()


async def resolve_reference_image_urls(
    db: AsyncSession,
    reference_asset_ids: list[int],
) -> list[str]:
    if not reference_asset_ids:
        return []

    selected_ids = reference_asset_ids[:4]
    result = await db.execute(select(Asset).where(Asset.id.in_(selected_ids)))
    assets_by_id = {asset.id: asset for asset in result.scalars().all()}
    return [
        assets_by_id[asset_id].url
        for asset_id in selected_ids
        if asset_id in assets_by_id and assets_by_id[asset_id].url
    ]


async def ensure_generation_task_id(
    db: AsyncSession,
    job: ShareJob,
    current_user_id: int,
) -> int:
    session = await get_workflow_session_or_none(db, job.session_id)
    if session is not None and session.task_id is not None:
        return session.task_id

    task = Task(
        title=f"Share - {job.share_type}",
        purpose="share",
        size=job.size or "1080x1080",
        description=job.core_text,
        status="created",
        creator_id=current_user_id,
    )
    db.add(task)
    await db.flush()

    if session is not None:
        session.task_id = task.id

    return task.id


def build_share_prompt(
    job: ShareJob,
    refine_prompt: str = "",
    game_instruction_contents: str = "",
) -> str:
    template = SHARE_PROMPT_TEMPLATES.get(job.share_type, SHARE_PROMPT_TEMPLATES["benefit"])
    parts = [template.format(core_text=job.core_text)]

    if job.target_audience:
        parts.append(f"TARGET AUDIENCE: {job.target_audience}")
    if job.game_type:
        parts.append(f"GAME: {job.game_type}")
    if game_instruction_contents.strip():
        parts.append(f"GAME VISUAL REQUIREMENTS:\n{game_instruction_contents.strip()}")
    if refine_prompt:
        parts.append(f"REFINEMENT: {refine_prompt}")

    lang_label = SHARE_LANGUAGE_OPTIONS.get(job.image_language or "english", "English only")
    parts.append(f"IMPORTANT: All text visible in the image must be in {lang_label}.")
    parts.append("The image is for Filipino Facebook audience. Keep all on-image text casual and short.")
    return "\n".join(parts)


async def list_share_options(
    db: AsyncSession,
    model: type[Any],
    schema: type[Any],
) -> list[dict[str, Any]]:
    result = await db.execute(select(model).order_by(model.id.asc()))
    return [serialize_share_option(item, schema) for item in result.scalars().all()]


async def create_share_option(
    db: AsyncSession,
    model: type[Any],
    req: Any,
    schema: type[Any],
) -> dict[str, Any]:
    result = await db.execute(select(model).where(model.value == req.value))
    existing = result.scalar_one_or_none()
    if existing is not None:
        return serialize_share_option(existing, schema)

    option = model(value=req.value, label_zh=req.label_zh)
    db.add(option)
    await db.commit()
    await db.refresh(option)
    return serialize_share_option(option, schema)


def serialize_share_game_instruction(item: ShareGameInstruction) -> dict[str, Any]:
    return ShareGameInstructionResponse.model_validate(item).model_dump(mode="json")


async def get_share_game_instruction_or_none(
    db: AsyncSession,
    instruction_id: int,
) -> ShareGameInstruction | None:
    result = await db.execute(
        select(ShareGameInstruction).where(ShareGameInstruction.id == instruction_id)
    )
    return result.scalar_one_or_none()


async def run_share_generation(
    db: AsyncSession,
    job: ShareJob,
    model_config_id: int,
    current_user_id: int,
    reference_asset_ids: list[int],
    game_instruction_contents: str = "",
    refine_prompt: str = "",
) -> tuple[ShareJob, Any]:
    model_result = await db.execute(select(ModelConfig).where(ModelConfig.id == model_config_id))
    model_config = model_result.scalar_one_or_none()
    if model_config is None:
        raise ValueError("Model config not found")

    job.model_config_id = model_config.id
    job.refine_prompt = refine_prompt or None
    job.status = "generating"
    task_id = await ensure_generation_task_id(db, job, current_user_id)
    reference_image_urls = await resolve_reference_image_urls(db, reference_asset_ids)
    prompt = build_share_prompt(
        job,
        refine_prompt=refine_prompt,
        game_instruction_contents=game_instruction_contents,
    )
    await db.commit()

    generation_request = ImageGenerateRequest(
        task_id=task_id,
        model_config_id=model_config.id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        mode="final",
        prompt=prompt,
        size=job.size or "1080x1080",
        count=1,
        reference_asset_ids=reference_asset_ids,
    )

    generation = await ai_gateway.generate_image(
        db,
        generation_request,
        reference_image_urls,
        user_id=int(current_user_id),
    )
    image_url = next(
        (
            item.get("url")
            for item in generation.images
            if isinstance(item, dict) and item.get("url")
        ),
        None,
    )
    if image_url is None:
        raise RuntimeError("Image generation returned no image URL")

    job.generated_image_url = image_url
    job.status = "pending"
    await db.commit()
    await db.refresh(job)
    return job, generation


@router.get("/api/share/bull-actions")
async def list_bull_actions(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await list_share_options(db, ShareBullAction, ShareBullActionResponse))


@router.post("/api/share/bull-actions")
async def create_bull_action(
    req: ShareBullActionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await create_share_option(db, ShareBullAction, req, ShareBullActionResponse))


@router.get("/api/share/backgrounds")
async def list_backgrounds(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await list_share_options(db, ShareBackground, ShareBackgroundResponse))


@router.post("/api/share/backgrounds")
async def create_background(
    req: ShareBackgroundCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await create_share_option(db, ShareBackground, req, ShareBackgroundResponse))


@router.get("/api/share/color-moods")
async def list_color_moods(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await list_share_options(db, ShareColorMood, ShareColorMoodResponse))


@router.post("/api/share/color-moods")
async def create_color_mood(
    req: ShareColorMoodCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await create_share_option(db, ShareColorMood, req, ShareColorMoodResponse))


@router.post("/api/share/jobs/create")
async def create_job(
    req: ShareJobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    if req.session_id is not None:
        session = await get_workflow_session_or_none(db, req.session_id)
        if session is None:
            return error_response("Workflow session not found", 404)

    job = ShareJob(
        session_id=req.session_id,
        share_type=req.share_type,
        core_text=req.core_text,
        target_audience=req.target_audience,
        game_type=req.game_type or "Tongits",
        image_language=req.image_language,
        size=req.size,
        status="pending",
        created_by=int(current_user["id"]),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return ok(serialize_share_job(job))


@router.post("/api/share/jobs/{job_id}/generate")
async def generate_job(
    job_id: int,
    body: ShareGenerateRequest = Body(default_factory=ShareGenerateRequest),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_share_job_or_none(db, job_id)
    if job is None:
        return error_response("Job not found", 404)

    try:
        refreshed_job, generation = await run_share_generation(
            db,
            job,
            body.model_config_id,
            int(current_user["id"]),
            body.reference_asset_ids,
            body.game_instruction_contents,
        )
    except ValueError as exc:
        return error_response(str(exc), 404)
    except RuntimeError as exc:
        job.status = "pending"
        await db.commit()
        return error_response(str(exc), 502)
    except Exception:
        job.status = "pending"
        await db.commit()
        raise

    return ok(
        {
            "job": serialize_share_job(refreshed_job),
            "generation": generation.model_dump(mode="json"),
        }
    )


@router.post("/api/share/jobs/{job_id}/qc")
async def qc_job(
    job_id: int,
    req: ShareJobQCRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_share_job_or_none(db, job_id)
    if job is None:
        return error_response("Job not found", 404)

    job.status = req.status
    final_image = None
    if req.status == "archived" and job.generated_image_url:
        session = await get_workflow_session_or_none(db, job.session_id)
        task_id = session.task_id if session is not None else None
        final_image = FinalImage(
            task_id=task_id,
            task_image_id=None,
            image_url=job.generated_image_url,
            prompt_used=None,
            tags=None,
            source_type="share",
            sub_category=job.share_type,
            style_tag=None,
            created_by=int(current_user["id"]),
        )
        db.add(final_image)

        tag_result = await db.execute(
            select(GalleryTag).where(
                GalleryTag.name == job.share_type,
                GalleryTag.source_type == "share",
            )
        )
        existing_tag = tag_result.scalar_one_or_none()
        if existing_tag is not None:
            existing_tag.image_count += 1
        else:
            db.add(
                GalleryTag(
                    name=job.share_type,
                    source_type="share",
                    image_count=1,
                )
            )

    await db.commit()
    await db.refresh(job)
    if final_image is not None:
        await db.refresh(final_image)
    return ok(serialize_share_job(job))


@router.post("/api/share/jobs/{job_id}/refine")
async def refine_job(
    job_id: int,
    req: ShareJobRefineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_share_job_or_none(db, job_id)
    if job is None:
        return error_response("Job not found", 404)
    if job.model_config_id is None:
        return error_response("Model config not found", 404)

    try:
        refreshed_job, generation = await run_share_generation(
            db,
            job,
            job.model_config_id,
            int(current_user["id"]),
            [],
            refine_prompt=req.refine_prompt,
        )
    except ValueError as exc:
        return error_response(str(exc), 404)
    except RuntimeError as exc:
        job.status = "pending"
        await db.commit()
        return error_response(str(exc), 502)
    except Exception:
        job.status = "pending"
        await db.commit()
        raise

    return ok(
        {
            "job": serialize_share_job(refreshed_job),
            "generation": generation.model_dump(mode="json"),
        }
    )


@router.get("/api/share/game-instructions")
async def list_share_game_instructions(
    game_type: str,
    include_disabled: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = (
        select(ShareGameInstruction)
        .where(ShareGameInstruction.game_type == game_type)
        .order_by(ShareGameInstruction.sort_order.asc(), ShareGameInstruction.id.asc())
    )
    if not include_disabled:
        query = query.where(ShareGameInstruction.enabled.is_(True))
    result = await db.execute(query)
    payload = [serialize_share_game_instruction(item) for item in result.scalars().all()]
    return ok(payload)


@router.post("/api/share/game-instructions")
async def create_share_game_instruction(
    req: ShareGameInstructionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    instruction = ShareGameInstruction(**req.model_dump())
    db.add(instruction)
    await db.commit()
    await db.refresh(instruction)
    return ok(serialize_share_game_instruction(instruction))


@router.put("/api/share/game-instructions/{id}")
async def update_share_game_instruction(
    id: int,
    req: ShareGameInstructionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    instruction = await get_share_game_instruction_or_none(db, id)
    if instruction is None:
        return error_response("Share game instruction not found", 404)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(instruction, field, value)
    await db.commit()
    await db.refresh(instruction)
    return ok(serialize_share_game_instruction(instruction))


@router.patch("/api/share/game-instructions/{id}/toggle")
async def toggle_share_game_instruction(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    instruction = await get_share_game_instruction_or_none(db, id)
    if instruction is None:
        return error_response("Share game instruction not found", 404)
    instruction.enabled = not instruction.enabled
    await db.commit()
    await db.refresh(instruction)
    return ok(serialize_share_game_instruction(instruction))


@router.delete("/api/share/game-instructions/{id}")
async def delete_share_game_instruction(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    instruction = await get_share_game_instruction_or_none(db, id)
    if instruction is None:
        return error_response("Share game instruction not found", 404)
    await db.delete(instruction)
    await db.commit()
    return ok({"deleted": id})


@router.get("/api/share/game-types")
async def get_share_game_types(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(ShareGameInstruction.game_type)
        .distinct()
        .order_by(ShareGameInstruction.game_type)
    )
    game_types = [row[0] for row in result.fetchall() if row[0]]
    return ok(game_types)


@router.put("/api/share/game-types/rename")
async def rename_share_game_type(
    req: ShareGameTypeRenameRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    old_game_type = req.old_game_type.strip()
    new_game_type = req.new_game_type.strip()
    if not old_game_type or not new_game_type:
        return error_response("游戏名称不能为空", 400)

    await db.execute(
        update(ShareGameInstruction)
        .where(ShareGameInstruction.game_type == old_game_type)
        .values(game_type=new_game_type)
    )
    await db.commit()
    return ok({"old": old_game_type, "new": new_game_type})
