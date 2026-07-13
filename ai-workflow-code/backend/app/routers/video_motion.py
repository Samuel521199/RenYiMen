import base64
import json
import re
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.model_config import ModelConfig
from app.models.video import VideoDraft, VideoJob, VideoMotionData
from app.services.user_model_api_key_service import apply_user_api_key_override
from app.schemas.video import VideoMotionDataCreate, VideoMotionDataResponse
from app.services.video_service import build_motion_sequence
from app.services.storage_service import resolve_static_file_path
from app.utils.response import ok


router = APIRouter(prefix="/api/video/motion", tags=["video-motion"])


@router.get("/{job_id}", response_model=dict)
async def get_motion_data(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """获取动作结构数据"""
    result = await db.execute(select(VideoMotionData).where(VideoMotionData.video_job_id == job_id))
    motion = result.scalar_one_or_none()
    if not motion:
        return ok(None)
    return ok(VideoMotionDataResponse.model_validate(motion).model_dump(mode="json"))


@router.post("/{job_id}", response_model=dict)
async def save_motion_data(
    job_id: UUID,
    body: VideoMotionDataCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """保存动作结构数据"""
    job_result = await db.execute(select(VideoJob).where(VideoJob.id == job_id))
    job = job_result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Video job not found")

    motion_sequence, timing = build_motion_sequence(
        [{"timestamp": keypoint.timestamp, "label": keypoint.label} for keypoint in body.raw_keypoints]
    )

    existing_result = await db.execute(select(VideoMotionData).where(VideoMotionData.video_job_id == job_id))
    motion = existing_result.scalar_one_or_none()

    raw_keypoints = [{"timestamp": keypoint.timestamp, "label": keypoint.label} for keypoint in body.raw_keypoints]

    if motion:
        motion.motion_sequence = motion_sequence
        motion.timing = timing
        motion.camera = body.camera
        motion.emotion = body.emotion
        motion.scene = body.scene
        motion.raw_keypoints = raw_keypoints
    else:
        motion = VideoMotionData(
            video_job_id=job_id,
            motion_sequence=motion_sequence,
            timing=timing,
            camera=body.camera,
            emotion=body.emotion,
            scene=body.scene,
            raw_keypoints=raw_keypoints,
        )
        db.add(motion)

    await db.commit()
    await db.refresh(motion)
    return ok(VideoMotionDataResponse.model_validate(motion).model_dump(mode="json"))


class AutoExtractRequest(BaseModel):
    draft_video_url: str
    model_config_id: int
    duration: float = 5.0


class VideoQualityScoreRequest(BaseModel):
    draft_ids: list[UUID] | None = None
    draft_type: str | None = None
    model_config_id: int | None = None
    threshold: int = 75


def _grade_from_score(score: int) -> str:
    if score >= 88:
        return "A"
    if score >= 76:
        return "B"
    if score >= 60:
        return "C"
    return "D"


def _clamp_score(value: Any, default: int = 0) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        number = default
    return max(0, min(100, number))


def _extract_json_object(text: str) -> dict[str, Any]:
    json_match = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not json_match:
        raise ValueError("No JSON object found in model output")
    payload = json.loads(json_match.group())
    if not isinstance(payload, dict):
        raise ValueError("Parsed payload is not an object")
    return payload


def _normalize_asset_url(url: str) -> str:
    value = (url or "").strip()
    if value.startswith("/api/workbench/static/"):
        return value.removeprefix("/api/workbench")
    if value.startswith("/api/workbench"):
        return value.removeprefix("/api/workbench")
    return value


async def _download_video_bytes(url: str) -> bytes:
    normalized = _normalize_asset_url(url)
    static_path = resolve_static_file_path(normalized)
    if static_path is not None:
        return static_path.read_bytes()

    if normalized.startswith("http"):
        target = normalized
    else:
        target = f"http://host.docker.internal:8000{normalized}"

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(target)
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to download draft video")
        return response.content


async def _resolve_video_analysis_model(
    db: AsyncSession,
    current_user_id: int,
    model_config_id: int | None,
) -> ModelConfig:
    if model_config_id is not None:
        result = await db.execute(
            select(ModelConfig).where(
                ModelConfig.id == model_config_id,
                ModelConfig.active == True,  # noqa: E712
            )
        )
        config = result.scalar_one_or_none()
    else:
        result = await db.execute(
            select(ModelConfig)
            .where(
                ModelConfig.purpose == "video_analysis",
                ModelConfig.active == True,  # noqa: E712
            )
            .order_by(ModelConfig.id.desc())
        )
        config = result.scalars().first()

    if config is None:
        raise HTTPException(status_code=404, detail="No active video analysis model config found")

    await apply_user_api_key_override(db, current_user_id, config)
    return config


async def _run_video_quality_scoring(
    mc: ModelConfig,
    video_bytes: bytes,
) -> dict[str, Any]:
    base_url = (mc.base_url or "https://api.302.ai/v1").rstrip("/")
    api_key = mc.api_key
    video_b64 = base64.b64encode(video_bytes).decode()
    prompt_text = (
        "You are a strict video quality auditor for social media operations. "
        "Evaluate this short video and return JSON only, no markdown, no explanation. "
        'Schema: {"overall_score":0-100,"consistency_score":0-100,"motion_score":0-100,"visual_score":0-100,'
        '"text_clean_score":0-100,"reasons":["short reason"],"suggestions":["short suggestion"]}. '
        "Scoring rule: focus on character consistency, motion smoothness, visual clarity, and text/watermark cleanliness."
    )
    payload = {
        "model": mc.model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": f"data:video/mp4;base64,{video_b64}"}},
                ],
            }
        ],
        "max_tokens": 1200,
        "temperature": 0.2,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Video analysis API error: {response.text}")
        result = response.json()

    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str):
        content = str(content)
    return _extract_json_object(content)


