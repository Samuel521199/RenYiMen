import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


DEFAULT_STATIC_CACHE_MAX_AGE = 86_400


def parse_static_cache_max_age(raw: str | None) -> int:
    try:
        parsed = int(raw or "")
    except ValueError:
        return DEFAULT_STATIC_CACHE_MAX_AGE
    return parsed if parsed >= 0 else DEFAULT_STATIC_CACHE_MAX_AGE


def build_static_cache_control(max_age: int) -> str:
    safe_max_age = max_age if max_age >= 0 else DEFAULT_STATIC_CACHE_MAX_AGE
    return f"public, max-age={safe_max_age}, must-revalidate"


class StaticCacheMiddleware(BaseHTTPMiddleware):
    """Attach Cache-Control to `/static/*` file responses."""

    def __init__(self, app, max_age: int | None = None):
        super().__init__(app)
        self.max_age = (
            max_age
            if max_age is not None
            else parse_static_cache_max_age(os.getenv("STATIC_CACHE_MAX_AGE"))
        )

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.method not in {"GET", "HEAD"}:
            return response
        if not request.url.path.startswith("/static/"):
            return response
        if response.status_code not in {200, 206}:
            return response
        if "cache-control" not in response.headers:
            response.headers["Cache-Control"] = build_static_cache_control(self.max_age)
        return response
