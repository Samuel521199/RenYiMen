from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class TrendingNewsTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: str
    title: str
    publish_time: Optional[datetime] = None
    topic_type: str
    event_summary: Optional[str] = None
    main_entities: list[str] = []
    event_action: Optional[str] = None
    event_result: Optional[str] = None
    emotion_direction: Optional[str] = None
    risk_tags: list[str] = []
    local_relevance: Optional[str] = None
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    risk_level: Optional[str] = None
    allow_game_integration: bool = False
    import_status: str
    process_status: str
    image_status: str
    trending_job_id: Optional[int] = None
    imported_at: datetime


class TrendingNewsImportResponse(BaseModel):
    success: bool
    imported_count: int
    skipped_count: int
    error_count: int
    total: int
    tasks: list[TrendingNewsTaskResponse] = []
    skipped: list[dict] = []
    errors: list[dict] = []