@router.post("/auto-extract/{job_id}", response_model=dict)
async def auto_extract_motion(
    job_id: UUID,
    body: AutoExtractRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """用 Gemini 视频分析自动提炼动作结构"""
    mc_result = await db.execute(
        select(ModelConfig).where(
            ModelConfig.id == body.model_config_id,
            ModelConfig.active == True,  # noqa: E712
        )
    )
    mc = mc_result.scalar_one_or_none()
    if mc is None:
        raise HTTPException(status_code=404, detail="Model config not found or inactive")

    await apply_user_api_key_override(db, int(current_user["id"]), mc)
    base_url = (mc.base_url or "https://api.302.ai/v1").rstrip("/")
    api_key = mc.api_key

    async with httpx.AsyncClient(timeout=60) as client:
        video_resp = await client.get(body.draft_video_url)
        if video_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to download draft video")
        video_b64 = base64.b64encode(video_resp.content).decode()

    prompt_text = (
        "Analyze this video clip carefully. "
        "Return JSON only, no markdown, no explanation. "
        'Format: {"segments": [{"start": 0.0, "end": 1.0, "emotion": "happy", "action": "standing", "description": "brief English description"}]}. '
        "Divide the video into 3-6 meaningful segments based on character actions and emotions. "
        "Emotion options: excited, happy, confident, playful, focused, surprised, determined, joyful, energetic, calm, curious, proud, cheerful, passionate, friendly. "
        "Action options: walking, jumping, waving, pointing, running, dancing, sitting, standing, reaching, clapping, cheering, spinning, posing."
    )

    gemini_payload = {
        "model": mc.model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:video/mp4;base64,{video_b64}"},
                    },
                ],
            }
        ],
        "max_tokens": 2000,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            json=gemini_payload,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Gemini API error: {resp.text}")
        result = resp.json()

    content = result["choices"][0]["message"]["content"]
    json_match = re.search(r"\{.*\}", content, re.DOTALL)
    if not json_match:
        raise HTTPException(status_code=502, detail="Failed to parse Gemini response")

    segments = json.loads(json_match.group())["segments"]

    keypoints = []
    label_map = {
        "excited": "surprised and delighted, eyes wide open with joy",
        "happy": "happy, smiling and cheerful",
        "confident": "moves forward toward camera",
        "playful": "waves hand to greet",
        "focused": "slowly looks up",
        "surprised": "shocked and stunned, jaw dropped",
        "determined": "nods head in agreement",
        "joyful": "laughing out loud",
        "energetic": "turns around",
        "calm": "idle, subtle breathing",
        "curious": "slowly looks down",
        "proud": "happy, smiling and cheerful",
        "cheerful": "laughing out loud",
        "passionate": "surprised and delighted, eyes wide open with joy",
        "friendly": "waves hand to greet",
        "walking": "moves forward toward camera",
        "jumping": "surprised and delighted, eyes wide open with joy",
        "waving": "waves hand to greet",
        "pointing": "slowly looks up",
        "running": "moves forward toward camera",
        "dancing": "turns around",
        "sitting": "idle, subtle breathing",
        "standing": "idle, subtle breathing",
        "reaching": "slowly looks up",
        "clapping": "laughing out loud",
        "cheering": "surprised and delighted, eyes wide open with joy",
        "spinning": "turns around",
        "posing": "happy, smiling and cheerful",
    }
    for seg in segments:
        action = seg.get("action", "standing")
        emotion = seg.get("emotion", "calm")
        label = label_map.get(emotion, label_map.get(action, "idle, subtle breathing"))
        keypoints.append(
            {
                "timestamp": float(seg["start"]),
                "label": label,
                "description": seg.get("description", ""),
            }
        )

    return ok({"keypoints": keypoints, "segments": segments})


