import asyncio
import base64
import io
import logging
import os
import re
import sys
import traceback
import uuid
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import _model_imports as _model_imports
from app.models.model_config import ModelConfig
from app.schemas.generate import ImageGenerateRequest, ImageGenerateResponse
from app.services import storage_service
from app.services.cost_service import calculate_cost_usd
from app.services.quota_service import assert_generation_quota, record_generation_quota_usage
from app.services import model_config_utils
from app.services.image_size_utils import normalize_generation_size
from app.services.user_model_api_key_service import apply_user_api_key_override


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
MAX_RETRIES = 3
PROVIDER_REQUEST_TIMEOUT_SECONDS = 600.0
# Keep reference-image requests bounded; each selected image is downloaded and compressed.
MAX_REFERENCE_IMAGES = 4
IMAGE_GENERATION_MODELS = ["gpt-image-2-all", "gpt-image-2", "gpt-image-1", "chatgpt-image", "dall-e"]
IMAGE_CHAT_MODEL = "gpt-image-2-all"
LOCAL_STATIC_BASE_URL = os.getenv("LOCAL_STATIC_BASE_URL", "http://localhost:8000")
DATA_URI_IMAGE_RE = re.compile(r"data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)")
MARKDOWN_DATA_URI_IMAGE_RE = re.compile(r"!\[[^\]]*]\(data:(image/[a-zA-Z0-9.+-]+);base64,([^)]+)\)")
HTTP_URL_RE = re.compile(r"https?://[^\s)\"']+")
RAW_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=\s]+$")


@dataclass(frozen=True)
class DownloadedReferenceImage:
    mime_type: str
    data_base64: str


async def generate_image(
    db: AsyncSession | None,
    request: ImageGenerateRequest,
    reference_image_urls: list[str] | None = None,
    user_id: int | None = None,
) -> ImageGenerateResponse:
    if db is None:
        provider = request.model_provider.lower()
        if provider not in {"openai", "google"}:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail=f"Provider '{request.model_provider}' is not implemented",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Database session is required to load model configuration",
        )

    model_config = await _get_model_config(db, request.model_config_id)
    await apply_user_api_key_override(db, user_id, model_config)
    if normalize_generation_size(request.size) != request.size:
        request = request.model_copy(update={"size": normalize_generation_size(request.size)})
    if model_config_utils.is_video_model_config(
        provider=model_config.provider,
        model_name=model_config.model_name,
        name=model_config.name,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Model '{model_config.model_name}' is a video generation model. "
                "Use the video workflow instead of /api/generate/image."
            ),
        )
    provider = model_config.provider.lower()
    safe_reference_image_urls = (reference_image_urls or [])[:MAX_REFERENCE_IMAGES]
    if user_id is not None:
        await assert_generation_quota(
            db,
            user_id,
            request.model_config_id,
            image_count=max(int(request.count or 1), 1),
        )
    logger.warning(
        "generate_image: provider=%s, model=%s, base_url=%s, ref_images=%s, safe_ref_images=%s",
        model_config.provider,
        model_config.model_name,
        model_config.base_url,
        len(reference_image_urls or []),
        len(safe_reference_image_urls),
    )
    response: ImageGenerateResponse
    if model_config.base_url:
        if _is_image_api_model(model_config.model_name):
            logger.warning(
                "routing to image edit/generation, has_refs=%s",
                bool(safe_reference_image_urls),
            )
            if safe_reference_image_urls:
                response = await _call_image_edit(db, request, model_config, safe_reference_image_urls)
            else:
                response = await _call_image_generation(db, request, model_config)
        else:
            logger.warning("routing to openai_compatible chat")
            response = await _call_openai_compatible(db, request, model_config, safe_reference_image_urls)
    elif provider == "openai":
        logger.warning("routing to native openai")
        response = await _call_openai(db, request, model_config, safe_reference_image_urls)
    elif provider == "google":
        logger.warning("routing to native google")
        response = await _call_google(db, request, model_config, safe_reference_image_urls)
    elif provider in ("kling_video", "veo", "runway"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{provider} models must be called via /api/video/draft/generate",
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Provider '{model_config.provider}' is not implemented",
        )

    if user_id is not None:
        cost_usd = response.cost_usd or calculate_cost_usd(db, response.model_provider, response.token_used)
        await record_generation_quota_usage(
            db,
            user_id,
            request.model_config_id,
            token_used=response.token_used,
            cost_usd=cost_usd,
            image_count=len(response.images),
        )
    return response


