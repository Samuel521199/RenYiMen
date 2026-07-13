import io
import os
import uuid
import zipfile
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.asset import Asset
from app.models.image import FinalImage
from app.utils.response import ok

router = APIRouter(prefix="/api/logo", tags=["logo"])

STORAGE_DIR = os.environ.get("STORAGE_LOCAL_PATH", os.environ.get("STORAGE_DIR", "/app/storage"))
LOGO_DIR = os.path.join(STORAGE_DIR, "logo")
os.makedirs(LOGO_DIR, exist_ok=True)


class LogoPosition(BaseModel):
    x: float  # 0.0-1.0 相对位置
    y: float  # 0.0-1.0 相对位置
    width: float  # 0.0-1.0 相对宽度
    height: float  # 0.0-1.0 相对高度


class LogoApplyRequest(BaseModel):
    image_urls: list[str]  # 成品图 URL 列表
    logo_asset_id: int  # 素材库 logo ID
    position: LogoPosition


class LogoApplyResult(BaseModel):
    original_url: str
    result_url: str
    filename: str


@router.post("/apply", response_model=dict)
async def apply_logo(
    body: LogoApplyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Pillow 合成：给多张图片叠加 Logo"""
    import httpx
    from PIL import Image

    asset_result = await db.execute(select(Asset).where(Asset.id == body.logo_asset_id))
    asset = asset_result.scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Logo asset not found")

    logo_url = asset.url
    if not logo_url:
        raise HTTPException(status_code=400, detail="Logo asset has no image URL")

    async def load_image_from_url(url: str) -> Image.Image:
        if url.startswith("/static/") or url.startswith("/storage/"):
            local_path = url.replace("/static/", f"{STORAGE_DIR}/", 1) if url.startswith("/static/") else url.replace("/storage/", f"{STORAGE_DIR}/", 1)
            return Image.open(local_path).convert("RGBA")

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            return Image.open(io.BytesIO(resp.content)).convert("RGBA")

    logo_img = await load_image_from_url(logo_url)

    results = []
    for img_url in body.image_urls:
        try:
            base_img = await load_image_from_url(img_url)
            base_w, base_h = base_img.size

            logo_w = int(base_w * body.position.width)
            logo_h = int(base_h * body.position.height)
            logo_x = int(base_w * body.position.x)
            logo_y = int(base_h * body.position.y)

            logo_resized = logo_img.resize((logo_w, logo_h), Image.LANCZOS)

            composite = base_img.convert("RGBA")
            composite.paste(logo_resized, (logo_x, logo_y), logo_resized)
            result_rgb = composite.convert("RGB")

            filename = f"logo_{uuid.uuid4().hex[:8]}.jpg"
            out_path = os.path.join(LOGO_DIR, filename)
            result_rgb.save(out_path, "JPEG", quality=95)

            result_url = f"/static/logo/{filename}"
            results.append(
                {
                    "original_url": img_url,
                    "result_url": result_url,
                    "filename": filename,
                }
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to process {img_url}: {str(e)}") from e

    return ok(results)


class LogoArchiveItem(BaseModel):
    result_url: str
    original_url: str


class LogoArchiveRequest(BaseModel):
    items: list[LogoArchiveItem]


@router.post("/archive", response_model=dict)
async def archive_logo_images(
    body: LogoArchiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """归档 Logo 合成结果到成品图库"""
    for item in body.items:
        final_image = FinalImage(
            task_id=None,
            task_image_id=None,
            image_url=item.result_url,
            prompt_used=None,
            tags=None,
            source_type="logo",
            sub_category=None,
            style_tag=None,
            created_by=int(current_user["id"]),
        )
        db.add(final_image)

    await db.commit()
    return ok({"archived": len(body.items)})


@router.get("/download-zip", response_class=StreamingResponse)
async def download_zip(
    urls: str,  # 逗号分隔的 result_url 列表
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """打包下载多张合成图片"""
    url_list = [u.strip() for u in urls.split(",") if u.strip()]
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for url in url_list:
            local_path = url.replace("/static/", f"{STORAGE_DIR}/", 1) if url.startswith("/static/") else url
            filename = os.path.basename(local_path)
            if os.path.exists(local_path):
                zf.write(local_path, filename)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=logo_images.zip"},
    )