@router.post("/quality-score/{job_id}", response_model=dict)
async def quality_score_video_drafts(
    job_id: UUID,
    body: VideoQualityScoreRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """使用真实视频分析模型进行质检打分"""
    job_result = await db.execute(select(VideoJob).where(VideoJob.id == job_id))
    job = job_result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Video job not found")

    query = select(VideoDraft).where(
        VideoDraft.video_job_id == job_id,
        VideoDraft.video_url.is_not(None),
    )
    if body.draft_type:
        query = query.where(VideoDraft.draft_type == body.draft_type)
    if body.draft_ids:
        query = query.where(VideoDraft.id.in_(body.draft_ids))

    result = await db.execute(query.order_by(VideoDraft.created_at.asc()))
    drafts = result.scalars().all()
    if not drafts:
        return ok({"items": [], "threshold": body.threshold})

    model_config = await _resolve_video_analysis_model(
        db,
        int(current_user["id"]),
        body.model_config_id,
    )

    items: list[dict[str, Any]] = []
    for draft in drafts:
        try:
            video_bytes = await _download_video_bytes(str(draft.video_url))
            model_result = await _run_video_quality_scoring(model_config, video_bytes)
            score = _clamp_score(model_result.get("overall_score"), default=0)
            reasons = model_result.get("reasons")
            suggestions = model_result.get("suggestions")
            items.append(
                {
                    "draft_id": str(draft.id),
                    "score": score,
                    "grade": _grade_from_score(score),
                    "pass": score >= body.threshold,
                    "consistency_score": _clamp_score(model_result.get("consistency_score"), default=score),
                    "motion_score": _clamp_score(model_result.get("motion_score"), default=score),
                    "visual_score": _clamp_score(model_result.get("visual_score"), default=score),
                    "text_clean_score": _clamp_score(model_result.get("text_clean_score"), default=score),
                    "reasons": reasons if isinstance(reasons, list) else [],
                    "suggestions": suggestions if isinstance(suggestions, list) else [],
                }
            )
        except Exception as exc:
            items.append(
                {
                    "draft_id": str(draft.id),
                    "score": 0,
                    "grade": "D",
                    "pass": False,
                    "consistency_score": 0,
                    "motion_score": 0,
                    "visual_score": 0,
                    "text_clean_score": 0,
                    "reasons": [f"质检模型失败: {exc}"],
                    "suggestions": [],
                }
            )

    return ok({"items": items, "threshold": body.threshold, "model_config_id": model_config.id})
