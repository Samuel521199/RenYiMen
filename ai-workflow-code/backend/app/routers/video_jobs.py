import json
import logging
import os
import re
import subprocess
import tempfile
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.video import VideoDraft
from app.dependencies import get_current_user, get_db
from app.models.video import VideoJob
from app.models.workflow_session import WorkflowSession
from app.schemas.video import (
    VideoJobCreate,
    VideoJobResponse,
    VideoJobStatusUpdate,
)
from app.services.storage_service import resolve_static_file_path
from app.services.video_service import advance_step, get_job, set_status
from app.utils.response import err, ok


router = APIRouter(prefix="/api/video/jobs", tags=["video-jobs"])
logger = logging.getLogger(__name__)


def _normalize_asset_url(url: str) -> str:
    value = (url or "").strip()
    if value.startswith("/api/workbench/static/"):
        return value.removeprefix("/api/workbench")
    if value.startswith("/api/workbench"):
        return value.removeprefix("/api/workbench")
    return value


def _load_url_content(url: str) -> bytes:
    normalized = _normalize_asset_url(url)
    static_path = resolve_static_file_path(normalized)
    if static_path is not None:
        return static_path.read_bytes()
    raise HTTPException(status_code=404, detail=f"Asset not found: {url}")


async def _download_url_content(client: httpx.AsyncClient, url: str) -> bytes:
    normalized = _normalize_asset_url(url)
    static_path = resolve_static_file_path(normalized)
    if static_path is not None:
        return static_path.read_bytes()

    if normalized.startswith("http"):
        target = normalized
    else:
        target = f"http://host.docker.internal:8000{normalized}"

    response = await client.get(target)
    response.raise_for_status()
    return response.content


def _split_subtitle_lines(text: str, max_chars: int = 14) -> list[str]:
    normalized = (
        str(text or "")
        .replace("\r", "")
        .replace("，", "，\n")
        .replace("。", "。\n")
        .replace("！", "！\n")
        .replace("？", "？\n")
        .replace(",", ",\n")
        .replace(".", ".\n")
        .replace("!", "!\n")
        .replace("?", "?\n")
    )
    pieces = [line.strip() for line in normalized.split("\n") if line.strip()]
    lines: list[str] = []
    for piece in pieces:
        if len(piece) <= max_chars:
            lines.append(piece)
            continue
        for idx in range(0, len(piece), max_chars):
            lines.append(piece[idx : idx + max_chars])
    return lines[:10]


def _subtitle_style(template: str) -> dict[str, Any]:
    if template == "minimal_clean":
        return {
            "font_size_factor": 20,
            "boxcolor": "black@0.35",
            "boxborderw": 6,
            "fontcolor": "white",
        }
    if template == "news_banner":
        return {
            "font_size_factor": 22,
            "boxcolor": "0x2563eb@0.78",
            "boxborderw": 8,
            "fontcolor": "white",
        }
    return {
        "font_size_factor": 18,
        "boxcolor": "black@0.6",
        "boxborderw": 8,
        "fontcolor": "white",
    }


def _parse_ratio(ratio: str) -> tuple[int, int]:
    value = str(ratio or "").strip()
    if value == "9:16":
        return 9, 16
    if value == "16:9":
        return 16, 9
    if value == "1:1":
        return 1, 1
    if ":" not in value:
        raise HTTPException(status_code=400, detail=f"Unsupported ratio: {ratio}")
    left, right = value.split(":", maxsplit=1)
    try:
        a = int(left)
        b = int(right)
        if a <= 0 or b <= 0:
            raise ValueError
        return a, b
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid ratio: {ratio}") from exc