async def _call_openai(
    db: AsyncSession,
    request: ImageGenerateRequest,
    model_config: ModelConfig,
    reference_image_urls: list[str],
) -> ImageGenerateResponse:
    base_url = _openai_compatible_base_url(None)
    downloaded_images = await _download_reference_images(reference_image_urls[:1])
    if downloaded_images:
        endpoint = f"{base_url}/images/edits"
        payload = {
            "model": model_config.model_name,
            "prompt": request.prompt,
            "size": request.size,
            "n": request.count,
            "image": _as_data_uri(downloaded_images[0]),
        }
    else:
        endpoint = f"{base_url}/images/generations"
        payload = {
            "model": model_config.model_name,
            "prompt": request.prompt,
            "size": request.size,
            "n": request.count,
        }

    response = await _post_json(
        endpoint,
        headers={"Authorization": f"Bearer {model_config.api_key}"},
        json=payload,
    )
    data = response.get("data", [])
    urls = [
        item.get("url") or item.get("b64_json")
        for item in data
        if item.get("url") or item.get("b64_json")
    ]
    token_used = _extract_token_usage(response, request.prompt)
    cost_usd = await _update_model_usage(db, model_config, "openai", token_used, len(urls))
    return ImageGenerateResponse(
        task_id=request.task_id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        images=[
            {"image_id": index + 1, "url": url, "type": "draft"}
            for index, url in enumerate(urls)
        ],
        token_used=token_used,
        cost_usd=cost_usd,
    )


async def _call_openai_compatible(
    db: AsyncSession,
    request: ImageGenerateRequest,
    model_config: ModelConfig,
    reference_image_urls: list[str],
) -> ImageGenerateResponse:
    base_url = _openai_compatible_base_url(model_config.base_url)
    downloaded_images = await _download_reference_images(reference_image_urls)
    urls: list[str] = []
    token_used = 0
    failed_count = 0
    generation_count = _openai_compatible_generation_count(request)

    for generation_index in range(1, generation_count + 1):
        try:
            generated_urls, generation_tokens = await _single_chat_completion_call(
                db,
                request,
                model_config,
                base_url,
                downloaded_images,
                generation_index,
            )
            urls.extend(generated_urls)
            token_used += generation_tokens
        except Exception as exc:
            failed_count += 1
            logger.warning(
                "Generation %s/%s failed: %s",
                generation_index,
                generation_count,
                exc,
            )

    if failed_count:
        logger.warning(
            "OpenAI-compatible relay generation completed with %s/%s failures",
            failed_count,
            generation_count,
        )

    cost_usd = await _update_model_usage(db, model_config, "openai", token_used, len(urls))
    return ImageGenerateResponse(
        task_id=request.task_id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        images=[
            {"image_id": index + 1, "url": url, "type": "draft"}
            for index, url in enumerate(urls)
        ],
        token_used=token_used,
        cost_usd=cost_usd,
    )


def _openai_compatible_generation_count(request: ImageGenerateRequest) -> int:
    if (request.mode or "").lower() == "draft" and request.count > 1:
        return 1
    return max(int(request.count or 1), 1)


def _is_image_api_model(model_name: str) -> bool:
    normalized = (model_name or "").lower().replace("_", "-").replace(" ", "-")
    return any(marker in normalized for marker in IMAGE_GENERATION_MODELS)


def _is_image_chat_model(model_name: str) -> bool:
    return IMAGE_CHAT_MODEL in (model_name or "").lower().replace("_", "-").replace(" ", "-")


def get_image_field_name(base_url: str | None) -> str:
    if "pucoding" in (base_url or "").lower():
        return "image"
    return "image[]"


