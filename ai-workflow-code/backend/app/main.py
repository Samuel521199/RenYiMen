from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import os
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.middleware.static_cache import StaticCacheMiddleware
from app.routers import (
    activity_batches,
    activity_workflows,
    assets,
    audit,
    auth,
    background,
    identity_conflicts,
    multi_fusion,
    gallery,
    generate,
    instructions,
    model_configs,
    permissions,
    prompts,
    review,
    stats,
    system,
    tasks,
    translate,
    user_model_api_keys,
    users,
    video_draft,
    video_first_frame,
    video_jobs,
    video_motion,
    video_workflows,
    workflow_sessions,
)
from app.routers import daily_post_workflows
from app.routers import hotspot_import
from app.routers.logo_workflows import router as logo_router
from app.routers.share_workflows import router as share_router
from app.routers import trending_workflows
from app.models import trending  # noqa: F401
from app.models import multi_fusion as multi_fusion_models  # noqa: F401


API_VERSION = "1.0.0"
API_PREFIX = "/api"
BACKGROUND_TAG_SEED_SQL = """
INSERT INTO asset_tags (name, category, tag_group)
VALUES
    ('活动', 'background', 'purpose'),
    ('日常', 'background', 'purpose'),
    ('节日', 'background', 'purpose'),
    ('搞笑', 'background', 'purpose'),
    ('通用', 'background', 'purpose'),
    ('室内', 'background', 'scene'),
    ('户外', 'background', 'scene'),
    ('街头', 'background', 'scene'),
    ('海边', 'background', 'scene'),
    ('菲律宾街景', 'background', 'scene'),
    ('搞笑', 'background', 'mood'),
    ('轻松', 'background', 'mood'),
    ('浪漫', 'background', 'mood'),
    ('激情', 'background', 'mood'),
    ('奖励感', 'background', 'mood'),
    ('蓝金', 'background', 'color_style'),
    ('红金', 'background', 'color_style'),
    ('紫金', 'background', 'color_style'),
    ('清爽绿', 'background', 'color_style'),
    ('暖色调', 'background', 'color_style'),
    ('清爽绿色', 'background', 'color_style')
ON CONFLICT (category, name) DO NOTHING;
"""
BACKGROUND_TAG_GROUP_BACKFILL_SQL = """
UPDATE asset_tags
SET tag_group = CASE
    WHEN name IN ('活动图', '日常互动图', '热点图', '节日图', '通用') THEN 'purpose'
    WHEN name IN ('菲律宾街景', '街景', '商场', '夜市', '海岛', '室内', '游戏大厅') THEN 'scene'
    WHEN name IN ('奖励感', '幸运感', '回归感', '节日感', '竞技感', '轻松娱乐') THEN 'mood'
    WHEN name IN ('蓝金', '红金', '紫金', '清爽绿色', '暖色调') THEN 'color_style'
    ELSE tag_group
END
WHERE category = 'background'
  AND (tag_group IS NULL OR tag_group = '');
"""


def ensure_static_storage_directory() -> str:
    try:
        os.makedirs(settings.storage_local_path, exist_ok=True)
        return settings.storage_local_path
    except OSError:
        fallback = Path(__file__).resolve().parents[2] / "storage"
        fallback.mkdir(parents=True, exist_ok=True)
        return str(fallback)


def database_host(database_url: str) -> str:
    parsed = urlparse(database_url)
    return parsed.hostname or "unknown"


def log_startup_config() -> None:
    print(f"STORAGE_TYPE={settings.storage_type}")
    print(f"DATABASE_HOST={database_host(settings.database_url)}")


