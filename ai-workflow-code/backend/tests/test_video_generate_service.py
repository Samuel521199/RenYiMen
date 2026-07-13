import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.storage_service import resolve_static_file_path


class TestResolveStaticFilePath(unittest.TestCase):
    def test_maps_static_assets_path_under_storage_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            asset_path = Path(tmp) / "assets" / "frame.png"
            asset_path.parent.mkdir(parents=True)
            asset_path.write_bytes(b"png-bytes")

            with patch("app.services.storage_service.settings") as settings:
                settings.storage_local_path = tmp
                resolved = resolve_static_file_path("/static/assets/frame.png")

            self.assertEqual(resolved, asset_path)

    def test_supports_workbench_proxy_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            asset_path = Path(tmp) / "assets" / "frame.png"
            asset_path.parent.mkdir(parents=True)
            asset_path.write_bytes(b"png-bytes")

            with patch("app.services.storage_service.settings") as settings:
                settings.storage_local_path = tmp
                resolved = resolve_static_file_path("/api/workbench/static/assets/frame.png")

            self.assertEqual(resolved, asset_path)


if __name__ == "__main__":
    unittest.main()