def _compute_smart_crop_filter(
    src_width: int,
    src_height: int,
    ratio: str,
    focus_mode: str = "auto",
) -> tuple[str, int, int]:
    rw, rh = _parse_ratio(ratio)
    target_ratio = rw / rh
    source_ratio = src_width / src_height

    if source_ratio > target_ratio:
        crop_height = src_height
        crop_width = int(round(src_height * target_ratio))
        x = (src_width - crop_width) // 2
        y = 0
    else:
        crop_width = src_width
        crop_height = int(round(src_width / target_ratio))
        x = 0
        if focus_mode == "top":
            y = 0
        elif focus_mode == "bottom":
            y = max(0, src_height - crop_height)
        elif focus_mode == "center":
            y = (src_height - crop_height) // 2
        else:
            # auto 模式：在需要裁高时，给上方主体区域留更多空间（人像/角色更常在上中部）
            y = int((src_height - crop_height) * 0.22)
            y = max(0, min(y, src_height - crop_height))

    if ratio == "9:16":
        out_w, out_h = 1080, 1920
    elif ratio == "16:9":
        out_w, out_h = 1920, 1080
    elif ratio == "1:1":
        out_w, out_h = 1080, 1080
    else:
        # 保持与原视频接近，避免异常比例造成超大输出
        if rw >= rh:
            out_w = min(1920, src_width)
            out_h = int(round(out_w * rh / rw))
        else:
            out_h = min(1920, src_height)
            out_w = int(round(out_h * rw / rh))

    filter_expr = f"crop={crop_width}:{crop_height}:{x}:{y},scale={out_w}:{out_h}"
    return filter_expr, out_w, out_h


class ComposeAllRequest(BaseModel):
    draft_id: UUID
    logo: dict[str, Any] | None = None
    subtitle: dict[str, Any] | None = None
    cta: dict[str, Any] | None = None
    fx: dict[str, Any] | None = None


class SmartCropExportRequest(BaseModel):
    draft_id: UUID
    ratios: list[str]
    focus_mode: str = "auto"


def _merge_video_job_id_into_session_state(state_json: str | None, job_id: UUID) -> str:
    try:
        state = json.loads(state_json or "{}")
        if not isinstance(state, dict):
            state = {}
    except json.JSONDecodeError:
        state = {}
    state["videoJobId"] = str(job_id)
    return json.dumps(state)


