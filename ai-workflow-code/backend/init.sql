-- AI 社媒图片生产工作台 — PostgreSQL 初始化建表
-- 执行方式: psql -U user -d ai_workbench -f init.sql

-- ─────────────────────────────────────────
-- 用户与权限
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id           SERIAL PRIMARY KEY,
    username     VARCHAR(50) UNIQUE NOT NULL,
    platform_user_id VARCHAR(191) UNIQUE,
    email        VARCHAR(255),
    display_name VARCHAR(120),
    auth_source  VARCHAR(20) DEFAULT 'local',
    last_sso_at  TIMESTAMP,
    role_sync_strategy VARCHAR(40) DEFAULT 'platform_authoritative',
    role_sync_locked BOOLEAN DEFAULT FALSE,
    role_last_source VARCHAR(40),
    role_last_synced_at TIMESTAMP,
    password_hash TEXT NOT NULL,
    role         VARCHAR(20) DEFAULT 'operator',  -- admin | operator | reviewer | viewer
    status       BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(email))
    WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_keys (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE SET NULL,
    provider     VARCHAR(50) NOT NULL,             -- openai | google | midjourney
    api_key      TEXT NOT NULL,
    daily_limit  NUMERIC(12,2) DEFAULT 0,          -- USD，0=不限制
    used_today   NUMERIC(12,4) DEFAULT 0,
    active       BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 任务
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(255) NOT NULL,
    scene        VARCHAR(100),                     -- Tongits | Pusoy | Payday | Holiday
    size         VARCHAR(50),                      -- 1080x1350 | 1080x1920 | 1200x628 | 1080x1080
    purpose      VARCHAR(100),
    budget       NUMERIC(12,2) DEFAULT 0,
    description  TEXT,
    -- created | exploring | selecting | finalizing | reviewing | done | published | closed
    status       VARCHAR(30) DEFAULT 'created',
    creator_id   INT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- Prompt 模板
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prompt_templates (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    mode         VARCHAR(20) NOT NULL,             -- draft | final
    content      TEXT NOT NULL,
    active       BOOLEAN DEFAULT TRUE,
    created_by   INT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 素材库
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS assets (
    id           SERIAL PRIMARY KEY,
    filename     VARCHAR(255) NOT NULL,
    -- bull_reference | expression | action | background | props
    category     VARCHAR(50) DEFAULT 'bull_reference',
    tags         TEXT,                             -- 逗号分隔
    url          TEXT NOT NULL,
    uploaded_by  INT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 任务图片（草图与定稿）
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_images (
    id           SERIAL PRIMARY KEY,
    task_id      INT REFERENCES tasks(id) ON DELETE CASCADE,
    image_url    TEXT NOT NULL,
    type         VARCHAR(20) DEFAULT 'draft',      -- draft | final
    model_provider VARCHAR(50),
    model_name   VARCHAR(100),
    prompt_used  TEXT,
    token_used   INT DEFAULT 0,
    cost         NUMERIC(12,4) DEFAULT 0,          -- USD
    created_at   TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 审核记录
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS review_logs (
    id           SERIAL PRIMARY KEY,
    image_id     INT REFERENCES task_images(id) ON DELETE CASCADE,
    reviewer_id  INT REFERENCES users(id) ON DELETE SET NULL,
    score        INT CHECK (score >= 0 AND score <= 100),
    status       VARCHAR(20) NOT NULL,             -- pass | reject
    reason       TEXT,
    tags         TEXT,                             -- 问题标签，逗号分隔
    created_at   TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 生成日志（每次 AI 调用记录）
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS generation_logs (
    id             SERIAL PRIMARY KEY,
    task_id        INT REFERENCES tasks(id) ON DELETE SET NULL,
    operator_id    INT REFERENCES users(id) ON DELETE SET NULL,
    model_provider VARCHAR(50),
    model_name     VARCHAR(100),
    prompt         TEXT,
    image_count    INT DEFAULT 1,
    token_used     INT DEFAULT 0,
    cost_usd       NUMERIC(12,4) DEFAULT 0,
    status         VARCHAR(20) DEFAULT 'success',  -- success | failed | retry
    created_at     TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 投放数据
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS publish_stats (
    id           SERIAL PRIMARY KEY,
    image_id     INT REFERENCES task_images(id) ON DELETE SET NULL,
    publish_date DATE NOT NULL,
    channel      VARCHAR(50),                      -- facebook | tiktok | instagram
    likes        INT DEFAULT 0,
    comments     INT DEFAULT 0,
    shares       INT DEFAULT 0,
    notes        TEXT,
    created_at   TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 每日成本汇总（聚合表，由定时任务写入）
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_cost_stats (
    id           SERIAL PRIMARY KEY,
    stat_date    DATE NOT NULL,
    user_id      INT REFERENCES users(id) ON DELETE SET NULL,
    model_provider VARCHAR(50),
    total_tokens INT DEFAULT 0,
    total_cost   NUMERIC(12,4) DEFAULT 0,
    image_count  INT DEFAULT 0,
    UNIQUE (stat_date, user_id, model_provider)
);

-- ─────────────────────────────────────────
-- 审计日志
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE SET NULL,
    action       VARCHAR(100) NOT NULL,
    detail       TEXT,
    ip_address   VARCHAR(50),
    created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity_conflict_tickets (
    id               SERIAL PRIMARY KEY,
    status           VARCHAR(20) NOT NULL DEFAULT 'open',
    conflict_key     VARCHAR(191) NOT NULL UNIQUE,
    conflict_reason  VARCHAR(64) NOT NULL,
    platform_user_id VARCHAR(191),
    email            VARCHAR(255),
    lookup_username  VARCHAR(50),
    candidate_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    conflict_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    detail           TEXT,
    occur_count      INT NOT NULL DEFAULT 1,
    last_seen_at     TIMESTAMP DEFAULT NOW(),
    resolved_by      INT REFERENCES users(id) ON DELETE SET NULL,
    rebind_to_user_id INT REFERENCES users(id) ON DELETE SET NULL,
    resolution_note  TEXT,
    resolved_at      TIMESTAMP,
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_conflict_status_updated
    ON identity_conflict_tickets(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_conflict_platform_user_id
    ON identity_conflict_tickets(platform_user_id);

-- ─────────────────────────────────────────
-- 初始数据：默认管理员账号
-- 默认密码 admin123，上线前必须修改
-- ─────────────────────────────────────────

INSERT INTO users (username, password_hash, role)
VALUES ('admin', '$2b$12$placeholder_hash_change_before_production', 'admin')
ON CONFLICT (username) DO NOTHING;