async def ensure_runtime_schema() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'"))
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_user_id VARCHAR(191)"))
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)"))
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(120)"))
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_source VARCHAR(20) DEFAULT 'local'"))
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sso_at TIMESTAMP"))
        await connection.execute(
            text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS role_sync_strategy VARCHAR(40) "
                "DEFAULT 'platform_authoritative'"
            )
        )
        await connection.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role_sync_locked BOOLEAN DEFAULT false")
        )
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role_last_source VARCHAR(40)"))
        await connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role_last_synced_at TIMESTAMP"))
        await connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_platform_user_id "
                "ON users(platform_user_id) WHERE platform_user_id IS NOT NULL"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_users_email_lower "
                "ON users (LOWER(email)) WHERE email IS NOT NULL"
            )
        )
        await connection.execute(
            text(
                "UPDATE users SET email = username "
                "WHERE (email IS NULL OR email = '') AND POSITION('@' IN username) > 1"
            )
        )
        await connection.execute(
            text("UPDATE users SET display_name = username WHERE display_name IS NULL OR display_name = ''")
        )
        await connection.execute(
            text("UPDATE users SET auth_source = 'local' WHERE auth_source IS NULL OR auth_source = ''")
        )
        await connection.execute(
            text(
                "UPDATE users SET role_sync_strategy = CASE WHEN role='admin' THEN 'preserve_workbench_admin' "
                "ELSE 'platform_authoritative' END "
                "WHERE role_sync_strategy IS NULL OR role_sync_strategy = ''"
            )
        )
        await connection.execute(
            text(
                "UPDATE users SET role_sync_strategy = 'preserve_workbench_admin' "
                "WHERE role='admin' AND COALESCE(role_sync_locked,false)=false "
                "AND role_sync_strategy='platform_authoritative'"
            )
        )
        await connection.execute(
            text("UPDATE users SET role_sync_locked = false WHERE role_sync_locked IS NULL")
        )
        await connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS identity_conflict_tickets ("
                "id SERIAL PRIMARY KEY,"
                "status VARCHAR(20) NOT NULL DEFAULT 'open',"
                "conflict_key VARCHAR(191) NOT NULL UNIQUE,"
                "conflict_reason VARCHAR(64) NOT NULL,"
                "platform_user_id VARCHAR(191),"
                "email VARCHAR(255),"
                "lookup_username VARCHAR(50),"
                "candidate_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,"
                "conflict_payload JSONB NOT NULL DEFAULT '{}'::jsonb,"
                "detail TEXT,"
                "occur_count INT NOT NULL DEFAULT 1,"
                "last_seen_at TIMESTAMP DEFAULT NOW(),"
                "resolved_by INT REFERENCES users(id) ON DELETE SET NULL,"
                "rebind_to_user_id INT REFERENCES users(id) ON DELETE SET NULL,"
                "resolution_note TEXT,"
                "resolved_at TIMESTAMP,"
                "created_at TIMESTAMP DEFAULT NOW(),"
                "updated_at TIMESTAMP DEFAULT NOW()"
                ")"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_identity_conflict_status_updated "
                "ON identity_conflict_tickets(status, updated_at DESC)"
            )
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_identity_conflict_platform_user_id "
                "ON identity_conflict_tickets(platform_user_id)"
            )
        )
        await connection.execute(text("ALTER TABLE assets ADD COLUMN IF NOT EXISTS use_count INT DEFAULT 0"))
        await connection.execute(
            text("ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS tag_group VARCHAR(50) DEFAULT NULL")
        )
        await connection.execute(text("ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS name_en VARCHAR(120)"))
        await connection.execute(text("ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS name_zh VARCHAR(120)"))
        await connection.execute(text("ALTER TABLE gallery_tags ADD COLUMN IF NOT EXISTS name_en VARCHAR(120)"))
        await connection.execute(text("ALTER TABLE gallery_tags ADD COLUMN IF NOT EXISTS name_zh VARCHAR(120)"))
        await connection.execute(
            text("ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS purpose VARCHAR(50) DEFAULT 'image'")
        )
        await connection.execute(text("ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS export_url TEXT"))
        await connection.execute(text("ALTER TABLE activity_templates ADD COLUMN IF NOT EXISTS name_en VARCHAR(255)"))
        await connection.execute(text("ALTER TABLE activity_templates ADD COLUMN IF NOT EXISTS scenario_en TEXT"))
        await connection.execute(
            text(
                "ALTER TABLE background_generation_batches "
                "ADD COLUMN IF NOT EXISTS whitespace_positions TEXT[] DEFAULT ARRAY['right']::TEXT[]"
            )
        )
        await connection.execute(
            text("ALTER TABLE background_generation_batches ADD COLUMN IF NOT EXISTS extra_prompt TEXT DEFAULT NULL")
        )
        await connection.execute(
            text(
                "UPDATE background_generation_batches "
                "SET whitespace_positions = ARRAY[COALESCE(whitespace_position, 'right')]::TEXT[] "
                "WHERE whitespace_positions IS NULL OR array_length(whitespace_positions, 1) IS NULL"
            )
        )
        await connection.execute(
            text(
                "UPDATE asset_tags "
                "SET name_zh = name "
                "WHERE name_zh IS NULL AND name ~ '[\\u4e00-\\u9fff]'"
            )
        )
        await connection.execute(
            text(
                "UPDATE gallery_tags "
                "SET name_zh = name "
                "WHERE name_zh IS NULL AND name ~ '[\\u4e00-\\u9fff]'"
            )
        )
        await connection.execute(text(BACKGROUND_TAG_SEED_SQL))
        await connection.execute(text(BACKGROUND_TAG_GROUP_BACKFILL_SQL))
        for ddl in [
            """CREATE TABLE IF NOT EXISTS video_enum_configs (
                id SERIAL PRIMARY KEY,
                enum_type VARCHAR(50) NOT NULL,
                value VARCHAR(100) NOT NULL,
                label_zh VARCHAR(100) NOT NULL,
                sort_order INT DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS video_jobs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                session_id INTEGER REFERENCES workflow_sessions(id) ON DELETE SET NULL,
                task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
                created_by INTEGER REFERENCES users(id),
                status VARCHAR(32) NOT NULL DEFAULT 'draft',
                current_step INTEGER NOT NULL DEFAULT 1,
                first_frame_asset_id INTEGER,
                first_frame_url TEXT,
                first_frame_source_type VARCHAR(32),
                first_frame_status VARCHAR(32) DEFAULT 'empty',
                aspect_ratio VARCHAR(8) DEFAULT '9:16',
                motion_preset_id UUID,
                video_language VARCHAR(16) DEFAULT 'english',
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS video_motion_data (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                video_job_id UUID NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
                motion_sequence JSONB NOT NULL DEFAULT '[]',
                timing JSONB NOT NULL DEFAULT '{}',
                camera VARCHAR(64),
                emotion VARCHAR(64),
                scene TEXT,
                raw_keypoints JSONB DEFAULT '[]',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS video_drafts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                video_job_id UUID NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
                model VARCHAR(64) DEFAULT 'kling_v2.6',
                external_task_id VARCHAR(128),
                video_url TEXT,
                thumbnail_url TEXT,
                duration_seconds NUMERIC(5,2),
                status VARCHAR(32) DEFAULT 'pending',
                selected BOOLEAN DEFAULT FALSE,
                generation_cost NUMERIC(10,4) DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS user_model_api_keys (
                id SERIAL PRIMARY KEY,
                user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                model_config_id INT NOT NULL REFERENCES model_configs(id) ON DELETE CASCADE,
                api_key TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (user_id, model_config_id)
            )""",
        ]:
            await connection.execute(text(ddl))
        await connection.execute(text("ALTER TABLE video_jobs DROP COLUMN IF EXISTS first_frame_asset_id"))
        await connection.execute(text("ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS first_frame_asset_id INTEGER"))
        await connection.execute(
            text("ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS aspect_ratio VARCHAR(8) DEFAULT '9:16'")
        )
        await connection.execute(text("ALTER TABLE video_drafts ADD COLUMN IF NOT EXISTS external_task_id VARCHAR(128)"))
        await connection.execute(text("ALTER TABLE video_drafts ADD COLUMN IF NOT EXISTS draft_type VARCHAR(16) DEFAULT 'draft'"))
        await connection.execute(
            text(
                "ALTER TABLE video_drafts ADD COLUMN IF NOT EXISTS parent_draft_id UUID REFERENCES video_drafts(id)"
            )
        )
        await connection.execute(text("ALTER TABLE video_drafts ADD COLUMN IF NOT EXISTS operation VARCHAR(32)"))
        await connection.execute(text("ALTER TABLE video_drafts ADD COLUMN IF NOT EXISTS operation_params JSONB"))
        await connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_video_enum_type_value "
                "ON video_enum_configs(enum_type, value)"
            )
        )
        for ddl in [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_token_limit INT DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_cost_limit NUMERIC(12,4) DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS used_today_tokens INT DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS used_today_cost NUMERIC(12,4) DEFAULT 0",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS usage_reset_date DATE",
            "ALTER TABLE user_model_permissions ADD COLUMN IF NOT EXISTS daily_token_limit INT DEFAULT 0",
            "ALTER TABLE user_model_permissions ADD COLUMN IF NOT EXISTS daily_cost_limit NUMERIC(12,4) DEFAULT 0",
            "ALTER TABLE user_model_permissions ADD COLUMN IF NOT EXISTS daily_image_limit INT DEFAULT 0",
            "ALTER TABLE user_model_permissions ADD COLUMN IF NOT EXISTS used_today_tokens INT DEFAULT 0",
            "ALTER TABLE user_model_permissions ADD COLUMN IF NOT EXISTS used_today_cost NUMERIC(12,4) DEFAULT 0",
            "ALTER TABLE user_model_permissions ADD COLUMN IF NOT EXISTS used_today_images INT DEFAULT 0",
            "ALTER TABLE user_model_permissions ADD COLUMN IF NOT EXISTS usage_reset_date DATE",
        ]:
            await connection.execute(text(ddl))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    log_startup_config()
    await ensure_runtime_schema()
    from app.services.model_permission_service import sync_all_users_model_permissions

    async with SessionLocal() as db:
        inserted = await sync_all_users_model_permissions(db)
        if inserted:
            print(f"[startup] granted {inserted} default model permissions")
    yield