@router.post("/create", response_model=dict)
async def create_video_job(
    body: VideoJobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """创建视频任务 · Create a new video job"""
    if body.session_id is not None:
        existing_session = await db.get(WorkflowSession, body.session_id)
        if existing_session is not None:
            job = VideoJob(
                task_id=body.task_id or existing_session.task_id,
                session_id=body.session_id,
                created_by=int(current_user["id"]),
                video_language=body.video_language or "english",
                notes=body.notes,
                status="draft",
                current_step=existing_session.current_step or 1,
                first_frame_status="empty",
            )
            db.add(job)
            await db.commit()
            await db.refresh(job)
            existing_session.state_json = _merge_video_job_id_into_session_state(
                existing_session.state_json,
                job.id,
            )
            await db.commit()
            return ok(VideoJobResponse.model_validate(job).model_dump(mode="json"))

    job = VideoJob(
        task_id=body.task_id,
        session_id=body.session_id,
        created_by=int(current_user["id"]),
        video_language=body.video_language or "english",
        notes=body.notes,
        status="draft",
        current_step=1,
        first_frame_status="empty",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    session = WorkflowSession(
        workflow_type="video",
        mode="video",
        created_by=int(current_user["id"]),
        status="draft",
        current_step=1,
        state_json=json.dumps(
            {
                "videoJobId": str(job.id),
                "currentStep": 1,
                "firstFrameStatus": "empty",
                "drafts": [],
                "finalVideos": [],
                "videoLanguage": job.video_language or "english",
            }
        ),
        task_id=job.task_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    job.session_id = session.id
    await db.commit()
    await db.refresh(job)
    return ok(VideoJobResponse.model_validate(job).model_dump(mode="json"))


@router.get("/list", response_model=dict)
async def list_video_jobs(
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """视频任务列表 · List video jobs with optional status filter"""
    q = select(VideoJob).where(VideoJob.created_by == int(current_user["id"]))
    if status:
        q = q.where(VideoJob.status == status)
    else:
        q = q.where(VideoJob.status != "archived")
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (
        (
            await db.execute(
                q.order_by(VideoJob.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return ok(
        {
            "items": [VideoJobResponse.model_validate(job).model_dump(mode="json") for job in items],
            "total": total,
        }
    )


@router.get("/{job_id}", response_model=dict)
async def get_video_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """获取单个视频任务 · Get video job by id"""
    job = await db.run_sync(lambda sync_db: get_job(job_id, sync_db))
    if not job:
        raise HTTPException(status_code=404, detail="Video job not found")
    return ok(VideoJobResponse.model_validate(job).model_dump(mode="json"))


@router.patch("/{job_id}/status", response_model=dict)
async def update_video_job_status(
    job_id: UUID,
    body: VideoJobStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """更新任务状态/步骤 · Update status or current_step"""
    job = await db.run_sync(lambda sync_db: get_job(job_id, sync_db))
    if not job:
        raise HTTPException(status_code=404, detail="Video job not found")
    if body.current_step is not None:
        advance_step(job, body.current_step)
    elif body.status is not None:
        set_status(job, body.status)
    if body.notes is not None:
        job.notes = body.notes
    if body.aspect_ratio:
        job.aspect_ratio = body.aspect_ratio
    if body.export_url is not None:
        job.export_url = body.export_url
    await db.commit()
    await db.refresh(job)
    return ok(VideoJobResponse.model_validate(job).model_dump(mode="json"))


@router.get("/{job_id}/download")
async def download_final_video(
    job_id: UUID,
    draft_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """代理下载视频文件，解决跨域下载问题"""
    result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.id == draft_id,
            VideoDraft.video_job_id == job_id,
        )
    )
    draft = result.scalar_one_or_none()
    if not draft or not draft.video_url:
        raise HTTPException(status_code=404, detail="Video not found")

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            content = await _download_url_content(client, draft.video_url)
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("download_final_video failed for %s: %s", draft.video_url, exc)
            raise HTTPException(status_code=502, detail="Failed to fetch video") from exc

    content_type = "video/mp4"
    if draft.video_url.lower().endswith(".webm"):
        content_type = "video/webm"
    elif draft.video_url.lower().endswith(".mov"):
        content_type = "video/quicktime"

    filename = f"final_video_{str(draft_id)[:8]}.mp4"
    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(content)),
            "Cache-Control": "no-cache",
        },
    )


@router.post("/{job_id}/compose", response_model=dict)
async def compose_video_with_logo(
    job_id: UUID,
    draft_id: UUID,
    logo_url: str,
    logo_x: float = 5.0,
    logo_y: float = 75.0,
    logo_size: float = 20.0,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """用 FFmpeg 把 Logo 叠加到视频上"""
    result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.id == draft_id,
            VideoDraft.video_job_id == job_id,
        )
    )
    draft = result.scalar_one_or_none()
    if not draft or not draft.video_url:
        raise HTTPException(status_code=404, detail="Video not found")

    def _to_absolute_url(url: str) -> str:
        if url.startswith("http"):
            return url
        return f"http://host.docker.internal:8000{url}"

    video_url = _to_absolute_url(draft.video_url)
    logo_url_abs = _to_absolute_url(logo_url)
    overlay = f"W*{logo_x/100:.3f}:H*{logo_y/100:.3f}"
    scale = f"iw*{logo_size/100:.3f}"

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "input.mp4")
        logo_path = os.path.join(tmpdir, "logo.png")
        output_path = os.path.join(tmpdir, "output.mp4")

        async with httpx.AsyncClient(timeout=60.0) as client:
            video_resp = await client.get(video_url)
            video_resp.raise_for_status()
            with open(video_path, "wb") as handle:
                handle.write(video_resp.content)

            logo_resp = await client.get(logo_url_abs)
            logo_resp.raise_for_status()
            with open(logo_path, "wb") as handle:
                handle.write(logo_resp.content)

        logo_rgba_path = os.path.join(tmpdir, "logo_rgba.png")
        convert_cmd = [
            "ffmpeg",
            "-y",
            "-i",
            logo_path,
            "-vf",
            "format=rgba",
            logo_rgba_path,
        ]
        convert_proc = subprocess.run(convert_cmd, capture_output=True, timeout=30)
        logger.info("FFmpeg logo convert returncode: %d", convert_proc.returncode)
        if convert_proc.stderr:
            logger.info(
                "FFmpeg logo convert stderr: %s",
                convert_proc.stderr.decode()[-1000:],
            )
        if convert_proc.returncode == 0:
            logo_path = logo_rgba_path

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            video_path,
            "-i",
            logo_path,
            "-filter_complex",
            f"[1:v]scale={scale}:-1[logo];[0:v][logo]overlay={overlay}:format=auto",
            "-c:a",
            "copy",
            output_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=120)
        logger.info("FFmpeg returncode: %d", proc.returncode)
        if proc.stderr:
            logger.info("FFmpeg stderr: %s", proc.stderr.decode()[-1000:])
        if proc.returncode != 0:
            stderr = proc.stderr.decode()[-500:] if proc.stderr else ""
            raise HTTPException(status_code=500, detail=f"FFmpeg failed: {stderr}")

        new_draft_id = uuid4()
        relative_path = f"video/{job_id}/composed_{str(new_draft_id)[:8]}.mp4"
        absolute_path = os.path.join(settings.storage_local_path, relative_path)
        os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
        with open(output_path, "rb") as src, open(absolute_path, "wb") as dest:
            dest.write(src.read())

    result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.video_job_id == draft.video_job_id,
            VideoDraft.draft_type == draft.draft_type,
        )
    )
    for item in result.scalars().all():
        item.selected = False
        if item.status == "selected":
            item.status = "done"

    new_draft = VideoDraft(
        id=new_draft_id,
        video_job_id=draft.video_job_id,
        model=draft.model,
        draft_type=draft.draft_type,
        status="selected",
        selected=True,
        video_url=f"/static/{relative_path}",
        thumbnail_url=draft.thumbnail_url,
        duration_seconds=draft.duration_seconds,
        generation_cost=0,
        parent_draft_id=draft.id,
        operation="logo",
        operation_params={
            "logo_url": logo_url,
            "logo_x": logo_x,
            "logo_y": logo_y,
            "logo_size": logo_size,
        },
    )
    draft.selected = False
    if draft.status == "selected":
        draft.status = "done"
    db.add(new_draft)
    await db.commit()
    await db.refresh(new_draft)
    return ok({"composed_url": new_draft.video_url, "new_draft_id": str(new_draft.id)})


