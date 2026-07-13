from fastapi import APIRouter

from app.config import settings
from app.services.disk_usage import get_disk_usage_for_path
from app.utils.response import ok

router = APIRouter(tags=["system"])


@router.get("/api/system/disk-usage")
async def disk_usage() -> dict:
    payload = get_disk_usage_for_path(settings.storage_local_path)
    payload["source"] = "workbench-backend"
    return ok(payload)