async def _call_image_chat(
    db: AsyncSession,
    request: ImageGenerateRequest,
    model_config: ModelConfig,
    reference_image_urls: list[str],
) -> ImageGenerateResponse:
    base_url = _openai_compatible_base_url(model_config.base_url)
    logger.warning(
        "Calling image chat: %s/chat/completions, model=%s, images=%s",
        base_url,
        model_config.model_name,
        len(reference_image_urls),
    )
    downloaded_images = await _download_reference_images(reference_image_urls[:1])
    messages: list[dict[str, Any]]
    if downloaded_images:
        reference_image = downloaded_images[0]
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": _as_data_uri(reference_image),
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "这是我的卡通牛角色参考图，请记住这个角色的所有外观特征："
                            "脸型、眼睛、鼻子、牛角、身体比例、帽子、围巾、外套。"
                            "后续生成必须保持完全一致。"
                        ),
                    },
                ],
            },
            {
                "role": "assistant",
                "content": "好的，我已记住这个卡通牛角色的所有外观特征，后续生成将保持完全一致。",
            },
            {
                "role": "user",
                "content": request.prompt,
            },
        ]
    else:
        messages = [{"role": "user", "content": request.prompt}]

    payload = {
        "model": model_config.model_name,
        "messages": messages,
        "stream": False,
    }
    response = await _post_json(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {model_config.api_key}"},
        json=payload,
    )
    urls = await _extract_openai_compatible_chat_image_urls(db, request, response)
    token_used = _extract_token_usage(response, request.prompt)
    cost_usd = await _update_model_usage(db, model_config, "openai", token_used, len(urls))
    return ImageGenerateResponse(
        task_id=request.task_id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        images=[
            {"image_id": index + 1, "url": url, "type": "draft"}
            for index, url in enumerate(urls)
        ],
        token_used=token_used,
        cost_usd=cost_usd,
    )


async def _call_image_edit(
    db: AsyncSession,
    request: ImageGenerateRequest,
    model_config: ModelConfig,
    reference_image_urls: list[str],
) -> ImageGenerateResponse:
    base_url = _openai_compatible_base_url(model_config.base_url)
    downloaded_images = await _download_reference_images(reference_image_urls)
    if not downloaded_images:
        return await _call_image_generation(db, request, model_config)

    data = {
        "model": model_config.model_name,
        "prompt": request.prompt,
        "size": request.size,
        "quality": "high",
        "output_format": "png",
    }
    files = _image_multipart_files(downloaded_images, get_image_field_name(model_config.base_url))
    if not files:
        return await _call_image_generation(db, request, model_config)
    edit_url = f"{base_url}/images/edits"
    logger.info(
        "Calling image edit: %s, model=%s, images=%s",
        edit_url,
        model_config.model_name,
        len(files),
    )
    logger.warning(
        "Calling image edit: %s, model=%s, images=%s",
        edit_url,
        model_config.model_name,
        len(files),
    )
    response = await _post_multipart(
        edit_url,
        headers={"Authorization": f"Bearer {model_config.api_key}"},
        data=data,
        files=files,
    )
    urls = await _extract_image_api_response_urls(db, request, response)
    token_used = _extract_token_usage(response, request.prompt)
    cost_usd = await _update_model_usage(db, model_config, "openai", token_used, len(urls))
    return ImageGenerateResponse(
        task_id=request.task_id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        images=[
            {"image_id": index + 1, "url": url, "type": "draft"}
            for index, url in enumerate(urls)
        ],
        token_used=token_used,
        cost_usd=cost_usd,
    )


async def _call_image_generation(
    db: AsyncSession,
    request: ImageGenerateRequest,
    model_config: ModelConfig,
) -> ImageGenerateResponse:
    base_url = _openai_compatible_base_url(model_config.base_url)
    response = await _post_json(
        f"{base_url}/images/generations",
        headers={"Authorization": f"Bearer {model_config.api_key}"},
        json={
            "model": model_config.model_name,
            "prompt": request.prompt,
            "n": 1,
            "size": request.size,
            "quality": "high",
        },
    )
    urls = await _extract_image_api_response_urls(db, request, response)
    token_used = _extract_token_usage(response, request.prompt)
    cost_usd = await _update_model_usage(db, model_config, "openai", token_used, len(urls))
    return ImageGenerateResponse(
        task_id=request.task_id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        images=[
            {"image_id": index + 1, "url": url, "type": "draft"}
            for index, url in enumerate(urls)
        ],
        token_used=token_used,
        cost_usd=cost_usd,
    )


