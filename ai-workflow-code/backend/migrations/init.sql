-- AI 社媒图片生产工作台 — PostgreSQL 初始化建表
-- 执行方式: psql -U user -d ai_workbench -f backend/migrations/init.sql

-- 用户与权限

CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    platform_user_id VARCHAR(191) UNIQUE,
    email         VARCHAR(255),
    display_name  VARCHAR(120),
    auth_source   VARCHAR(20) DEFAULT 'local',
    last_sso_at   TIMESTAMP,
    role_sync_strategy VARCHAR(40) DEFAULT 'platform_authoritative',
    role_sync_locked BOOLEAN DEFAULT FALSE,
    role_last_source VARCHAR(40),
    role_last_synced_at TIMESTAMP,
    password_hash TEXT NOT NULL,
    role          VARCHAR(20) DEFAULT 'operator',
    status        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(email))
    WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_keys (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE SET NULL,
    provider     VARCHAR(50) NOT NULL,
    api_key      TEXT NOT NULL,
    daily_limit  NUMERIC(12,2) DEFAULT 0,
    used_today   NUMERIC(12,4) DEFAULT 0,
    active       BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMP DEFAULT NOW()
);

-- 任务

CREATE TABLE IF NOT EXISTS tasks (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(255) NOT NULL,
    scene        VARCHAR(100),
    size         VARCHAR(50),
    purpose      VARCHAR(100),
    budget       NUMERIC(12,2) DEFAULT 0,
    description  TEXT,
    status       VARCHAR(30) DEFAULT 'created',
    creator_id   INT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_sessions (
    id              SERIAL PRIMARY KEY,
    workflow_type   VARCHAR(50) NOT NULL,
    mode            VARCHAR(20) NOT NULL,
    status          VARCHAR(20) DEFAULT 'draft',
    current_step    INT DEFAULT 1,
    state_json      TEXT,
    task_id         INT REFERENCES tasks(id) ON DELETE SET NULL,
    created_by      INT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- Prompt 模板

CREATE TABLE IF NOT EXISTS prompt_templates (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    mode         VARCHAR(20) NOT NULL,
    content      TEXT NOT NULL,
    active       BOOLEAN DEFAULT TRUE,
    created_by   INT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);

-- 素材库

CREATE TABLE IF NOT EXISTS assets (
    id           SERIAL PRIMARY KEY,
    filename     VARCHAR(255) NOT NULL,
    category     VARCHAR(50) DEFAULT 'bull_reference',
    tags         TEXT,
    url          TEXT NOT NULL,
    use_count    INT DEFAULT 0,
    uploaded_by  INT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP DEFAULT NOW()
);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS use_count INT DEFAULT 0;

-- 任务图片、成品图与生成日志

CREATE TABLE IF NOT EXISTS task_images (
    id             SERIAL PRIMARY KEY,
    task_id        INT REFERENCES tasks(id) ON DELETE CASCADE,
    image_url      TEXT NOT NULL,
    type           VARCHAR(20) DEFAULT 'draft',
    model_provider VARCHAR(50),
    model_name     VARCHAR(100),
    prompt_used    TEXT,
    token_used     INT DEFAULT 0,
    cost           NUMERIC(12,4) DEFAULT 0,
    created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS final_images (
    id            SERIAL PRIMARY KEY,
    task_image_id INT REFERENCES task_images(id) ON DELETE SET NULL,
    task_id       INT REFERENCES tasks(id) ON DELETE SET NULL,
    image_url     TEXT NOT NULL,
    prompt_used   TEXT,
    tags          TEXT,
    created_by    INT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMP DEFAULT NOW()
);

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
    status         VARCHAR(20) DEFAULT 'success',
    created_at     TIMESTAMP DEFAULT NOW()
);

-- 审核记录

CREATE TABLE IF NOT EXISTS review_logs (
    id          SERIAL PRIMARY KEY,
    image_id    INT REFERENCES task_images(id) ON DELETE CASCADE,
    reviewer_id INT REFERENCES users(id) ON DELETE SET NULL,
    score       INT CHECK (score >= 0 AND score <= 100),
    status      VARCHAR(20) NOT NULL,
    reason      TEXT,
    tags        TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 投放数据与统计

CREATE TABLE IF NOT EXISTS publish_stats (
    id           SERIAL PRIMARY KEY,
    image_id     INT REFERENCES task_images(id) ON DELETE SET NULL,
    final_image_id INT REFERENCES final_images(id) ON DELETE SET NULL,
    publish_date DATE NOT NULL,
    channel      VARCHAR(50),
    likes        INT DEFAULT 0,
    comments     INT DEFAULT 0,
    shares       INT DEFAULT 0,
    notes        TEXT,
    created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_cost_stats (
    id             SERIAL PRIMARY KEY,
    stat_date      DATE NOT NULL,
    user_id        INT REFERENCES users(id) ON DELETE SET NULL,
    model_provider VARCHAR(50),
    total_tokens   INT DEFAULT 0,
    total_cost     NUMERIC(12,4) DEFAULT 0,
    image_count    INT DEFAULT 0,
    UNIQUE (stat_date, user_id, model_provider)
);

-- 审计日志

CREATE TABLE IF NOT EXISTS audit_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id) ON DELETE SET NULL,
    action     VARCHAR(100) NOT NULL,
    detail     TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
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

-- 初始数据

INSERT INTO roles (name, description)
VALUES
    ('admin', '全部权限，含用户管理、API Key 管理'),
    ('operator', '创建任务、出图、下载'),
    ('reviewer', '审核图片、打分、驳回'),
    ('viewer', '只读查看成品图库')
ON CONFLICT (name) DO NOTHING;

INSERT INTO users (username, password_hash, role)
VALUES ('admin', '$2b$12$nZc2Cqh4k0jvM64ifmaU4uSLqC5ELU2mE6DULweOFvugdShKYYMWG', 'admin')
ON CONFLICT (username) DO NOTHING;

CREATE TABLE IF NOT EXISTS model_configs (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    provider        VARCHAR(50) NOT NULL,
    model_name      VARCHAR(100) NOT NULL,
    api_key         TEXT NOT NULL,
    base_url        VARCHAR(255),
    usage_type      VARCHAR(20) DEFAULT 'both',
    price_per_image NUMERIC(12,6) DEFAULT 0,
    daily_limit     NUMERIC(12,2) DEFAULT 0,
    used_today      NUMERIC(12,4) DEFAULT 0,
    active          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS usage_type VARCHAR(20) DEFAULT 'both';

CREATE TABLE IF NOT EXISTS user_model_permissions (
    id              SERIAL PRIMARY KEY,
    user_id         INT REFERENCES users(id) ON DELETE CASCADE,
    model_config_id INT REFERENCES model_configs(id) ON DELETE CASCADE,
    granted_by      INT REFERENCES users(id) ON DELETE SET NULL,
    daily_token_limit INT DEFAULT 0,
    daily_cost_limit NUMERIC(12,4) DEFAULT 0,
    daily_image_limit INT DEFAULT 0,
    used_today_tokens INT DEFAULT 0,
    used_today_cost NUMERIC(12,4) DEFAULT 0,
    used_today_images INT DEFAULT 0,
    usage_reset_date DATE,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, model_config_id)
);

CREATE TABLE IF NOT EXISTS user_model_api_keys (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_config_id INT NOT NULL REFERENCES model_configs(id) ON DELETE CASCADE,
    api_key         TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, model_config_id)
);

CREATE TABLE IF NOT EXISTS asset_tags (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(50) NOT NULL,
    category   VARCHAR(50) DEFAULT 'general' NOT NULL,
    tag_group  VARCHAR(50) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (category, name)
);

ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS tag_group VARCHAR(50) DEFAULT NULL;

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

CREATE TABLE IF NOT EXISTS asset_tag_relations (
    asset_id INT REFERENCES assets(id) ON DELETE CASCADE,
    tag_id   INT REFERENCES asset_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);

CREATE TABLE IF NOT EXISTS workflow_types (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    active      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instructions (
    id               SERIAL PRIMARY KEY,
    workflow_type_id INT REFERENCES workflow_types(id) ON DELETE CASCADE,
    name             VARCHAR(100) NOT NULL,
    content          TEXT NOT NULL,
    tags             VARCHAR(255),
    active           BOOLEAN DEFAULT TRUE,
    created_by       INT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW()
);

INSERT INTO workflow_types (name, slug, description)
VALUES ('表情制作', 'expression', '牛角色表情图片生产工作流')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS activity_template_types (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    code       VARCHAR(50) UNIQUE NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO activity_template_types (name, code, sort_order)
VALUES
    ('回访召回', 'revisit', 1),
    ('充值激励', 'recharge', 2),
    ('登录奖励', 'login', 3),
    ('限时活动', 'limited', 4),
    ('排行榜竞技', 'ranking', 5)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS activity_templates (
    id               SERIAL PRIMARY KEY,
    template_no      VARCHAR(3) UNIQUE NOT NULL,
    name             VARCHAR(255) NOT NULL,
    type_id          INT NOT NULL REFERENCES activity_template_types(id),
    structure_layer1 TEXT NOT NULL,
    structure_layer2 TEXT NOT NULL,
    structure_layer3 TEXT NOT NULL,
    prompt_template  TEXT NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_by       INT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (template_no ~ '^T(0[1-9]|1[0-9]|2[0-5])$')
);

CREATE TABLE IF NOT EXISTS activity_variable_presets (
    id         SERIAL PRIMARY KEY,
    var_type   VARCHAR(20) NOT NULL,
    value      VARCHAR(100) NOT NULL,
    label      VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    CHECK (var_type IN ('reward_amount', 'bonus_type', 'element'))
);

INSERT INTO activity_variable_presets (var_type, value, label, sort_order)
VALUES
    ('reward_amount', '1000', '1000', 1),
    ('reward_amount', '5000', '5000', 2),
    ('reward_amount', '20000', '20000', 3),
    ('bonus_type', 'coins', 'coins', 1),
    ('bonus_type', 'bonus', 'bonus', 2),
    ('bonus_type', 'gift', 'gift', 3),
    ('element', 'coins', 'coins', 1),
    ('element', 'gift_box', 'gift_box', 2),
    ('element', 'glow_light', 'glow_light', 3),
    ('element', 'sparkles', 'sparkles', 4),
    ('element', 'button', 'button', 5);

CREATE TABLE IF NOT EXISTS activity_generation_jobs (
    id              SERIAL PRIMARY KEY,
    template_id     INT REFERENCES activity_templates(id) ON DELETE SET NULL,
    task_id         INT REFERENCES tasks(id) ON DELETE SET NULL,
    operator_id     INT REFERENCES users(id) ON DELETE SET NULL,
    variables_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
    prompt_rendered TEXT NOT NULL,
    model_config_id INT REFERENCES model_configs(id) ON DELETE SET NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    qc_result       JSONB,
    reject_reason   TEXT,
    image_url       TEXT,
    cost_usd        NUMERIC(12,4) DEFAULT 0,
    token_used      INT DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE activity_templates
    ADD COLUMN IF NOT EXISTS usage_scenario TEXT,
    ADD COLUMN IF NOT EXISTS bg_description TEXT,
    ADD COLUMN IF NOT EXISTS forbidden_rules TEXT,
    ADD COLUMN IF NOT EXISTS rule_character TEXT,
    ADD COLUMN IF NOT EXISTS rule_scene TEXT,
    ADD COLUMN IF NOT EXISTS rule_visual TEXT,
    ADD COLUMN IF NOT EXISTS rule_copy TEXT,
    ADD COLUMN IF NOT EXISTS rule_button TEXT,
    ADD COLUMN IF NOT EXISTS rule_quality TEXT,
    ADD COLUMN IF NOT EXISTS rule_forbidden TEXT;

CREATE TABLE IF NOT EXISTS activity_field_definitions (
    id           SERIAL PRIMARY KEY,
    template_id  INT REFERENCES activity_templates(id) ON DELETE CASCADE,
    field_key    VARCHAR(50) NOT NULL,
    field_name   VARCHAR(100) NOT NULL,
    field_type   VARCHAR(20) NOT NULL,
    is_required  BOOLEAN DEFAULT TRUE,
    default_value TEXT,
    hint         TEXT,
    options_json JSONB,
    sort_order   INT DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE activity_templates
    ADD COLUMN IF NOT EXISTS style_guide TEXT;

ALTER TABLE activity_templates
    ADD COLUMN IF NOT EXISTS style_tag VARCHAR(50);

ALTER TABLE final_images
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) DEFAULT 'expression',
    ADD COLUMN IF NOT EXISTS sub_category VARCHAR(50),
    ADD COLUMN IF NOT EXISTS style_tag VARCHAR(50);

CREATE TABLE IF NOT EXISTS gallery_tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    image_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (source_type, name)
);

CREATE TABLE IF NOT EXISTS activity_generation_batches (
    id SERIAL PRIMARY KEY,
    template_id INT REFERENCES activity_templates(id),
    task_id INT REFERENCES tasks(id),
    operator_id INT REFERENCES users(id),
    variables_json JSONB,
    global_extra_prompt TEXT,
    model_config_id INT REFERENCES model_configs(id),
    ad_size VARCHAR(20) DEFAULT '1080x1080',
    status VARCHAR(20) DEFAULT 'draft',
    max_images INT DEFAULT 8,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_batch_images (
    id SERIAL PRIMARY KEY,
    batch_id INT REFERENCES activity_generation_batches(id) ON DELETE CASCADE,
    job_id INT REFERENCES activity_generation_jobs(id),
    image_url TEXT,
    extra_prompt TEXT,
    refine_prompt TEXT,
    parent_image_id INT REFERENCES activity_batch_images(id),
    prompt_rendered TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    cost_usd NUMERIC(10,6) DEFAULT 0,
    token_used INT DEFAULT 0,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS background_generation_batches (
    id                  SERIAL PRIMARY KEY,
    created_at          TIMESTAMP DEFAULT NOW(),
    created_by          INT REFERENCES users(id) ON DELETE SET NULL,
    purpose             VARCHAR(100) NOT NULL,
    scene               VARCHAR(100) NOT NULL,
    mood                TEXT[] DEFAULT ARRAY[]::TEXT[],
    color_style         VARCHAR(100) NOT NULL,
    whitespace_position VARCHAR(50) NOT NULL,
    whitespace_positions TEXT[] DEFAULT ARRAY['right']::TEXT[],
    size_ratio          VARCHAR(20) NOT NULL,
    localized           BOOLEAN DEFAULT FALSE,
    game_feel           VARCHAR(20) DEFAULT 'medium',
    count               INT DEFAULT 4,
    extra_prompt        TEXT DEFAULT NULL,
    status              VARCHAR(20) DEFAULT 'draft',
    session_id          INT REFERENCES workflow_sessions(id) ON DELETE SET NULL,
    model_config_id     INT REFERENCES model_configs(id) ON DELETE SET NULL
);

ALTER TABLE background_generation_batches
  ADD COLUMN IF NOT EXISTS extra_prompt TEXT DEFAULT NULL;

ALTER TABLE background_generation_batches
  ADD COLUMN IF NOT EXISTS whitespace_positions TEXT[] DEFAULT ARRAY['right']::TEXT[];

UPDATE background_generation_batches
SET whitespace_positions = ARRAY[COALESCE(whitespace_position, 'right')]::TEXT[]
WHERE whitespace_positions IS NULL OR array_length(whitespace_positions, 1) IS NULL;

CREATE TABLE IF NOT EXISTS background_images (
    id              SERIAL PRIMARY KEY,
    batch_id        INT REFERENCES background_generation_batches(id) ON DELETE CASCADE,
    asset_id        INT REFERENCES assets(id) ON DELETE SET NULL,
    created_at      TIMESTAMP DEFAULT NOW(),
    image_url       TEXT,
    thumbnail_url   TEXT,
    review_status   VARCHAR(20) DEFAULT 'pending',
    is_recommended  BOOLEAN DEFAULT FALSE,
    tags            JSONB,
    use_count       INT DEFAULT 0
);

ALTER TABLE activity_generation_batches
  ADD COLUMN IF NOT EXISTS session_id INT REFERENCES workflow_sessions(id);

-- ===== 日常互动图工作流（补录到 init.sql）=====
CREATE TABLE IF NOT EXISTS daily_post_templates (
    id                SERIAL PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    template_type     VARCHAR(50) NOT NULL,
    title_copy        TEXT,
    interaction_copy  TEXT,
    option_a          TEXT,
    option_b          TEXT,
    option_c          TEXT,
    bull_action       VARCHAR(50),
    background        VARCHAR(50),
    style             VARCHAR(50),
    color_mood        VARCHAR(50),
    brand_weight      VARCHAR(50),
    is_enabled        BOOLEAN DEFAULT TRUE,
    sort_order        INT DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_post_bull_actions (
    id                SERIAL PRIMARY KEY,
    value             VARCHAR(50) NOT NULL UNIQUE,
    label_zh          VARCHAR(50) NOT NULL,
    is_preset         BOOLEAN DEFAULT TRUE,
    is_enabled        BOOLEAN DEFAULT TRUE,
    sort_order        INT DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_post_backgrounds (
    id                SERIAL PRIMARY KEY,
    value             VARCHAR(50) NOT NULL UNIQUE,
    label_zh          VARCHAR(50) NOT NULL,
    is_preset         BOOLEAN DEFAULT TRUE,
    is_enabled        BOOLEAN DEFAULT TRUE,
    sort_order        INT DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_post_color_moods (
    id                SERIAL PRIMARY KEY,
    value             VARCHAR(50) NOT NULL UNIQUE,
    label_zh          VARCHAR(50) NOT NULL,
    is_preset         BOOLEAN DEFAULT TRUE,
    is_enabled        BOOLEAN DEFAULT TRUE,
    sort_order        INT DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_post_jobs (
    id                  SERIAL PRIMARY KEY,
    template_id         INT REFERENCES daily_post_templates(id) ON DELETE SET NULL,
    task_id             INT REFERENCES tasks(id) ON DELETE SET NULL,
    session_id          INT REFERENCES workflow_sessions(id) ON DELETE SET NULL,
    today_theme         TEXT NOT NULL,
    user_emotion        TEXT NOT NULL,
    main_copy           TEXT NOT NULL,
    interaction_question TEXT NOT NULL,
    option_a_override   TEXT,
    option_b_override   TEXT,
    option_c_override   TEXT,
    aux_copy            TEXT,
    bull_action_override VARCHAR(50),
    background_override VARCHAR(50),
    image_language      VARCHAR(20) NOT NULL DEFAULT 'english',
    model_config_id     INT REFERENCES model_configs(id) ON DELETE SET NULL,
    status              VARCHAR(20) DEFAULT 'draft',
    generated_image_url TEXT,
    archived_asset_id   INT REFERENCES assets(id) ON DELETE SET NULL,
    cost_usd            NUMERIC(10,6),
    created_by          INT REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 热点借势工作流 =====
CREATE TABLE IF NOT EXISTS trending_topic_type_config (
    id              SERIAL PRIMARY KEY,
    topic_type      VARCHAR(50) UNIQUE NOT NULL,
    name_zh         VARCHAR(100) NOT NULL,
    risk_level      VARCHAR(10) NOT NULL,
    allow_game_integration BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_angles  JSONB NOT NULL DEFAULT '[]',
    allowed_image_types JSONB NOT NULL DEFAULT '[]',
    allowed_actions JSONB NOT NULL DEFAULT '[]',
    copy_style      VARCHAR(30) NOT NULL,
    notes           TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trending_jobs (
    id              SERIAL PRIMARY KEY,
    session_id      INTEGER REFERENCES workflow_sessions(id) ON DELETE SET NULL,
    task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    news_title      TEXT NOT NULL,
    publish_time    TIMESTAMPTZ,
    topic_type      VARCHAR(50) NOT NULL,
    risk_level      VARCHAR(10) NOT NULL,
    allow_game_integration BOOLEAN NOT NULL DEFAULT FALSE,
    selected_angle  VARCHAR(50),
    selected_image_type VARCHAR(50),
    selected_action VARCHAR(100),
    copy_text       TEXT,
    ad_size         VARCHAR(20) DEFAULT '1080x1080',
    image_language  VARCHAR(20) DEFAULT 'english',
    draft_image_url     TEXT,
    final_image_url     TEXT,
    refined_image_url   TEXT,
    status          VARCHAR(20) DEFAULT 'draft',
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO trending_topic_type_config
    (topic_type, name_zh, risk_level, allow_game_integration,
     allowed_angles, allowed_image_types, allowed_actions, copy_style, notes)
VALUES
    ('BREAKING_NEWS','突发新闻','HIGH',FALSE,
     '["REACTION_ONLY"]','["REACTION"]','["吃瓜","震惊","无语"]','NEUTRAL','严禁娱乐化'),
    ('SPORTS_EVENT','体育赛事','LOW',TRUE,
     '["STANCE","RESULT","LIGHT_GAME"]','["REACTION","VS","SCENE"]',
     '["欢呼","崩溃","看比赛","紧张"]','HYPE','强互动场景'),
    ('ENTERTAINMENT','娱乐热点','LOW',FALSE,
     '["REACTION"]','["REACTION"]','["吃瓜","震惊","偷笑"]','GOSSIP','以吃瓜为主'),
    ('SOCIAL_TOPIC','社会议题','MEDIUM',FALSE,
     '["DISCUSSION"]','["REACTION"]','["思考","无语","困惑"]','DISCUSS','引导评论'),
    ('HOLIDAY_EVENT','节日事件','LOW',TRUE,
     '["REACTION","LIGHT_GAME"]','["REACTION","SCENE"]',
     '["开心","庆祝","邀请"]','FESTIVE','可轻转化')
ON CONFLICT (topic_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS share_game_instructions (
    id SERIAL PRIMARY KEY,
    game_type VARCHAR(50) NOT NULL,
    label VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO share_game_instructions (game_type, label, content, sort_order) VALUES
('Tongits', '扑克牌桌氛围', 'Include playing cards (poker-style), card table with green felt, card hands showing Tongits combinations. Cards should be visually prominent.', 1),
('Tongits', '仅游戏名称', 'Include Tongits branding and logo style elements only.', 2),
('Tongits', '赢牌瞬间', 'Show a winning card combination moment, cards spread on table, winning hand visible.', 3),
('Pusoy', '扑克牌桌氛围', 'Include playing cards, poker chips, card table. Cards and chips should feel central to the scene.', 1),
('Pusoy', '仅游戏名称', 'Include Pusoy branding and logo style elements only.', 2),
('Pusoy', '赢牌瞬间', 'Show a winning poker combination, cards spread out, triumphant moment.', 3)
ON CONFLICT DO NOTHING;

-- ===== 转发图工作流 =====
CREATE TABLE IF NOT EXISTS share_bull_actions (
    id          SERIAL PRIMARY KEY,
    value       VARCHAR(50) UNIQUE NOT NULL,
    label_zh    VARCHAR(50) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_backgrounds (
    id          SERIAL PRIMARY KEY,
    value       VARCHAR(50) UNIQUE NOT NULL,
    label_zh    VARCHAR(50) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_color_moods (
    id          SERIAL PRIMARY KEY,
    value       VARCHAR(50) UNIQUE NOT NULL,
    label_zh    VARCHAR(50) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_jobs (
    id                  SERIAL PRIMARY KEY,
    session_id          INTEGER REFERENCES workflow_sessions(id) ON DELETE SET NULL,
    share_type          VARCHAR(20) NOT NULL,
    core_text           TEXT NOT NULL,
    target_audience     TEXT,
    game_type           VARCHAR(50) DEFAULT 'Tongits',
    image_language      VARCHAR(20) DEFAULT 'english',
    model_config_id     INTEGER REFERENCES model_configs(id) ON DELETE SET NULL,
    size                VARCHAR(20) DEFAULT '1080x1080',
    status              VARCHAR(20) DEFAULT 'pending',
    generated_image_url TEXT,
    refine_prompt       TEXT,
    created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 热点新闻推送工作流 =====
CREATE TABLE IF NOT EXISTS trending_news_tasks (
    id              SERIAL PRIMARY KEY,
    task_id         VARCHAR(100) UNIQUE NOT NULL,
    title           TEXT NOT NULL,
    publish_time    TIMESTAMPTZ,
    topic_type      VARCHAR(50) NOT NULL,
    event_summary   TEXT,
    main_entities   JSONB DEFAULT '[]',
    event_action    TEXT,
    event_result    TEXT,
    emotion_direction VARCHAR(20),
    risk_tags       JSONB DEFAULT '["NONE"]',
    local_relevance TEXT,
    source_name     VARCHAR(200),
    source_url      TEXT,
    risk_level      VARCHAR(10),
    allow_game_integration BOOLEAN DEFAULT FALSE,
    import_status   VARCHAR(20) DEFAULT 'NEW',
    process_status  VARCHAR(20) DEFAULT 'PENDING',
    image_status    VARCHAR(20) DEFAULT 'NOT_GENERATED',
    trending_job_id INTEGER REFERENCES trending_jobs(id) ON DELETE SET NULL,
    imported_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    imported_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO trending_topic_type_config
    (topic_type, name_zh, risk_level, allow_game_integration,
     allowed_angles, allowed_image_types, allowed_actions, copy_style, notes)
VALUES
    ('POLITICS_GOVERNMENT','政治政府','HIGH',FALSE,
     '["REACTION_ONLY"]','["REACTION"]','["吃瓜","无语","困惑"]',
     'NEUTRAL','严禁立场表达'),
    ('CRIME_ACCIDENT','犯罪事故','HIGH',FALSE,
     '["REACTION_ONLY"]','["REACTION"]','["震惊","无语","困惑"]',
     'NEUTRAL','严禁娱乐化'),
    ('DISASTER_EMERGENCY','灾难紧急','HIGH',FALSE,
     '["REACTION_ONLY"]','["REACTION"]','["震惊","无语"]',
     'NEUTRAL','严禁娱乐化，严禁游戏'),
    ('ECONOMY_BUSINESS','经济商业','MEDIUM',FALSE,
     '["REACTION","DISCUSSION"]','["REACTION"]','["思考","困惑","无语"]',
     'DISCUSS','引导讨论'),
    ('TECH_GAMING','科技游戏','LOW',TRUE,
     '["REACTION","LIGHT_GAME"]','["REACTION","SCENE"]','["欢呼","震惊","开心"]',
     'HYPE','可轻游戏带入'),
    ('PUBLIC_FIGURE','公众人物','MEDIUM',FALSE,
     '["REACTION","DISCUSSION"]','["REACTION"]','["吃瓜","震惊","思考"]',
     'GOSSIP','谨慎处理'),
    ('VIRAL_TREND','病毒传播趋势','LOW',FALSE,
     '["REACTION","DISCUSSION"]','["REACTION","SCENE"]','["欢呼","偷笑","开心"]',
     'GOSSIP','轻松互动')
ON CONFLICT (topic_type) DO NOTHING;

-- ============================================================
-- VIDEO WORKFLOW TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS video_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id INTEGER REFERENCES workflow_sessions(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    -- status: draft | step1_done | step2_done | step3_done | step4_done | step5_done | post_processing | completed | archived
    current_step INTEGER NOT NULL DEFAULT 1,
    first_frame_asset_id UUID,
    first_frame_url TEXT,
    first_frame_source_type VARCHAR(32),
    -- source_type: gallery | asset | frame | upload
    first_frame_status VARCHAR(32) DEFAULT 'empty',
    -- first_frame_status: empty | selecting | uploading | awaiting_make | selected
    motion_preset_id UUID,
    video_language VARCHAR(16) DEFAULT 'english',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_motion_data (
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
);

CREATE TABLE IF NOT EXISTS video_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_job_id UUID NOT NULL REFERENCES video_jobs(id) ON DELETE CASCADE,
    model VARCHAR(64) DEFAULT 'kling_v2.6',
    video_url TEXT,
    thumbnail_url TEXT,
    duration_seconds NUMERIC(5,2),
    status VARCHAR(32) DEFAULT 'pending',
    -- status: pending | generating | done | selected | rejected
    selected BOOLEAN DEFAULT FALSE,
    generation_cost NUMERIC(10,4) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
