from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.utils.response import ok


router = APIRouter(prefix="/api/video", tags=["video"])


DEFAULT_VIDEO_ENUMS: dict[str, list[dict[str, Any]]] = {
    "emotion": [
        {"value": "surprised and delighted, eyes wide open with joy", "label_zh": "惊喜"},
        {"value": "shocked and stunned, jaw dropped in disbelief", "label_zh": "吃惊"},
        {"value": "happy and cheerful, big smile", "label_zh": "开心"},
        {"value": "laughing out loud, extremely amused", "label_zh": "大笑"},
        {"value": "excited and anticipating, eager expression", "label_zh": "期待"},
        {"value": "warm and friendly, gentle smile", "label_zh": "温暖"},
        {"value": "tense and focused, serious expression", "label_zh": "紧张"},
        {"value": "shy and bashful, slightly embarrassed", "label_zh": "害羞"},
        {"value": "tsundere, playfully smug with hidden affection", "label_zh": "傲娇"},
        {"value": "funny and playful, goofy expression", "label_zh": "搞笑"},
        {"value": "cool and confident, stylish attitude", "label_zh": "酷炫"},
        {"value": "touched and moved, emotional with gratitude", "label_zh": "感动"},
        {"value": "confused and puzzled, tilting head", "label_zh": "疑惑"},
        {"value": "proud and triumphant, victorious expression", "label_zh": "得意"},
        {"value": "cute and pouty, acting adorable", "label_zh": "撒娇"},
    ],
    "action": [
        {"value": "idle, subtle breathing", "label_zh": "静止"},
        {"value": "slowly looks up", "label_zh": "抬头"},
        {"value": "slowly looks down", "label_zh": "低头"},
        {"value": "surprised and delighted, eyes wide open with joy", "label_zh": "惊喜"},
        {"value": "shocked and stunned, jaw dropped", "label_zh": "吃惊"},
        {"value": "happy, smiling and cheerful", "label_zh": "开心"},
        {"value": "laughing out loud", "label_zh": "大笑"},
        {"value": "turns around", "label_zh": "转身"},
        {"value": "moves forward toward camera", "label_zh": "前进"},
        {"value": "steps back", "label_zh": "后退"},
        {"value": "nods head in agreement", "label_zh": "点头"},
        {"value": "shakes head", "label_zh": "摇头"},
        {"value": "waves hand to greet", "label_zh": "招手"},
    ],
}


class VideoEnumCreate(BaseModel):
    enum_type: str
    value: str
    label_zh: str


async def seed_video_enum_if_empty(db: AsyncSession, enum_type: str) -> None:
    result = await db.execute(
        text("SELECT COUNT(*) FROM video_enum_configs WHERE enum_type = :enum_type"),
        {"enum_type": enum_type},
    )
    if int(result.scalar() or 0) > 0:
        return

    defaults = DEFAULT_VIDEO_ENUMS.get(enum_type, [])
    for index, item in enumerate(defaults):
        await db.execute(
            text(
                """
                INSERT INTO video_enum_configs (enum_type, value, label_zh, sort_order, is_active)
                VALUES (:enum_type, :value, :label_zh, :sort_order, TRUE)
                ON CONFLICT (enum_type, value) DO NOTHING
                """
            ),
            {
                "enum_type": enum_type,
                "value": item["value"],
                "label_zh": item["label_zh"],
                "sort_order": index,
            },
        )
    await db.commit()


async def list_video_enum_items(db: AsyncSession, enum_type: str) -> list[dict[str, Any]]:
    result = await db.execute(
        text(
            """
            SELECT id, enum_type, value, label_zh, sort_order, is_active
            FROM video_enum_configs
            WHERE enum_type = :enum_type AND is_active = TRUE
            ORDER BY sort_order ASC, id ASC
            """
        ),
        {"enum_type": enum_type},
    )
    return [
        {
            "id": row[0],
            "enum_type": row[1],
            "value": row[2],
            "label_zh": row[3],
            "sort_order": row[4],
            "is_active": row[5],
        }
        for row in result.all()
    ]


@router.get("/enums", response_model=dict)
async def get_video_enums(
    type: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    await seed_video_enum_if_empty(db, type)
    return ok(await list_video_enum_items(db, type))


@router.post("/enums", response_model=dict)
async def create_video_enum(
    body: VideoEnumCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    await seed_video_enum_if_empty(db, body.enum_type)
    result = await db.execute(
        text("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM video_enum_configs WHERE enum_type = :enum_type"),
        {"enum_type": body.enum_type},
    )
    next_sort_order = int(result.scalar() or 0)
    await db.execute(
        text(
            """
            INSERT INTO video_enum_configs (enum_type, value, label_zh, sort_order, is_active)
            VALUES (:enum_type, :value, :label_zh, :sort_order, TRUE)
            ON CONFLICT (enum_type, value)
            DO UPDATE SET label_zh = EXCLUDED.label_zh, is_active = TRUE
            """
        ),
        {
            "enum_type": body.enum_type,
            "value": body.value,
            "label_zh": body.label_zh,
            "sort_order": next_sort_order,
        },
    )
    await db.commit()
    return ok(await list_video_enum_items(db, body.enum_type))