async def _single_chat_completion_call(
    db: AsyncSession,
    request: ImageGenerateRequest,
    model_config: ModelConfig,
    base_url: str,
    downloaded_images: list[DownloadedReferenceImage],
    generation_index: int,
) -> tuple[list[str], int]:
    try:
        if downloaded_images:
            content: str | list[dict[str, Any]] = [
                {
                    "type": "image_url",
                    "image_url": {"url": _as_data_uri(image)},
                }
                for image in downloaded_images
            ]
            content.append({"type": "text", "text": f"参考以上图片风格，生成：{request.prompt}"})
        else:
            content = f"请生成一张图片：{request.prompt}"

        payload = {
            "model": model_config.model_name,
            "messages": [{"role": "user", "content": content}],
        }
        payload_size = sys.getsizeof(str(payload))
        logger.warning(
            "Request payload size: %s bytes, images: %s",
            payload_size,
            len(downloaded_images),
        )

        response = await _post_json(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {model_config.api_key}"},
            json=payload,
        )
        urls = await _extract_openai_compatible_chat_image_urls(
            db,
            request,
            response,
            save_index_start=generation_index,
        )
        if not urls:
            logger.warning(
                "OpenAI-compatible chat response did not include parsed images: %s",
                _summarize_openai_compatible_chat_response(response),
            )
        token_used = _extract_token_usage(response, request.prompt)
        return urls, token_used
    except Exception as e:
        logger.error(f"Single call failed: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())
        raise


def _openai_compatible_base_url(base_url: str | None) -> str:
    normalized = (base_url or "https://api.openai.com/v1").rstrip("/")
    if normalized.endswith("/v1"):
        return normalized
    return f"{normalized}/v1"


async def _call_google(
    db: AsyncSession,
    request: ImageGenerateRequest,
    model_config: ModelConfig,
    reference_image_urls: list[str],
) -> ImageGenerateResponse:
    base_url = (model_config.base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    url = (
        f"{base_url}/models/"
        f"{model_config.model_name}:generateContent?key={model_config.api_key}"
    )
    downloaded_images = await _download_reference_images(reference_image_urls)
    parts = [
        {
            "inline_data": {
                "mime_type": image.mime_type,
                "data": image.data_base64,
            }
        }
        for image in downloaded_images
    ]
    parts.append({"text": request.prompt})
    payload = {"contents": [{"parts": parts}]}
    response = await _post_json(url, headers={}, json=payload)
    urls = _extract_google_image_urls(response)
    token_used = _extract_token_usage(response, request.prompt)
    cost_usd = await _update_model_usage(db, model_config, "google", token_used, len(urls))
    return ImageGenerateResponse(
        task_id=request.task_id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        images=[
            {"image_id": index + 1, "url": url, "type": "draft"}
            for index, url in enumerate(urls)
        ],
        token_used=token_used,
        cost_usd=cost_usd,
    )


async def _post_json(url: str, headers: dict[str, str], json: dict[str, Any]) -> dict[str, Any]:
    import httpx

    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(
                http2=False,
                timeout=PROVIDER_REQUEST_TIMEOUT_SECONDS,
            ) as client:
                response = await client.post(
                    url,
                    headers=headers,
                    json=json,
                    timeout=PROVIDER_REQUEST_TIMEOUT_SECONDS,
                )
                if response.status_code >= 400:
                    logger.error(f"Provider {response.status_code}: {response.text[:500]}")
                if response.status_code == 429 and attempt < MAX_RETRIES:
                    await asyncio.sleep(30)
                    continue
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as exc:
            last_error = exc
            if url.endswith("/images/edits"):
                logger.error(f"Image edit request failed: {type(exc).__name__}: {exc}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(5 * attempt)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"AI provider request failed after {MAX_RETRIES} attempts: {last_error}",
    )


async def _post_multipart(
    url: str,
    headers: dict[str, str],
    data: dict[str, str],
    files: list[tuple[str, tuple[str, io.BytesIO, str]]],
) -> dict[str, Any]:
    import httpx

    last_error: Exception | None = None
    safe_headers = {
        key: ("Bearer ***" if key.lower() == "authorization" else value)
        for key, value in headers.items()
    }
    file_keys = [field_name for field_name, _ in files] if files else "none"
    file_details = [
        {
            "field": field_name,
            "filename": file_info[0],
            "mime_type": file_info[2],
            "size_bytes": file_info[1].getbuffer().nbytes,
        }
        for field_name, file_info in files
    ]
    logger.warning("Multipart request to: %s", url)
    logger.warning("Headers: %s", safe_headers)
    logger.warning("Files keys: %s", file_keys)
    logger.warning("Files detail: %s", file_details if file_details else "none")
    logger.warning("Data fields: %s", list(data.keys()) if data else "none")
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(
                http2=False,
                timeout=PROVIDER_REQUEST_TIMEOUT_SECONDS,
            ) as client:
                _rewind_multipart_files(files)
                response = await client.post(
                    url,
                    headers=headers,
                    data=data,
                    files=files,
                    timeout=PROVIDER_REQUEST_TIMEOUT_SECONDS,
                )
                if url.endswith("/images/edits"):
                    logger.info(f"Image edit response: {response.status_code}")
                    if response.status_code >= 400:
                        logger.error(f"Image edit error: {response.text[:500]}")
                if response.status_code >= 400:
                    logger.error(f"Provider {response.status_code}: {response.text[:500]}")
                if response.status_code == 429 and attempt < MAX_RETRIES:
                    await asyncio.sleep(30)
                    continue
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as exc:
            last_error = exc
            if url.endswith("/images/edits"):
                logger.error(f"Image edit request failed: {type(exc).__name__}: {exc}")
            if attempt < MAX_RETRIES:
                await asyncio.sleep(5 * attempt)

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"AI provider multipart request failed after {MAX_RETRIES} attempts: {last_error}",
    )


def _rewind_multipart_files(files: list[tuple[str, tuple[str, io.BytesIO, str]]]) -> None:
    for _, file_info in files:
        file_obj = file_info[1]
        file_obj.seek(0)


def _image_multipart_files(
    downloaded_images: list[DownloadedReferenceImage],
    field_name: str = "image[]",
) -> list[tuple[str, tuple[str, io.BytesIO, str]]]:
    files: list[tuple[str, tuple[str, io.BytesIO, str]]] = []
    for index, image in enumerate(downloaded_images, start=1):
        try:
            image_bytes = base64.b64decode("".join(image.data_base64.split()), validate=True)
        except Exception:
            continue
        if not image_bytes:
            continue
        extension = _extension_for_mime_type(image.mime_type)
        files.append(
            (
                field_name,
                (
                    f"reference-{index}.{extension}",
                    io.BytesIO(image_bytes),
                    image.mime_type,
                ),
            )
        )
    return files


def _as_data_uri(image: DownloadedReferenceImage) -> str:
    return f"data:{image.mime_type};base64,{image.data_base64}"


def _normalize_reference_image_url(url: str) -> str:
    if url.startswith("/static/"):
        return f"{LOCAL_STATIC_BASE_URL.rstrip('/')}{url}"
    return url


def _guess_mime_type(url: str, content_type: str | None) -> str:
    if content_type:
        mime_type = content_type.split(";", 1)[0].strip().lower()
        if mime_type.startswith("image/"):
            return mime_type

    path = urlparse(url).path.lower()
    if path.endswith(".jpg") or path.endswith(".jpeg"):
        return "image/jpeg"
    if path.endswith(".webp"):
        return "image/webp"
    return "image/png"


def compress_image(image_bytes: bytes, max_size_kb: int = 500) -> bytes:
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    img.thumbnail((1024, 1024), Image.LANCZOS)

    output = io.BytesIO()
    quality = 85
    while quality > 20:
        output = io.BytesIO()
        img.save(output, format="JPEG", quality=quality)
        if output.tell() <= max_size_kb * 1024:
            break
        quality -= 15
    return output.getvalue()


def _extension_for_mime_type(mime_type: str) -> str:
    if mime_type == "image/jpeg":
        return "jpg"
    if mime_type == "image/webp":
        return "webp"
    return "png"


def _detect_base64_image_mime_type(data_base64: str) -> str | None:
    compact_data = "".join(data_base64.split())
    if len(compact_data) < 24 or not RAW_BASE64_RE.fullmatch(compact_data):
        return None

    try:
        image_bytes = base64.b64decode(compact_data, validate=True)
    except Exception:
        return None

    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return None


async def _save_base64_image(
    db: AsyncSession | None,
    task_id: int,
    mime_type: str,
    data_base64: str,
    index: int,
) -> str | None:
    try:
        image_bytes = base64.b64decode("".join(data_base64.split()), validate=True)
    except Exception:
        return None
    if not image_bytes:
        return None
    return await storage_service.save_file(
        db,
        task_id=task_id,
        file_bytes=image_bytes,
        filename=f"chat-generated-{task_id}-{uuid.uuid4().hex[:8]}-{index}.{_extension_for_mime_type(mime_type)}",
        image_type="draft",
    )


def _chat_content_fragments(content: Any) -> list[str]:
    if isinstance(content, str):
        return [content]
    fragments: list[str] = []
    if isinstance(content, list):
        for part in content:
            fragments.extend(_chat_content_fragments(part))
        return fragments
    if isinstance(content, dict):
        image_url = content.get("image_url")
        if isinstance(image_url, dict) and image_url.get("url"):
            fragments.append(str(image_url["url"]))
        elif isinstance(image_url, str):
            fragments.append(image_url)

        for data_key in ("inline_data", "inlineData"):
            inline_data = content.get(data_key)
            if isinstance(inline_data, dict) and inline_data.get("data"):
                fragments.append(str(inline_data["data"]))

        for data_key in ("file_data", "fileData"):
            file_data = content.get(data_key)
            if isinstance(file_data, dict):
                file_url = file_data.get("file_uri") or file_data.get("fileUri")
                if file_url:
                    fragments.append(str(file_url))

        for key in ("text", "content", "url", "data", "b64_json"):
            if content.get(key):
                fragments.extend(_chat_content_fragments(content[key]))
    return fragments


def _summarize_openai_compatible_chat_response(response: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"keys": sorted(response.keys())}
    choices = response.get("choices", [])
    summary["choice_count"] = len(choices) if isinstance(choices, list) else 0
    if not isinstance(choices, list) or not choices:
        return summary

    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return summary

    message = first_choice.get("message", {})
    summary["finish_reason"] = first_choice.get("finish_reason")
    if isinstance(message, dict):
        summary["message_keys"] = sorted(message.keys())
        content = message.get("content")
        summary["content_type"] = type(content).__name__
        summary["content_preview"] = str(content)[:1000]
    return summary


def extract_base64_from_markdown(content: str) -> list[tuple[str, str]]:
    return [
        (mime_type, data_base64.strip())
        for mime_type, data_base64 in MARKDOWN_DATA_URI_IMAGE_RE.findall(content or "")
    ]


async def _extract_openai_compatible_chat_image_urls(
    db: AsyncSession | None,
    request: ImageGenerateRequest,
    response: dict[str, Any],
    save_index_start: int = 1,
) -> list[str]:
    urls: list[str] = []
    saved_index = save_index_start - 1
    for choice in response.get("choices", []):
        message = choice.get("message", {})
        fragments: list[str] = []
        for key in ("multi_mod_content", "images", "content"):
            fragments.extend(_chat_content_fragments(message.get(key)))
        for fragment in fragments:
            markdown_data_uri_matches = extract_base64_from_markdown(fragment)
            for mime_type, data_base64 in markdown_data_uri_matches:
                saved_index += 1
                saved_url = await _save_base64_image(
                    db,
                    request.task_id,
                    mime_type,
                    data_base64,
                    saved_index,
                )
                if saved_url:
                    urls.append(saved_url)
            if markdown_data_uri_matches:
                continue

            for url in HTTP_URL_RE.findall(fragment):
                urls.append(url.rstrip(".,，。"))
            data_uri_matches = DATA_URI_IMAGE_RE.findall(fragment)
            for mime_type, data_base64 in data_uri_matches:
                saved_index += 1
                saved_url = await _save_base64_image(
                    db,
                    request.task_id,
                    mime_type,
                    data_base64,
                    saved_index,
                )
                if saved_url:
                    urls.append(saved_url)
            if data_uri_matches or HTTP_URL_RE.search(fragment):
                continue

            mime_type = _detect_base64_image_mime_type(fragment)
            if mime_type:
                saved_index += 1
                saved_url = await _save_base64_image(
                    db,
                    request.task_id,
                    mime_type,
                    fragment,
                    saved_index,
                )
                if saved_url:
                    urls.append(saved_url)

    return urls


async def _extract_image_api_response_urls(
    db: AsyncSession | None,
    request: ImageGenerateRequest,
    response: dict[str, Any],
) -> list[str]:
    urls: list[str] = []
    saved_index = 0
    for item in response.get("data", []):
        if not isinstance(item, dict):
            continue
        image_url = item.get("url")
        if image_url:
            urls.append(str(image_url))
            continue
        data_base64 = item.get("b64_json")
        if data_base64:
            saved_index += 1
            saved_url = await _save_base64_image(
                db,
                request.task_id,
                "image/png",
                str(data_base64),
                saved_index,
            )
            if saved_url:
                urls.append(saved_url)
    return urls


async def _download_reference_images(urls: list[str]) -> list[DownloadedReferenceImage]:
    import httpx

    downloaded: list[DownloadedReferenceImage] = []
    safe_urls = [url for url in urls[:MAX_REFERENCE_IMAGES] if url]
    if not safe_urls:
        return downloaded

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        for raw_url in safe_urls:
            try:
                url = _normalize_reference_image_url(raw_url)
                response = await client.get(url)
                response.raise_for_status()
                if not response.content:
                    continue
                compressed_content = compress_image(response.content)
                downloaded.append(
                    DownloadedReferenceImage(
                        mime_type="image/jpeg",
                        data_base64=base64.b64encode(compressed_content).decode("ascii"),
                    )
                )
            except Exception:
                continue

    return downloaded


async def _get_model_config(db: AsyncSession, model_config_id: int) -> ModelConfig:
    result = await db.execute(select(ModelConfig).where(ModelConfig.id == model_config_id))
    model_config = result.scalar_one_or_none()
    if model_config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model config not found",
        )
    if not model_config.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Model config is disabled",
        )
    return model_config


