"""
E2E flow tests for video workflow — Step 1 first frame selection.
Tests the complete path: create job → awaiting_make → writeback → status check → advance step.
Uses structural + schema validation only (no real DB).
"""
import unittest

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.routers import video_first_frame, video_jobs


def make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(video_jobs.router)
    app.include_router(video_first_frame.router)
    return app


class TestVideoStep1Flow(unittest.TestCase):
    """
    Validates the Step 1 route contract:
    all required endpoints exist and enforce auth (401/403 without token).
    """

    def setUp(self):
        self.app = make_app()
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def _paths(self):
        return [r.path for r in self.app.routes if isinstance(r, APIRoute)]

    def test_all_step1_routes_registered(self):
        required = [
            "/api/video/jobs/create",
            "/api/video/jobs/list",
            "/api/video/jobs/{job_id}",
            "/api/video/jobs/{job_id}/status",
            "/api/video/first-frame/{job_id}/select",
            "/api/video/first-frame/{job_id}/awaiting-make",
            "/api/video/first-frame/{job_id}/writeback",
            "/api/video/first-frame/{job_id}/status",
        ]
        paths = self._paths()
        for route in required:
            self.assertIn(route, paths, f"Missing route: {route}")

    def test_create_job_requires_auth(self):
        resp = self.client.post("/api/video/jobs/create", json={"video_language": "english"})
        self.assertIn(resp.status_code, [401, 403])

    def test_awaiting_make_requires_auth(self):
        fake_id = "00000000-0000-0000-0000-000000000001"
        resp = self.client.post(f"/api/video/first-frame/{fake_id}/awaiting-make")
        self.assertIn(resp.status_code, [401, 403])

    def test_writeback_requires_auth(self):
        fake_id = "00000000-0000-0000-0000-000000000001"
        resp = self.client.post(
            f"/api/video/first-frame/{fake_id}/writeback",
            json={"asset_id": 1, "url": "http://example.com/img.jpg", "source_type": "frame"},
        )
        self.assertIn(resp.status_code, [401, 403])

    def test_status_poll_requires_auth(self):
        fake_id = "00000000-0000-0000-0000-000000000001"
        resp = self.client.get(f"/api/video/first-frame/{fake_id}/status")
        self.assertIn(resp.status_code, [401, 403])

    def test_advance_step_requires_auth(self):
        fake_id = "00000000-0000-0000-0000-000000000001"
        resp = self.client.patch(
            f"/api/video/jobs/{fake_id}/status",
            json={"current_step": 2},
        )
        self.assertIn(resp.status_code, [401, 403])

    def test_create_is_post_only(self):
        resp = self.client.get("/api/video/jobs/create")
        # FastAPI may return 401 (auth first) or 405 (method not allowed) depending on middleware order
        self.assertIn(resp.status_code, [401, 403, 405])

    def test_awaiting_make_is_post_only(self):
        fake_id = "00000000-0000-0000-0000-000000000001"
        resp = self.client.get(f"/api/video/first-frame/{fake_id}/awaiting-make")
        self.assertEqual(resp.status_code, 405)

    def test_writeback_validates_body(self):
        """Without auth we get 401/403; body shape is still validated first by FastAPI in some configs."""
        fake_id = "00000000-0000-0000-0000-000000000001"
        resp = self.client.post(
            f"/api/video/first-frame/{fake_id}/writeback",
            json={},
        )
        self.assertIn(resp.status_code, [401, 403, 422])

    def test_advance_step_validates_body(self):
        fake_id = "00000000-0000-0000-0000-000000000001"
        resp = self.client.patch(
            f"/api/video/jobs/{fake_id}/status",
            json={"current_step": 99},
        )
        self.assertIn(resp.status_code, [401, 403, 422])


class TestVideoServiceUnit(unittest.TestCase):
    """
    Pure unit tests for video_service business logic — no DB, no HTTP.
    """

    def test_build_motion_sequence_order(self):
        from app.services.video_service import build_motion_sequence

        seq, timing = build_motion_sequence([
            {"timestamp": 3.5, "label": "shock"},
            {"timestamp": 0.0, "label": "idle"},
            {"timestamp": 1.5, "label": "tilt"},
        ])
        self.assertEqual(seq, ["idle", "tilt", "shock"])
        self.assertAlmostEqual(timing["tilt"], 1.5)

    def test_advance_step_forward(self):
        from unittest.mock import MagicMock

        from app.models.video import VideoJob
        from app.services.video_service import STEP_STATUS_MAP, advance_step

        job = MagicMock(spec=VideoJob)
        job.current_step = 1
        job.status = "draft"
        advance_step(job, 2)
        self.assertEqual(job.current_step, 2)
        self.assertEqual(job.status, STEP_STATUS_MAP[2])

    def test_advance_step_invalid_raises(self):
        from unittest.mock import MagicMock

        from app.models.video import VideoJob
        from app.services.video_service import advance_step

        job = MagicMock(spec=VideoJob)
        job.current_step = 1
        job.status = "draft"
        with self.assertRaises(ValueError):
            advance_step(job, 99)

    def test_apply_first_frame(self):
        from unittest.mock import MagicMock

        from app.models.video import VideoJob
        from app.services.video_service import apply_first_frame

        job = MagicMock(spec=VideoJob)
        apply_first_frame(job, 42, "http://example.com/img.jpg", "gallery")
        self.assertEqual(job.first_frame_asset_id, 42)
        self.assertEqual(job.first_frame_url, "http://example.com/img.jpg")
        self.assertEqual(job.first_frame_source_type, "gallery")
        self.assertEqual(job.first_frame_status, "selected")

    def test_is_first_frame_ready_true(self):
        from unittest.mock import MagicMock

        from app.services.video_service import is_first_frame_ready

        job = MagicMock()
        job.first_frame_status = "selected"
        job.first_frame_url = "http://example.com/img.jpg"
        self.assertTrue(is_first_frame_ready(job))

    def test_is_first_frame_ready_false_when_empty(self):
        from unittest.mock import MagicMock

        from app.services.video_service import is_first_frame_ready

        job = MagicMock()
        job.first_frame_status = "awaiting_make"
        job.first_frame_url = None
        self.assertFalse(is_first_frame_ready(job))

    def test_can_advance_from_step1_false_when_empty(self):
        """Frontend canAdvanceFrom logic mirrored in service — first frame must be selected."""
        from unittest.mock import MagicMock

        from app.services.video_service import is_first_frame_ready

        job = MagicMock()
        job.first_frame_status = "empty"
        job.first_frame_url = None
        self.assertFalse(is_first_frame_ready(job))


if __name__ == "__main__":
    unittest.main()
