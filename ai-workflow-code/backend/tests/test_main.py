import io
import inspect
import os
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.setdefault("STORAGE_DIR", "/tmp/ai-image-workbench-test-storage")

from app import main


class MainAppTests(unittest.TestCase):
    expected_paths = {
        "/api/auth/login",
        "/api/auth/me",
        "/api/users",
        "/api/users/create",
        "/api/users/{user_id}",
        "/api/api-keys/create",
        "/api/api-keys",
        "/api/model-configs/create",
        "/api/model-configs",
        "/api/model-configs/{id}",
        "/api/model-configs/{id}/toggle",
        "/api/permissions/grant",
        "/api/permissions/revoke",
        "/api/permissions/user/{user_id}",
        "/api/model-configs/available",
        "/api/workflow-types",
        "/api/workflow-types/create",
        "/api/instructions",
        "/api/instructions/create",
        "/api/instructions/{id}",
        "/api/instructions/{id}/toggle",
        "/api/tasks/create",
        "/api/tasks",
        "/api/tasks/{task_id}",
        "/api/tasks/{task_id}/status",
        "/api/prompts/create",
        "/api/prompts",
        "/api/prompts/{id}",
        "/api/prompts/build",
        "/api/assets/upload",
        "/api/assets",
        "/api/assets/tags/create-inline",
        "/api/translate/tags",
        "/api/translate/tags/fill-all",
        "/api/assets/{id}",
        "/api/generate/image",
        "/api/generate/logs",
        "/api/review/pending",
        "/api/review/submit",
        "/api/gallery/save-final",
        "/api/gallery/categories",
        "/api/gallery/tags",
        "/api/gallery/tags/manage",
        "/api/gallery/tags/create",
        "/api/gallery/tags/{tag_id}",
        "/api/gallery/finals",
        "/api/gallery/{image_id}",
        "/api/activity/template-types",
        "/api/activity/templates",
        "/api/activity/templates/create",
        "/api/activity/templates/{id}",
        "/api/activity/templates/{id}/fields/reset-defaults",
        "/api/activity/templates/{id}/toggle",
        "/api/activity/variable-presets",
        "/api/activity/jobs/create",
        "/api/activity/jobs",
        "/api/activity/jobs/{id}",
        "/api/activity/jobs/{id}/qc",
        "/api/activity/jobs/{id}/archive",
        "/api/activity/batches/create",
        "/api/activity/batches",
        "/api/activity/batches/drafts",
        "/api/activity/batches/{id}",
        "/api/activity/batches/{id}/refine",
        "/api/activity/batches/{id}/archive-image",
        "/api/activity/batches/{id}/delete-image",
        "/api/activity/batches/{id}/save-draft",
        "/api/background/batches/create",
        "/api/background/batches",
        "/api/background/batches/{id}",
        "/api/background/available-models",
        "/api/background/batches/{id}/generate",
        "/api/background/images/{id}/review",
        "/api/background/images/{id}/refine",
        "/api/background/images/{id}/archive",
        "/api/background/images",
        "/api/background/images/{id}/use-count",
        "/api/stats/dashboard",
        "/api/stats/cost-daily",
        "/api/stats/model",
        "/api/stats/user",
        "/api/stats/images",
        "/api/audit-logs",
        "/api/workflow-sessions/save",
        "/api/workflow-sessions",
        "/api/workflow-sessions/{id}",
        "/api/video/jobs/create",
        "/api/video/jobs/list",
        "/api/video/jobs/{job_id}",
        "/api/video/jobs/{job_id}/status",
        "/api/video/jobs/{job_id}/download",
        "/api/video/jobs/{job_id}/compose",
        "/api/video/jobs/{job_id}/compose-all",
        "/api/video/draft/generate",
        "/api/video/draft/{job_id}/list",
        "/api/video/draft/{job_id}/select/{draft_id}",
        "/api/video/draft/{job_id}/history/{draft_id}",
        "/api/video/draft/{job_id}/revert/{draft_id}",
        "/api/video/motion/{job_id}",
        "/api/video/first-frame/{job_id}/select",
        "/api/video/first-frame/{job_id}/awaiting-make",
        "/api/video/first-frame/{job_id}/writeback",
        "/api/video/first-frame/{job_id}/status",
    }

    def test_app_exposes_root_status_and_docs(self):
        client = TestClient(main.app)

        root = client.get("/")
        docs = client.get("/docs")

        self.assertEqual(root.status_code, 200)
        self.assertEqual(root.json()["status"], "ok")
        self.assertEqual(root.json()["version"], "1.0.0")
        self.assertEqual(docs.status_code, 200)

    def test_all_api_routes_are_registered_once(self):
        actual_paths = {
            route.path
            for route in main.app.routes
            if hasattr(route, "methods")
            and route.path.startswith("/api")
            and "HEAD" not in route.methods
        }

        self.assertTrue(self.expected_paths.issubset(actual_paths))
        self.assertFalse(any(path.startswith("/api/api/") for path in actual_paths))

    def test_startup_log_masks_database_url(self):
        buffer = io.StringIO()

        with redirect_stdout(buffer):
            main.log_startup_config()

        output = buffer.getvalue()
        self.assertIn("STORAGE_TYPE=", output)
        self.assertIn("DATABASE_HOST=", output)
        self.assertNotIn("password", output)

    def test_static_files_include_cors_headers_for_frontend_ports(self):
        storage_dir = Path(main.ensure_static_storage_directory())
        static_file = storage_dir / "cors-smoke.txt"
        static_file.write_text("ok", encoding="utf-8")
        client = TestClient(main.app)

        try:
            response = client.get(
                "/static/cors-smoke.txt",
                headers={"Origin": "http://localhost:3001"},
            )
        finally:
            static_file.unlink(missing_ok=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3001")

    def test_runtime_schema_sync_adds_background_tag_group_column_and_backfill(self):
        source = inspect.getsource(main.ensure_runtime_schema)
        backfill_sql = main.BACKGROUND_TAG_GROUP_BACKFILL_SQL
        seed_sql = main.BACKGROUND_TAG_SEED_SQL

        self.assertIn("ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS tag_group VARCHAR(50) DEFAULT NULL", source)
        self.assertIn("ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS name_en VARCHAR(120)", source)
        self.assertIn("ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS name_zh VARCHAR(120)", source)
        self.assertIn("ALTER TABLE gallery_tags ADD COLUMN IF NOT EXISTS name_en VARCHAR(120)", source)
        self.assertIn("ALTER TABLE gallery_tags ADD COLUMN IF NOT EXISTS name_zh VARCHAR(120)", source)
        self.assertIn("ALTER TABLE background_generation_batches ADD COLUMN IF NOT EXISTS extra_prompt TEXT DEFAULT NULL", source)
        self.assertIn("UPDATE asset_tags", backfill_sql)
        self.assertIn("category = 'background'", backfill_sql)
        self.assertIn("color_style", backfill_sql)
        self.assertIn("INSERT INTO asset_tags (name, category, tag_group)", seed_sql)
        self.assertIn("('活动', 'background', 'purpose')", seed_sql)
        self.assertIn("('清爽绿', 'background', 'color_style')", seed_sql)
        self.assertIn("name_zh = name", source)


if __name__ == "__main__":
    unittest.main()