async def _update_model_usage(
    db: AsyncSession,
    model_config: ModelConfig,
    provider: str,
    token_used: int,
    image_count: int,
) -> Decimal:
    price_per_image = Decimal(model_config.price_per_image or 0)
    if price_per_image > 0:
        cost_usd = (price_per_image * Decimal(image_count)).quantize(
            Decimal("0.0001"),
            rounding=ROUND_HALF_UP,
        )
    else:
        cost_usd = calculate_cost_usd(db, provider, token_used)

    model_config.used_today = Decimal(model_config.used_today or 0) + cost_usd
    await db.commit()
    return cost_usd


def _extract_token_usage(response: dict[str, Any], prompt: str) -> int:
    usage = response.get("usage") or response.get("usageMetadata") or {}
    token_count = (
        usage.get("total_tokens")
        or usage.get("totalTokenCount")
        or usage.get("promptTokenCount")
    )
    if token_count is not None:
        return int(token_count)
    return max(1, len(prompt.split()) * 4)


def _extract_google_image_urls(response: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for candidate in response.get("candidates", []):
        content = candidate.get("content", {})
        for part in content.get("parts", []):
            file_data = part.get("fileData") or part.get("file_data") or {}
            inline_data = part.get("inlineData") or part.get("inline_data") or {}
            if file_data.get("fileUri"):
                urls.append(file_data["fileUri"])
            elif inline_data.get("data"):
                urls.append(inline_data["data"])
    return urls