@router.post("/{job_id}/compose-all", response_model=dict)
async def compose_all_effects(
    job_id: UUID,
    body: ComposeAllRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """一次性合成所有后处理效果"""
    result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.id == body.draft_id,
            VideoDraft.video_job_id == job_id,
        )
    )
    draft = result.scalar_one_or_none()
    if not draft or not draft.video_url:
        raise HTTPException(status_code=404, detail="Video not found")

    def _to_abs(url: str) -> str:
        normalized = _normalize_asset_url(url)
        if normalized.startswith("http"):
            return normalized
        return f"http://host.docker.internal:8000{normalized}"

    def _escape_drawtext(text: str) -> str:
        return (
            text.replace("\\", "\\\\")
            .replace(":", r"\:")
            .replace("'", r"\'")
            .replace("%", r"\%")
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, "input.mp4")
        output_path = os.path.join(tmpdir, "output.mp4")
        video_width = 1080
        video_height = 1920

        async with httpx.AsyncClient(timeout=60.0) as client:
            video_bytes = await _download_url_content(client, draft.video_url)
            with open(video_path, "wb") as handle:
                handle.write(video_bytes)

        if os.path.getsize(video_path) < 1024:
            raise HTTPException(
                status_code=422,
                detail=f"Video file is empty or corrupted. URL: {draft.video_url}",
            )

        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0:s=x",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if probe.returncode == 0 and "x" in probe.stdout:
            try:
                width_str, height_str = probe.stdout.strip().split("x", maxsplit=1)
                video_width = int(width_str)
                video_height = int(height_str)
            except ValueError:
                pass

        inputs = ["-i", video_path]
        filter_parts: list[str] = []
        current_label = "[0:v]"
        next_video_index = 1
        fx = body.fx or {}
        fx_camera = str(fx.get("camera") or "")
        fx_text = str(fx.get("text") or "")
        fx_cta_effect = str(fx.get("cta") or "")
        fx_global = str(fx.get("global") or "")

        if fx_camera == "cam_slow_push":
            out_label = f"[v{next_video_index}]"
            filter_parts.append(
                f"{current_label}scale=w='iw*(1+0.008*if(gt(t\\,10)\\,10\\,t))':h='ih*(1+0.008*if(gt(t\\,10)\\,10\\,t))':eval=frame,"
                f"crop={video_width}:{video_height}:'(iw-{video_width})/2':'(ih-{video_height})/2',"
                f"scale={video_width}:{video_height}{out_label}"
            )
            current_label = out_label
            next_video_index += 1
        elif fx_camera == "cam_micro_shake":
            out_label = f"[v{next_video_index}]"
            filter_parts.append(
                f"{current_label}crop=w=iw-30:h=ih-30:x='15+sin(t*30)*8':y='15+cos(t*30)*5',"
                f"scale={video_width}:{video_height}{out_label}"
            )
            current_label = out_label
            next_video_index += 1
        elif fx_camera == "cam_zoom_in":
            out_label = f"[v{next_video_index}]"
            filter_parts.append(
                f"{current_label}scale=w='iw*(1+0.015*if(gt(t\\,8)\\,8\\,t))':h='ih*(1+0.015*if(gt(t\\,8)\\,8\\,t))':eval=frame,"
                f"crop={video_width}:{video_height}:'(iw-{video_width})/2':'(ih-{video_height})/2',"
                f"scale={video_width}:{video_height}{out_label}"
            )
            current_label = out_label
            next_video_index += 1
        elif fx_camera == "cam_zoom_out":
            out_label = f"[v{next_video_index}]"
            filter_parts.append(
                f"{current_label}scale=w='iw*(1.15-0.015*if(gt(t\\,8)\\,8\\,t))':h='ih*(1.15-0.015*if(gt(t\\,8)\\,8\\,t))':eval=frame,"
                f"crop={video_width}:{video_height}:'(iw-{video_width})/2':'(ih-{video_height})/2',"
                f"scale={video_width}:{video_height}{out_label}"
            )
            current_label = out_label
            next_video_index += 1

        if fx_global == "global_flash":
            out_label = f"[v{next_video_index}]"
            filter_parts.append(
                f"{current_label}eq=brightness='0.15*sin(6.2832*t/2.5)':saturation=1{out_label}"
            )
            current_label = out_label
            next_video_index += 1
        elif fx_global == "global_brightness":
            out_label = f"[v{next_video_index}]"
            filter_parts.append(
                f"{current_label}eq=brightness='0.12*sin(6.2832*t/2)':saturation=1{out_label}"
            )
            current_label = out_label
            next_video_index += 1

        if body.logo and body.logo.get("url"):
            logo_path = os.path.join(tmpdir, "logo.png")
            try:
                logo_bytes = _load_url_content(str(body.logo["url"]))
            except HTTPException:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    logo_bytes = await _download_url_content(client, str(body.logo["url"]))
            with open(logo_path, "wb") as handle:
                handle.write(logo_bytes)

            logo_rgba_path = os.path.join(tmpdir, "logo_rgba.png")
            subprocess.run(
                ["ffmpeg", "-y", "-i", logo_path, "-vf", "format=rgba", logo_rgba_path],
                capture_output=True,
                timeout=30,
            )
            if os.path.exists(logo_rgba_path):
                logo_path = logo_rgba_path

            logo_input_index = len(inputs) // 2
            inputs += ["-i", logo_path]
            x = float(body.logo.get("x", 5))
            y = float(body.logo.get("y", 75))
            size = float(body.logo.get("size", 20))
            scale = f"iw*{size/100:.3f}"
            overlay_x = f"W*{x/100:.3f}"
            overlay_y = f"H*{y/100:.3f}"
            filter_parts.append(f"[{logo_input_index}:v]scale={scale}:-1[logo]")
            filter_parts.append(
                f"{current_label}[logo]overlay={overlay_x}:{overlay_y}:format=auto[v{next_video_index}]"
            )
            current_label = f"[v{next_video_index}]"
            next_video_index += 1

        if body.subtitle and body.subtitle.get("text"):
            subtitle_text = str(body.subtitle["text"])
            position = body.subtitle.get("position", "bottom")
            template = str(body.subtitle.get("style_template") or "social_pop")
            max_chars = int(body.subtitle.get("max_chars_per_line") or 14)
            style = _subtitle_style(template)
            font_size = int(
                body.subtitle.get("font_size")
                or max(18, int(video_height / max(10, int(style["font_size_factor"]))))
            )
            if position == "top":
                y_pos = "h*0.08"
            elif position == "center":
                y_pos = "(h-text_h)/2"
            else:
                y_pos = "h*0.85"

            lines_payload = body.subtitle.get("lines")
            segments_payload = body.subtitle.get("segments")
            subtitle_entries: list[dict[str, Any]] = []
            if isinstance(segments_payload, list):
                for item in segments_payload:
                    if not isinstance(item, dict):
                        continue
                    text = str(item.get("text") or "").strip()
                    if not text:
                        continue
                    try:
                        start = float(item.get("start", 0))
                        end = float(item.get("end", start + 1.0))
                    except (TypeError, ValueError):
                        start = 0.0
                        end = 1.0
                    subtitle_entries.append({"text": text, "start": max(0.0, start), "end": max(start, end)})
            else:
                if isinstance(lines_payload, list):
                    lines = [str(line).strip() for line in lines_payload if str(line).strip()]
                else:
                    lines = _split_subtitle_lines(subtitle_text, max_chars=max_chars)
                if not lines:
                    lines = _split_subtitle_lines(subtitle_text, max_chars=max_chars)
                subtitle_entries = [{"text": line} for line in lines]

            if not subtitle_entries:
                subtitle_entries = [{"text": subtitle_text}]

            drawtext_filters: list[str] = []
            for item in subtitle_entries:
                text = _escape_drawtext(str(item.get("text") or ""))
                base = (
                    f"drawtext=text='{text}':fontsize={font_size}:fontcolor={style['fontcolor']}:"
                    f"box=1:boxcolor={style['boxcolor']}:boxborderw={style['boxborderw']}:x=(w-text_w)/2:y={y_pos}"
                )
                if fx_text == "txt_pop":
                    base += ":alpha='min(1\\,t/0.4)'"
                elif fx_text == "txt_fade":
                    base += ":alpha=min(1\\,t/0.5)"
                if "start" in item and "end" in item:
                    base += f":enable='between(t\\,{float(item['start']):.2f}\\,{float(item['end']):.2f})'"
                drawtext_filters.append(base)

            subtitle_filter = ",".join(drawtext_filters)

            out_label = f"[v{next_video_index}]"
            filter_parts.append(f"{current_label}{subtitle_filter}{out_label}")
            current_label = out_label
            next_video_index += 1

        if body.cta and body.cta.get("text"):
            from PIL import Image, ImageDraw, ImageFont

            cta_text = str(body.cta["text"])
            position = body.cta.get("position", "bottom")

            font_size = max(36, video_height // 22)
            pad_x, pad_y = 60, 28
            radius = 20

            tmp_img = Image.new("RGBA", (1, 1))
            tmp_draw = ImageDraw.Draw(tmp_img)
            try:
                font = ImageFont.truetype(
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    font_size,
                )
            except Exception:
                font = ImageFont.load_default()
            bbox = tmp_draw.textbbox((0, 0), cta_text, font=font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]

            btn_w = text_w + pad_x * 2
            btn_h = text_h + pad_y * 2

            img = Image.new("RGBA", (btn_w, btn_h), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            draw.rounded_rectangle(
                [0, 0, btn_w - 1, btn_h - 1],
                radius=radius,
                fill=(37, 99, 235, 242),
            )
            draw.text((pad_x - bbox[0], pad_y - bbox[1]), cta_text, font=font, fill=(255, 255, 255, 255))

            cta_img_path = os.path.join(tmpdir, "cta_btn.png")
            img.save(cta_img_path)
            cta_dim_img_path = os.path.join(tmpdir, "cta_btn_dim.png")

            overlay_y = "H*0.04" if position == "top" else f"H*0.88-{btn_h // 2}"
            overlay_x = f"(W-{btn_w})/2"

            if fx_cta_effect == "cta_pulse":
                dim_img = img.copy()
                dim_alpha = dim_img.getchannel("A").point(lambda value: int(value * 0.7))
                dim_img.putalpha(dim_alpha)
                dim_img.save(cta_dim_img_path)

                cta_dim_input_index = len(inputs) // 2
                inputs += ["-i", cta_dim_img_path]
                dim_label = f"[v{next_video_index}]"
                filter_parts.append(
                    f"{current_label}[{cta_dim_input_index}:v]overlay={overlay_x}:{overlay_y}{dim_label}"
                )
                current_label = dim_label
                next_video_index += 1

                cta_input_index = len(inputs) // 2
                inputs += ["-i", cta_img_path]
                out_label = f"[v{next_video_index}]"
                filter_parts.append(
                    f"{current_label}[{cta_input_index}:v]overlay={overlay_x}:{overlay_y}:enable='lt(mod(t\\,1.5)\\,0.75)'{out_label}"
                )
            else:
                cta_input_index = len(inputs) // 2
                inputs += ["-i", cta_img_path]
                out_label = f"[v{next_video_index}]"
                filter_parts.append(
                    f"{current_label}[{cta_input_index}:v]overlay={overlay_x}:{overlay_y}{out_label}"
                )
            current_label = out_label
            next_video_index += 1

        if filter_parts:
            filter_parts[-1] = re.sub(r"\[v[^\]]*\]$", "[vout]", filter_parts[-1])
            filter_complex = ";".join(filter_parts)
            cmd = [
                "ffmpeg",
                "-y",
                *inputs,
                "-filter_complex",
                filter_complex,
                "-map",
                "[vout]",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-shortest",
                output_path,
            ]
        else:
            cmd = ["ffmpeg", "-y", "-i", video_path, "-c", "copy", output_path]

        logger.info("FFmpeg compose-all cmd: %s", " ".join(cmd))
        logger.info("FFmpeg filter_complex: %s", ";".join(filter_parts))
        proc = subprocess.run(cmd, capture_output=True, timeout=120)
        if proc.returncode != 0:
            stderr = proc.stderr.decode()[-2000:] if proc.stderr else ""
            logger.error("FFmpeg compose-all failed: %s", stderr)
            raise HTTPException(status_code=500, detail=f"FFmpeg failed: {stderr}")

        new_draft_id = uuid4()
        relative_path = f"video/{job_id}/composed_all_{str(new_draft_id)[:8]}.mp4"
        absolute_path = os.path.join(settings.storage_local_path, relative_path)
        os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
        with open(output_path, "rb") as src, open(absolute_path, "wb") as dest:
            dest.write(src.read())

    result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.video_job_id == draft.video_job_id,
            VideoDraft.draft_type == draft.draft_type,
        )
    )
    for item in result.scalars().all():
        item.selected = False
        if item.status == "selected":
            item.status = "done"

    new_draft = VideoDraft(
        id=new_draft_id,
        video_job_id=draft.video_job_id,
        model=draft.model,
        draft_type=draft.draft_type,
        status="done",
        selected=True,
        video_url=f"/static/{relative_path}",
        thumbnail_url=draft.thumbnail_url,
        duration_seconds=draft.duration_seconds,
        generation_cost=0,
        parent_draft_id=draft.id,
        operation="compose_all",
        operation_params=body.model_dump(mode="json"),
    )
    draft.selected = False
    if draft.status == "selected":
        draft.status = "done"
    db.add(new_draft)
    await db.commit()
    await db.refresh(new_draft)
    return ok({"composed_url": new_draft.video_url, "new_draft_id": str(new_draft.id)})


