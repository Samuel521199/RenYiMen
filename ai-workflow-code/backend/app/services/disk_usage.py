from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any


def get_disk_usage_for_path(raw_path: str) -> dict[str, Any]:
    path = Path(raw_path).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    usage = shutil.disk_usage(path)
    total = int(usage.total)
    used = int(usage.used)
    free = int(usage.free)
    used_percent = round((used / total) * 100, 1) if total > 0 else 0.0
    return {
        "path": str(path),
        "total_bytes": total,
        "used_bytes": used,
        "free_bytes": free,
        "used_percent": used_percent,
    }
