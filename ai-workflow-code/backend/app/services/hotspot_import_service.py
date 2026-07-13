from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


VALID_TOPIC_TYPES = {
    "BREAKING_NEWS",
    "SPORTS_EVENT",
    "ENTERTAINMENT",
    "SOCIAL_TOPIC",
    "HOLIDAY_EVENT",
    "POLITICS_GOVERNMENT",
    "CRIME_ACCIDENT",
    "DISASTER_EMERGENCY",
    "ECONOMY_BUSINESS",
    "TECH_GAMING",
    "PUBLIC_FIGURE",
    "VIRAL_TREND",
}

VALID_RISK_TAGS = {
    "NONE",
    "DEATH",
    "INJURY",
    "DISASTER",
    "CRIME",
    "POLITICS",
    "RELIGION",
    "LEGAL",
    "MINOR",
    "SEXUAL",
    "HATE",
    "PUBLIC_FIGURE",
    "FINANCIAL_RISK",
    "MEDICAL",
    "MISINFORMATION_RISK",
}

HIGH_RISK_TAGS = {
    "DEATH",
    "INJURY",
    "DISASTER",
    "CRIME",
    "POLITICS",
    "RELIGION",
    "LEGAL",
    "MINOR",
    "SEXUAL",
    "HATE",
}

SUPPORTED_SCHEMA_VERSIONS = {"1.0"}


@dataclass
class HotspotTask:
    task_id: str
    title: str
    publish_time: str | None
    topic_type: str
    event_summary: str | None
    main_entities: list[str]
    event_action: str | None
    event_result: str | None
    emotion_direction: str | None
    risk_tags: list[str]
    local_relevance: str | None
    source_name: str | None
    source_url: str | None


@dataclass
class ImportResult:
    success: bool
    imported: list[HotspotTask] = field(default_factory=list)
    skipped: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    total: int = 0


def compute_risk_level(topic_type: str, risk_tags: list[str]) -> tuple[str, bool]:
    from app.models.trending import TrendingTopicTypeConfig  # noqa: F401

    topic_defaults: dict[str, tuple[str, bool]] = {
        "BREAKING_NEWS": ("HIGH", False),
        "SPORTS_EVENT": ("LOW", True),
        "ENTERTAINMENT": ("LOW", False),
        "SOCIAL_TOPIC": ("MEDIUM", False),
        "HOLIDAY_EVENT": ("LOW", True),
        "POLITICS_GOVERNMENT": ("HIGH", False),
        "CRIME_ACCIDENT": ("HIGH", False),
        "DISASTER_EMERGENCY": ("HIGH", False),
        "ECONOMY_BUSINESS": ("MEDIUM", False),
        "TECH_GAMING": ("LOW", True),
        "PUBLIC_FIGURE": ("MEDIUM", False),
        "VIRAL_TREND": ("LOW", False),
    }

    base_risk, base_game = topic_defaults.get(topic_type, ("HIGH", False))
    if any(tag in HIGH_RISK_TAGS for tag in risk_tags):
        return "HIGH", False
    return base_risk, base_game


class JsonFileHotspotAdapter:
    """从本地 JSON 文件读取热点任务。"""

    def read(self, file_path: str | Path) -> ImportResult:
        path = Path(file_path)
        result = ImportResult(success=False)

        if not path.exists():
            result.errors.append(
                {
                    "error_type": "FILE_NOT_FOUND",
                    "message": f"File not found: {file_path}",
                }
            )
            return result

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            result.errors.append(
                {
                    "error_type": "INVALID_JSON",
                    "message": str(exc),
                }
            )
            return result

        schema_version = raw.get("schema_version", "")
        if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
            result.errors.append(
                {
                    "error_type": "SCHEMA_VERSION_UNSUPPORTED",
                    "message": f"Unsupported schema_version: {schema_version}",
                }
            )
            return result

        items = raw.get("items")
        if not isinstance(items, list):
            result.errors.append(
                {
                    "error_type": "MISSING_REQUIRED_FIELD",
                    "message": "Field 'items' is missing or not a list",
                }
            )
            return result

        result.total = len(items)
        seen_task_ids: set[str] = set()

        for item in items:
            if not isinstance(item, dict):
                result.errors.append(
                    {
                        "error_type": "INVALID_ITEM",
                        "message": "Each item must be a JSON object",
                    }
                )
                continue

            task_id = item.get("task_id", "")
            if not task_id:
                result.errors.append(
                    {
                        "error_type": "MISSING_REQUIRED_FIELD",
                        "message": "Field 'task_id' is required",
                    }
                )
                continue

            if not item.get("title"):
                result.errors.append(
                    {
                        "error_type": "MISSING_REQUIRED_FIELD",
                        "message": "Field 'title' is required",
                        "task_id": task_id,
                    }
                )
                continue

            if not item.get("topic_type"):
                result.errors.append(
                    {
                        "error_type": "MISSING_REQUIRED_FIELD",
                        "message": "Field 'topic_type' is required",
                        "task_id": task_id,
                    }
                )
                continue

            if item["topic_type"] not in VALID_TOPIC_TYPES:
                result.errors.append(
                    {
                        "error_type": "INVALID_TOPIC_TYPE",
                        "message": f"Unknown topic_type: {item['topic_type']}",
                        "task_id": task_id,
                    }
                )
                continue

            risk_tags = item.get("risk_tags", ["NONE"])
            if not isinstance(risk_tags, list):
                risk_tags = ["NONE"]
            invalid_tags = [tag for tag in risk_tags if tag not in VALID_RISK_TAGS]
            if invalid_tags:
                result.errors.append(
                    {
                        "error_type": "INVALID_RISK_TAG",
                        "message": f"Invalid risk_tags: {invalid_tags}",
                        "task_id": task_id,
                    }
                )
                continue

            if task_id in seen_task_ids:
                result.skipped.append(
                    {
                        "task_id": task_id,
                        "reason": "DUPLICATE_TASK_ID",
                    }
                )
                continue
            seen_task_ids.add(task_id)

            main_entities = item.get("main_entities") or []
            if not isinstance(main_entities, list):
                main_entities = []

            result.imported.append(
                HotspotTask(
                    task_id=task_id,
                    title=item["title"],
                    publish_time=item.get("publish_time"),
                    topic_type=item["topic_type"],
                    event_summary=item.get("event_summary"),
                    main_entities=[str(value) for value in main_entities if value is not None],
                    event_action=item.get("event_action"),
                    event_result=item.get("event_result"),
                    emotion_direction=item.get("emotion_direction"),
                    risk_tags=[str(tag) for tag in risk_tags],
                    local_relevance=item.get("local_relevance"),
                    source_name=item.get("source_name"),
                    source_url=item.get("source_url"),
                )
            )

        result.success = len(result.errors) == 0 or len(result.imported) > 0
        return result


class HotspotImportService:
    """统一导入服务。当前仅支持 JsonFileAdapter。"""

    def __init__(self, adapter: JsonFileHotspotAdapter | None = None):
        self.adapter = adapter or JsonFileHotspotAdapter()

    def import_from_file(self, file_path: str | Path) -> ImportResult:
        return self.adapter.read(file_path)

    def parse_from_json_content(self, content: str) -> ImportResult:
        import tempfile

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", encoding="utf-8", delete=False) as f:
            f.write(content)
            tmp_path = f.name
        try:
            return self.adapter.read(tmp_path)
        finally:
            Path(tmp_path).unlink(missing_ok=True)
