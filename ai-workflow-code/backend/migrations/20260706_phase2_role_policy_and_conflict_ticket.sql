-- Phase 2 (Step 2): 角色策略收口 + 冲突工单流落库
-- 非破坏性变更：仅新增字段/表，不删除历史字段。

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_sync_strategy VARCHAR(40) DEFAULT 'platform_authoritative';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_sync_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_last_source VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_last_synced_at TIMESTAMP;

-- 默认策略：
-- - 现有 admin：preserve_workbench_admin（避免被平台 USER 误降级）
-- - 其他用户：platform_authoritative（平台角色单向覆盖）
UPDATE users
SET role_sync_strategy = CASE
    WHEN role = 'admin' THEN 'preserve_workbench_admin'
    ELSE 'platform_authoritative'
END
WHERE role_sync_strategy IS NULL OR role_sync_strategy = '';

UPDATE users
SET role_sync_locked = FALSE
WHERE role_sync_locked IS NULL;

UPDATE users
SET role_sync_strategy = 'preserve_workbench_admin'
WHERE role = 'admin'
  AND COALESCE(role_sync_locked, FALSE) = FALSE
  AND role_sync_strategy = 'platform_authoritative';

CREATE TABLE IF NOT EXISTS identity_conflict_tickets (
    id                 SERIAL PRIMARY KEY,
    status             VARCHAR(20) NOT NULL DEFAULT 'open',
    conflict_key       VARCHAR(191) NOT NULL UNIQUE,
    conflict_reason    VARCHAR(64) NOT NULL,
    platform_user_id   VARCHAR(191),
    email              VARCHAR(255),
    lookup_username    VARCHAR(50),
    candidate_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    conflict_payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
    detail             TEXT,
    occur_count        INT NOT NULL DEFAULT 1,
    last_seen_at       TIMESTAMP DEFAULT NOW(),
    resolved_by        INT REFERENCES users(id) ON DELETE SET NULL,
    rebind_to_user_id  INT REFERENCES users(id) ON DELETE SET NULL,
    resolution_note    TEXT,
    resolved_at        TIMESTAMP,
    created_at         TIMESTAMP DEFAULT NOW(),
    updated_at         TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_conflict_status_updated
    ON identity_conflict_tickets(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_identity_conflict_platform_user_id
    ON identity_conflict_tickets(platform_user_id);

COMMIT;

-- 回滚点（仅确认未使用后执行）：
-- DROP INDEX IF EXISTS idx_identity_conflict_platform_user_id;
-- DROP INDEX IF EXISTS idx_identity_conflict_status_updated;
-- DROP TABLE IF EXISTS identity_conflict_tickets;
-- ALTER TABLE users DROP COLUMN IF EXISTS role_last_synced_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS role_last_source;
-- ALTER TABLE users DROP COLUMN IF EXISTS role_sync_locked;
-- ALTER TABLE users DROP COLUMN IF EXISTS role_sync_strategy;
