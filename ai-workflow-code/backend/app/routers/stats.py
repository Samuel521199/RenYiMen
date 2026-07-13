from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.image import FinalImage, GenerationLog, TaskImage
from app.models.review import ReviewLog
from app.models.stats import DailyCostStat as DailyCostStatModel
from app.models.stats import PublishStat
from app.models.task import Task
from app.models.user import User
from app.models.video import VideoDraft, VideoJob
from app.schemas.stats import DashboardStats, UserStat
from app.utils.response import ok


def _require_admin(current_user: dict[str, Any]) -> None:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


router = APIRouter()


@router.get("/api/stats/dashboard")
async def dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    today_tasks = await db.scalar(select(func.count(Task.id)))
    today_images = await db.scalar(select(func.count(TaskImage.id)))
    pending_reviews = await db.scalar(select(func.count(ReviewLog.id)).where(ReviewLog.status == "pending"))
    total_cost = await db.scalar(select(func.coalesce(func.sum(GenerationLog.cost_usd), 0)))
    stats = DashboardStats(
        today_tasks=int(today_tasks or 0),
        today_cost_usd=Decimal(total_cost or 0),
        today_images=int(today_images or 0),
        pending_reviews=int(pending_reviews or 0),
    )
    return ok(stats.model_dump(mode="json"))


@router.get("/api/stats/cost-daily")
async def cost_daily(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    days = max(1, min(days, 90))  # 限制 1~90 天
    img_result = await db.execute(
        select(
            DailyCostStatModel.stat_date,
            func.sum(DailyCostStatModel.total_cost).label("total_cost_usd"),
            func.sum(DailyCostStatModel.image_count).label("image_count"),
        )
        .group_by(DailyCostStatModel.stat_date)
        .order_by(DailyCostStatModel.stat_date.desc())
        .limit(days)
    )
    cost_map: dict[str, dict] = {}
    for row in img_result.all():
        d = str(row[0])
        cost_map[d] = {
            "stat_date": d,
            "total_cost_usd": float(row[1] or 0),
            "image_count": int(row[2] or 0),
        }

    video_result = await db.execute(
        select(
            func.date(VideoDraft.created_at).label("vdate"),
            func.sum(VideoDraft.generation_cost).label("vcost"),
            func.count(VideoDraft.id).label("vcount"),
        )
        .where(VideoDraft.generation_cost > 0)
        .group_by(func.date(VideoDraft.created_at))
    )
    for row in video_result.all():
        d = str(row[0])
        vcost = float(row[1] or 0)
        if d in cost_map:
            cost_map[d]["total_cost_usd"] += vcost
            cost_map[d]["image_count"] += int(row[2] or 0)
        else:
            cost_map[d] = {
                "stat_date": d,
                "total_cost_usd": vcost,
                "image_count": int(row[2] or 0),
            }

    stats = sorted(cost_map.values(), key=lambda x: x["stat_date"])[-7:]
    return ok(stats)


@router.get("/api/stats/model")
async def model_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    img_result = await db.execute(
        select(
            GenerationLog.model_name,
            GenerationLog.model_provider,
            func.coalesce(func.sum(GenerationLog.token_used), 0),
            func.coalesce(func.sum(GenerationLog.cost_usd), 0),
            func.coalesce(func.sum(GenerationLog.image_count), 0),
        ).group_by(GenerationLog.model_name, GenerationLog.model_provider)
    )

    stats_map: dict[str, dict] = {}
    for row in img_result.all():
        cost = float(row[3] or 0)
        if cost <= 0:
            continue
        name = row[0] or row[1] or "unknown"
        stats_map[name] = {
            "model_name": name,
            "model_provider": row[1] or "unknown",
            "total_tokens": int(row[2] or 0),
            "total_cost": cost,
            "image_count": int(row[4] or 0),
        }

    video_result = await db.execute(
        select(
            VideoDraft.model,
            func.coalesce(func.sum(VideoDraft.generation_cost), 0),
            func.count(VideoDraft.id),
        )
        .where(VideoDraft.generation_cost > 0)
        .group_by(VideoDraft.model)
    )
    for row in video_result.all():
        model_name = row[0] or "kling"
        cost = float(row[1] or 0)
        if cost <= 0:
            continue
        if model_name in stats_map:
            stats_map[model_name]["total_cost"] += cost
            stats_map[model_name]["image_count"] += int(row[2] or 0)
        else:
            stats_map[model_name] = {
                "model_name": model_name,
                "model_provider": "kling",
                "total_tokens": 0,
                "total_cost": cost,
                "image_count": int(row[2] or 0),
            }

    return ok(list(stats_map.values()))


@router.get("/api/stats/user")
async def user_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(
            GenerationLog.operator_id,
            User.username,
            func.coalesce(func.sum(GenerationLog.token_used), 0),
            func.coalesce(func.sum(GenerationLog.cost_usd), 0),
            func.coalesce(func.sum(GenerationLog.image_count), 0),
        )
        .join(User, User.id == GenerationLog.operator_id, isouter=True)
        .group_by(GenerationLog.operator_id, User.username)
    )
    stats = [
        UserStat(
            user_id=int(row[0] or 0),
            username=row[1],
            total_tokens=int(row[2] or 0),
            total_cost=Decimal(row[3] or 0),
            image_count=int(row[4] or 0),
        )
        for row in result.all()
    ]
    return ok([stat.model_dump(mode="json") for stat in stats])