app = FastAPI(
    title="AI Image Workbench API",
    description="AI 社媒图片生产工作台后端接口",
    version=API_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3010",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(StaticCacheMiddleware)

app.mount(
    "/static",
    StaticFiles(directory=ensure_static_storage_directory()),
    name="static",
)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ai-image-workbench-backend",
        "version": API_VERSION,
    }


def include_api_router(api_app: FastAPI, router: APIRouter) -> None:
    route_paths = [route.path for route in router.routes if isinstance(route, APIRoute)]
    already_prefixed = route_paths and all(path.startswith(f"{API_PREFIX}/") for path in route_paths)
    if already_prefixed:
        api_app.include_router(router)
    else:
        api_app.include_router(router, prefix=API_PREFIX)


for module in (
    auth,
    users,
    user_model_api_keys,
    model_configs,
    permissions,
    instructions,
    tasks,
    prompts,
    assets,
    generate,
    review,
    gallery,
    translate,
    stats,
    audit,
    identity_conflicts,
    workflow_sessions,
    system,
):
    include_api_router(app, module.router)

app.include_router(activity_workflows.router, prefix=f"{API_PREFIX}/activity")
app.include_router(activity_batches.router, prefix=f"{API_PREFIX}/activity/batches")
app.include_router(daily_post_workflows.router, prefix=f"{API_PREFIX}/daily-post")
app.include_router(hotspot_import.router, prefix=f"{API_PREFIX}/hotspot", tags=["hotspot"])
app.include_router(trending_workflows.router, prefix="/api/trending", tags=["trending"])
app.include_router(background.router, prefix=f"{API_PREFIX}/background")
app.include_router(multi_fusion.router, prefix=f"{API_PREFIX}/multi-fusion")
app.include_router(logo_router)
app.include_router(share_router)
app.include_router(video_jobs.router)
app.include_router(video_draft.router)
app.include_router(video_first_frame.router)
app.include_router(video_motion.router)
app.include_router(video_workflows.router)