@router.post("/{job_id}/smart-crop-export", response_model=dict)
async def smart_crop_export(
    job_id: UUID,
    body: SmartCropExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """单视频智能裁切导出多比例版本，避免重复调用上游生成"""
    result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.id == body.draft_id,
            VideoDraft.video_job_id == job_id,
        )
    )
    draft = result.scalar_one_or_none()
    if not draft or not draft.video_url:
        raise HTTPException(status_code=404, detail="Video draft not found")

    ratios = [str(item).strip() for item in (body.ratios or []) if str(item).strip()]
    if not ratios:
        raise HTTPException(status_code=400, detail="ratios is required")
    ratios = list(dict.fromkeys(ratios))[:4]

    output_items: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        src_path = os.path.join(tmpdir, "source.mp4")
        async with httpx.AsyncClient(timeout=120.0) as client:
            source_bytes = await _download_url_content(client, str(draft.video_url))
        with open(src_path, "wb") as handle:
            handle.write(source_bytes)

        if os.path.getsize(src_path) < 1024:
            raise HTTPException(status_code=422, detail="Source video is empty or corrupted")

        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0:s=x",
                src_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if probe.returncode != 0 or "x" not in probe.stdout:
            raise HTTPException(status_code=500, detail="Failed to probe source video dimensions")
        try:
            src_width, src_height = [int(item) for item in probe.stdout.strip().split("x", maxsplit=1)]
        except ValueError as exc:
            raise HTTPException(status_code=500, detail="Invalid source video dimensions") from exc

        for ratio in ratios:
            try:
                filter_expr, out_w, out_h = _compute_smart_crop_filter(
                    src_width,
                    src_height,
                    ratio,
                    focus_mode=body.focus_mode,
                )
                ratio_tag = ratio.replace(":", "x")
                out_path = os.path.join(tmpdir, f"smart_{ratio_tag}.mp4")
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    src_path,
                    "-vf",
                    filter_expr,
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a?",
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    "-preset",
                    "veryfast",
                    out_path,
                ]
                proc = subprocess.run(cmd, capture_output=True, timeout=180)
                if proc.returncode != 0:
                    stderr = proc.stderr.decode()[-1000:] if proc.stderr else ""
                    output_items.append(
                        {
                            "ratio": ratio,
                            "status": "failed",
                            "error": stderr or "ffmpeg failed",
                        }
                    )
                    continue

                new_draft_id = uuid4()
                relative_path = f"video/{job_id}/smartcrop_{ratio_tag}_{str(new_draft_id)[:8]}.mp4"
                absolute_path = os.path.join(settings.storage_local_path, relative_path)
                os.makedirs(os.path.dirname(absolute_path), exist_ok=True)
                with open(out_path, "rb") as src, open(absolute_path, "wb") as dst:
                    dst.write(src.read())

                new_draft = VideoDraft(
                    id=new_draft_id,
                    video_job_id=draft.video_job_id,
                    model=draft.model,
                    draft_type=draft.draft_type,
                    status="done",
                    selected=False,
                    video_url=f"/static/{relative_path}",
                    thumbnail_url=draft.thumbnail_url,
                    duration_seconds=draft.duration_seconds,
                    generation_cost=0,
                    parent_draft_id=draft.id,
                    operation="smart_crop",
                    operation_params={
                        "ratio": ratio,
                        "focus_mode": body.focus_mode,
                        "output_width": out_w,
                        "output_height": out_h,
                    },
                )
                db.add(new_draft)
                output_items.append(
                    {
                        "ratio": ratio,
                        "status": "done",
                        "video_url": new_draft.video_url,
                        "draft_id": str(new_draft_id),
                        "output_width": out_w,
                        "output_height": out_h,
                    }
                )
            except HTTPException:
                raise
            except Exception as exc:
                output_items.append(
                    {
                        "ratio": ratio,
                        "status": "failed",
                        "error": str(exc),
                    }
                )

    await db.commit()
    return ok({"items": output_items, "source_draft_id": str(draft.id)})


@router.delete("/{job_id}", response_model=dict)
async def delete_video_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """软删除视频任务 · Soft delete by setting status to archived"""
    job = await db.run_sync(lambda sync_db: get_job(job_id, sync_db))
    if not job:
        raise HTTPException(status_code=404, detail="Video job not found")
    job.status = "archived"
    await db.commit()
    return ok({"deleted": str(job_id)})