@router.get("/api/stats/images")
async def image_performance_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    score = PublishStat.likes + PublishStat.shares
    result = await db.execute(
        select(
            PublishStat,
            FinalImage.image_url.label("final_image_url"),
            TaskImage.image_url.label("task_image_url"),
        )
        .join(FinalImage, FinalImage.id == PublishStat.final_image_id, isouter=True)
        .join(TaskImage, TaskImage.id == PublishStat.image_id, isouter=True)
        .order_by(score.desc(), PublishStat.id.desc())
    )
    stats = []
    for publish_stat, final_image_url, task_image_url in result.all():
        stats.append(
            {
                "id": publish_stat.id,
                "image_id": publish_stat.image_id,
                "final_image_id": publish_stat.final_image_id,
                "image_url": final_image_url or task_image_url,
                "publish_date": publish_stat.publish_date.isoformat(),
                "channel": publish_stat.channel,
                "likes": publish_stat.likes,
                "comments": publish_stat.comments,
                "shares": publish_stat.shares,
                "score": publish_stat.likes + publish_stat.shares,
                "notes": publish_stat.notes,
                "created_at": publish_stat.created_at.isoformat() if publish_stat.created_at else None,
            }
        )
    return ok(stats)


@router.get("/api/stats/daily-calls")
async def daily_call_stats(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """按日期聚合 GenerationLog（图片）和 VideoDraft（视频）调用次数，返回最近 N 天有数据的行。"""
    _require_admin(current_user)
    days = max(1, min(days, 90))

    img_rows = await db.execute(
        select(
            func.date(GenerationLog.created_at).label("d"),
            func.count(GenerationLog.id).label("cnt"),
        )
        .group_by(func.date(GenerationLog.created_at))
        .order_by(func.date(GenerationLog.created_at).desc())
        .limit(days)
    )
    date_map: dict[str, dict] = {}
    for row in img_rows.all():
        d = str(row.d)
        date_map[d] = {"date": d, "image_calls": int(row.cnt or 0), "video_calls": 0}

    video_rows = await db.execute(
        select(
            func.date(VideoDraft.created_at).label("d"),
            func.count(VideoDraft.id).label("cnt"),
        )
        .group_by(func.date(VideoDraft.created_at))
        .order_by(func.date(VideoDraft.created_at).desc())
        .limit(days)
    )
    for row in video_rows.all():
        d = str(row.d)
        if d in date_map:
            date_map[d]["video_calls"] = int(row.cnt or 0)
        else:
            date_map[d] = {"date": d, "image_calls": 0, "video_calls": int(row.cnt or 0)}

    result = sorted(date_map.values(), key=lambda x: x["date"])
    for item in result:
        item["total_calls"] = item["image_calls"] + item["video_calls"]
        item["label"] = item["date"][5:]  # MM-DD
    return ok(result)


@router.get("/api/stats/model-detail")
async def model_detail_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """按 AI 模型名聚合调用次数、Token 用量、费用。仅管理员可访问。"""
    _require_admin(current_user)

    # 图片生成日志：按 model_name + model_provider 分组
    img_rows = await db.execute(
        select(
            GenerationLog.model_name,
            GenerationLog.model_provider,
            func.count(GenerationLog.id).label("call_count"),
            func.coalesce(func.sum(GenerationLog.token_used), 0).label("total_tokens"),
            func.coalesce(func.sum(GenerationLog.cost_usd), 0).label("total_cost"),
            func.coalesce(func.sum(GenerationLog.image_count), 0).label("image_count"),
        ).group_by(GenerationLog.model_name, GenerationLog.model_provider)
    )

    stats_map: dict[str, dict] = {}
    for row in img_rows.all():
        key = row.model_name or row.model_provider or "unknown"
        stats_map[key] = {
            "model_name": key,
            "model_provider": row.model_provider or "unknown",
            "call_count": int(row.call_count or 0),
            "total_tokens": int(row.total_tokens or 0),
            "total_cost_usd": float(row.total_cost or 0),
            "image_count": int(row.image_count or 0),
            "type": "image",
        }

    # 视频草稿：按 model 分组
    video_rows = await db.execute(
        select(
            VideoDraft.model,
            func.count(VideoDraft.id).label("call_count"),
            func.coalesce(func.sum(VideoDraft.generation_cost), 0).label("total_cost"),
        ).group_by(VideoDraft.model)
    )
    for row in video_rows.all():
        key = row.model or "kling_unknown"
        if key in stats_map:
            stats_map[key]["call_count"] += int(row.call_count or 0)
            stats_map[key]["total_cost_usd"] += float(row.total_cost or 0)
        else:
            stats_map[key] = {
                "model_name": key,
                "model_provider": "kling",
                "call_count": int(row.call_count or 0),
                "total_tokens": 0,
                "total_cost_usd": float(row.total_cost or 0),
                "image_count": 0,
                "type": "video",
            }

    result_list = sorted(stats_map.values(), key=lambda x: x["call_count"], reverse=True)
    return ok(result_list)


@router.get("/api/stats/user-model")
async def user_model_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """按用户 × AI 模型聚合调用次数。仅管理员可访问。"""
    _require_admin(current_user)

    # 图片：GenerationLog.operator_id → User
    img_rows = await db.execute(
        select(
            GenerationLog.operator_id,
            User.username,
            GenerationLog.model_name,
            GenerationLog.model_provider,
            func.count(GenerationLog.id).label("call_count"),
            func.coalesce(func.sum(GenerationLog.token_used), 0).label("total_tokens"),
            func.coalesce(func.sum(GenerationLog.cost_usd), 0).label("total_cost"),
        )
        .join(User, User.id == GenerationLog.operator_id, isouter=True)
        .group_by(
            GenerationLog.operator_id,
            User.username,
            GenerationLog.model_name,
            GenerationLog.model_provider,
        )
    )

    # user_id -> { username, models: {model_name -> stat} }
    user_map: dict[int, dict] = {}
    for row in img_rows.all():
        uid = int(row.operator_id or 0)
        model_key = row.model_name or row.model_provider or "unknown"
        if uid not in user_map:
            user_map[uid] = {
                "user_id": uid,
                "username": row.username or f"user_{uid}",
                "total_calls": 0,
                "models": {},
            }
        entry = user_map[uid]
        entry["total_calls"] += int(row.call_count or 0)
        if model_key not in entry["models"]:
            entry["models"][model_key] = {
                "model_name": model_key,
                "model_provider": row.model_provider or "unknown",
                "call_count": 0,
                "total_tokens": 0,
                "total_cost_usd": 0.0,
                "type": "image",
            }
        m = entry["models"][model_key]
        m["call_count"] += int(row.call_count or 0)
        m["total_tokens"] += int(row.total_tokens or 0)
        m["total_cost_usd"] += float(row.total_cost or 0)

    # 视频：VideoDraft → VideoJob.created_by → User
    video_rows = await db.execute(
        select(
            VideoJob.created_by,
            User.username,
            VideoDraft.model,
            func.count(VideoDraft.id).label("call_count"),
            func.coalesce(func.sum(VideoDraft.generation_cost), 0).label("total_cost"),
        )
        .join(VideoJob, VideoJob.id == VideoDraft.video_job_id, isouter=True)
        .join(User, User.id == VideoJob.created_by, isouter=True)
        .group_by(VideoJob.created_by, User.username, VideoDraft.model)
    )
    for row in video_rows.all():
        uid = int(row.created_by or 0)
        model_key = row.model or "kling_unknown"
        if uid not in user_map:
            user_map[uid] = {
                "user_id": uid,
                "username": row.username or f"user_{uid}",
                "total_calls": 0,
                "models": {},
            }
        entry = user_map[uid]
        entry["total_calls"] += int(row.call_count or 0)
        if model_key not in entry["models"]:
            entry["models"][model_key] = {
                "model_name": model_key,
                "model_provider": "kling",
                "call_count": 0,
                "total_tokens": 0,
                "total_cost_usd": 0.0,
                "type": "video",
            }
        m = entry["models"][model_key]
        m["call_count"] += int(row.call_count or 0)
        m["total_cost_usd"] += float(row.total_cost or 0)

    result_list = [
        {**v, "models": sorted(v["models"].values(), key=lambda x: x["call_count"], reverse=True)}
        for v in sorted(user_map.values(), key=lambda x: x["total_calls"], reverse=True)
    ]
    return ok(result_list)
