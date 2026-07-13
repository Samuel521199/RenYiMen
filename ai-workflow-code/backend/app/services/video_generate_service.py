"""
Video generation service for 302.ai Kling video models.
Handles async task submission and polling.
"""

import asyncio
import base64
import logging
import mimetypes
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import SessionLocal
from app.models.model_config import ModelConfig
from app.models.video import VideoDraft, VideoJob
from app.services.storage_service import resolve_static_file_path
from app.services.user_model_api_key_service import apply_user_api_key_override


logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 8
MAX_POLL_ATTEMPTS = 60  # 8min max


async def _get_video_model_config(
    db: AsyncSession,
    model_config_id: int,
) -> ModelConfig:
    result = await db.execute(
        select(ModelConfig).where(
            ModelConfig.id == model_config_id,
            ModelConfig.active == True,  # noqa: E712
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise ValueError(f"Model config {model_config_id} not found or inactive")
    return config


async def _image_url_to_base64(image_url: str) -> str | None:
    """
    Download image from URL and convert to base64 data URI.
    Supports http URLs and local `/static/...` paths under STORAGE_LOCAL_PATH.
    """
    try:
        static_path = resolve_static_file_path(image_url)
        if static_path is not None:
            content = static_path.read_bytes()
            mime_type = mimetypes.guess_type(static_path.name)[0] or "image/jpeg"
            encoded = base64.b64encode(content).decode()
            logger.info(
                "Loaded first frame from storage: path=%s bytes=%d mime=%s",
                static_path,
                len(content),
                mime_type,
            )
            return f"data:{mime_type};base64,{encoded}"

        if image_url.startswith("http://localhost") or image_url.startswith("http://127.0.0.1"):
            internal_url = image_url.replace("localhost", "host.docker.internal").replace(
                "127.0.0.1", "host.docker.internal"
            )
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(internal_url)
                if resp.status_code == 200:
                    content_type = resp.headers.get("content-type", "image/jpeg")
                    encoded = base64.b64encode(resp.content).decode()
                    return f"data:{content_type};base64,{encoded}"

        if image_url.startswith("http"):
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(image_url)
                if resp.status_code == 200:
                    content_type = resp.headers.get("content-type", "image/jpeg")
                    encoded = base64.b64encode(resp.content).decode()
                    return f"data:{content_type};base64,{encoded}"
    except Exception as exc:
        logger.warning("Failed to convert image to base64: %s - %s", image_url, exc)
    return None


async def submit_video_task(
    model_config: ModelConfig,
    prompt: str,
    image_url: str,
    duration: int = 5,
    aspect_ratio: str = "9:16",
    negative_prompt: str = "",
    sound: bool = False,
) -> str:
    """
    Submit a video generation task to 302.ai.
    Returns requestId for polling.
    """
    base_url = (model_config.base_url or "https://api.302.ai/ws/api/v3").rstrip("/")
    model_name = model_config.model_name
    endpoint = f"{base_url}/{model_name}"

    payload: dict = {
        "prompt": prompt,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "sound": sound,
    }

    if negative_prompt:
        payload["negative_prompt"] = negative_prompt

    if image_url:
        image_b64 = await _image_url_to_base64(image_url)
        if image_b64:
            payload["image"] = image_b64
            logger.info("Image converted to base64 successfully")
        else:
            storage_root = settings.storage_local_path
            raise ValueError(
                f"Could not load first frame image for video generation: {image_url} "
                f"(storage root: {storage_root})"
            )

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            endpoint,
            json=payload,
            headers={
                "Authorization": f"Bearer {model_config.api_key}",
                "Content-Type": "application/json",
            },
        )
        if resp.status_code >= 400:
            logger.error(
                "302.ai error: status=%d body=%s",
                resp.status_code,
                resp.text[:500],
            )
        resp.raise_for_status()
        data = resp.json()

    inner = data.get("data") or {}
    request_id = (
        inner.get("id")
        or inner.get("requestId")
        or inner.get("request_id")
        or inner.get("task_id")
        or data.get("id")
        or data.get("requestId")
    )
    if not request_id:
        raise ValueError(f"No requestId in response: {data}")
    return str(request_id)


async def poll_video_result(
    model_config: ModelConfig,
    request_id: str,
) -> dict:
    """
    Poll 302.ai for video task result.
    Returns dict with status and video_url when done.
    """
    base_url = (model_config.base_url or "https://api.302.ai/ws/api/v3").rstrip("/")
    poll_url = f"{base_url}/predictions/{request_id}/result"

    for attempt in range(MAX_POLL_ATTEMPTS):
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    poll_url,
                    headers={"Authorization": f"Bearer {model_config.api_key}"},
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.warning("Poll attempt %d failed: %s", attempt + 1, exc)
            continue

        inner_data = data.get("data") or data
        status = (inner_data.get("status") or "pending").lower()

        logger.info(
            "poll_video_result: attempt=%d request_id=%s status=%s",
            attempt + 1,
            request_id,
            status,
        )

        if status in ("succeeded", "success", "completed", "done"):
            outputs = inner_data.get("outputs") or []
            video_url = (
                outputs[0] if outputs else None
            ) or inner_data.get("output") or inner_data.get("video_url") or inner_data.get("url")
            return {"status": "done", "video_url": video_url}

        if status in ("failed", "error", "cancelled"):
            error = inner_data.get("error") or data.get("message") or "Unknown error"
            return {"status": "failed", "error": error}

    return {"status": "timeout", "error": "Polling timeout after 8 minutes"}


async def generate_video_draft(
    db: AsyncSession,
    job: VideoJob,
    model_config: ModelConfig,
    prompt: str,
    negative_prompt: str = "",
    aspect_ratio: str = "9:16",
    duration: int = 5,
    sound: bool = False,
    draft_type: str = "draft",
    user_id: int | None = None,
) -> VideoDraft:
    """Full flow: submit task → poll → save draft."""
    await apply_user_api_key_override(db, user_id, model_config)
    draft = VideoDraft(
        video_job_id=job.id,
        model=model_config.model_name,
        draft_type=draft_type,
        thumbnail_url=job.first_frame_url,
        status="generating",
        generation_cost=0,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    try:
        request_id = await submit_video_task(
            model_config=model_config,
            prompt=prompt,
            image_url=job.first_frame_url or "",
            duration=duration,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            sound=sound,
        )
        draft.external_task_id = request_id
        await db.commit()
        logger.info("Video task submitted: request_id=%s draft_id=%s", request_id, draft.id)

        result = await poll_video_result(model_config, request_id)

        if result["status"] == "done":
            draft.video_url = result.get("video_url")
            draft.status = "done"
            draft.duration_seconds = duration
            draft.generation_cost = float(model_config.price_per_image or 0)
        else:
            draft.status = "failed"
            logger.error("Video generation failed: %s", result.get("error"))

        await db.commit()
        await db.refresh(draft)

    except Exception as exc:
        logger.exception("Video generation exception: %s", exc)
        draft.status = "failed"
        await db.commit()

    return draft


async def run_generate_video_draft_task(
    job_id: UUID,
    model_config_id: int,
    prompt: str,
    negative_prompt: str = "",
    aspect_ratio: str = "9:16",
    duration: int = 5,
    sound: bool = False,
    draft_type: str = "draft",
    user_id: int | None = None,
) -> None:
    """Background-task wrapper that owns its own database session."""
    async with SessionLocal() as db:
        job_result = await db.execute(select(VideoJob).where(VideoJob.id == job_id))
        job = job_result.scalar_one_or_none()
        if job is None:
            logger.warning("Video job not found for draft generation: %s", job_id)
            return

        model_config = await _get_video_model_config(db, model_config_id)
        await generate_video_draft(
            db=db,
            job=job,
            model_config=model_config,
            prompt=prompt,
            negative_prompt=negative_prompt,
            aspect_ratio=aspect_ratio,
            duration=duration,
            sound=sound,
            draft_type=draft_type,
            user_id=user_id,
        )
