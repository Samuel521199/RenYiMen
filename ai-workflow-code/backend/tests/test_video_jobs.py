"""
Structural tests for video_jobs router — no real DB calls.
"""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import video_jobs


class TestVideoJobsRouterStructure(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(video_jobs.router)
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def _route_paths(self):
        from fastapi.routing import APIRoute

        return [r.path for r in self.app.routes if isinstance(r, APIRoute)]

    def test_create_route_registered(self):
        self.assertIn("/api/video/jobs/create", self._route_paths())

    def test_list_route_registered(self):
        self.assertIn("/api/video/jobs/list", self._route_paths())

    def test_get_route_registered(self):
        self.assertIn("/api/video/jobs/{job_id}", self._route_paths())

    def test_status_update_route_registered(self):
        self.assertIn("/api/video/jobs/{job_id}/status", self._route_paths())

    def test_create_returns_401_without_token(self):
        resp = self.client.post(
            "/api/video/jobs/create",
            json={"video_language": "english"},
        )
        self.assertIn(
            resp.status_code,
            [401, 403, 422],
            f"Expected auth/validation error, got {resp.status_code}",
        )

    def test_list_returns_401_without_token(self):
        resp = self.client.get("/api/video/jobs/list")
        self.assertIn(
            resp.status_code,
            [401, 403, 422],
            f"Expected auth error, got {resp.status_code}",
        )


if __name__ == "__main__":
    unittest.main()
