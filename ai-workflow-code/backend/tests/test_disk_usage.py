from pathlib import Path

from app.services.disk_usage import get_disk_usage_for_path


def test_get_disk_usage_for_path_returns_bytes(tmp_path: Path) -> None:
    payload = get_disk_usage_for_path(str(tmp_path))
    assert payload["path"] == str(tmp_path.resolve())
    assert payload["total_bytes"] > 0
    assert payload["free_bytes"] >= 0
    assert payload["used_bytes"] >= 0
    assert 0 <= payload["used_percent"] <= 100
