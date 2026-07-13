"""
Structural tests for video_first_frame router — no real DB calls.
"""
import unittest

from fastapi import FastAPI
from fastapi.routing import APIRoute

from app.routers import video_first_frame


class TestVideoFirstFrameRouterStructure(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(video_first_frame.router)

    def _paths(self):
        return [r.path for r in self.app.routes if isinstance(r, APIRoute)]

    def test_select_route_registered(self):
        self.assertIn("/api/video/first-frame/{job_id}/select", self._paths())

    def test_awaiting_make_route_registered(self):
        self.assertIn("/api/video/first-frame/{job_id}/awaiting-make", self._paths())

    def test_writeback_route_registered(self):
        self.assertIn("/api/video/first-frame/{job_id}/writeback", self._paths())

    def test_status_route_registered(self):
        self.assertIn("/api/video/first-frame/{job_id}/status", self._paths())


if __name__ == "__main__":
    unittest.main()
