from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings


VALID_IMAGE_TYPES = {"draft", "final"}


def resolve_static_file_path(static_url: str) -> Path | None:
    """Map `/static/...` URL to the on-disk file under STORAGE_LOCAL_PATH."""
    value = (static_url or "").strip()
    if not value:
        return None
    if value.startswith("/api/workbench/static/"):
        value = value.removeprefix("/api/workbench")
    if not value.startswith("/static/"):
        return None

    relative = value.removeprefix("/static/").lstrip("/")
    candidate = Path(settings.storage_local_path) / relative
    return candidate if candidate.is_file() else None


async def save_file(
    db: AsyncSession | None,
    task_id: int,
    file_bytes: bytes,
    filename: str,
    image_type: str,
    storage_root: str | Path | None = None,
) -> str:
    if image_type not in VALID_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="image_type must be 'draft' or 'final'",
        )

    root = Path(storage_root or settings.storage_local_path)
    relative_dir = Path("task") / str(task_id) / image_type
    target_dir = root / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    safe_filename = Path(filename).name
    target_path = target_dir / safe_filename
    target_path.write_bytes(file_bytes)

    return f"/static/{relative_dir.as_posix()}/{safe_filename}"


async def save_asset_file(
    db: AsyncSession | None,
    file_bytes: bytes,
    filename: str,
    storage_root: str | Path | None = None,
) -> str:
    root = Path(storage_root or settings.storage_local_path)
    relative_dir = Path("assets")
    target_dir = root / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    safe_filename = Path(filename).name
    target_path = target_dir / safe_filename
    target_path.write_bytes(file_bytes)

    return f"/static/{relative_dir.as_posix()}/{safe_filename}"
