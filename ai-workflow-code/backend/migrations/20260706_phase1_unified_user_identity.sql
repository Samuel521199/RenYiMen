-- Phase 1: Workbench 与主站用户系统统一（身份映射层）
-- 目标：保留现有 users.id 与业务外键不变，仅新增平台身份映射字段，确保可灰度/可回滚。

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_user_id VARCHAR(191);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_source VARCHAR(20) DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sso_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_platform_user_id
    ON users(platform_user_id)
    WHERE platform_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(email))
    WHERE email IS NOT NULL;

-- 兼容历史账号：若 username 本身是邮箱，回填 email，避免首次 SSO 创建重复账号。
UPDATE users SET email = username WHERE (email IS NULL OR email = '') AND POSITION('@' IN username) > 1;

-- 兼容展示逻辑：display_name 缺失时回填 username。
UPDATE users SET display_name = username WHERE display_name IS NULL OR display_name = '';

UPDATE users SET auth_source = 'local' WHERE auth_source IS NULL OR auth_source = '';

COMMIT;

-- 回滚点（仅当确认未依赖新字段时执行）：
-- DROP INDEX IF EXISTS idx_users_email_lower;
-- DROP INDEX IF EXISTS uq_users_platform_user_id;
-- ALTER TABLE users DROP COLUMN IF EXISTS last_sso_at;
-- ALTER TABLE users DROP COLUMN IF EXISTS auth_source;
-- ALTER TABLE users DROP COLUMN IF EXISTS display_name;
-- ALTER TABLE users DROP COLUMN IF EXISTS email;
-- ALTER TABLE users DROP COLUMN IF EXISTS platform_user_id;
