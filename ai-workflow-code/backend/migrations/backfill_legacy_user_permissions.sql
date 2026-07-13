-- Backfill legacy users whose permissions JSON is empty / unconfigured.
-- Safe to run multiple times: only updates rows still missing modules config.
--
-- Usage:
--   psql "$DATABASE_URL" -f backend/migrations/backfill_legacy_user_permissions.sql
-- Or inside docker:
--   docker exec -i workflow-workbench-db psql -U ai_workbench -d ai_workbench \
--     < backend/migrations/backfill_legacy_user_permissions.sql

BEGIN;

-- operator (default role)
UPDATE users
SET permissions = '{
  "delete": {"assets": true, "gallery": true, "video_gallery": true},
  "modules": {
    "dashboard": true,
    "assets": true,
    "review": true,
    "gallery": true,
    "stats": true,
    "video_gallery": true,
    "tasks": {
      "visible": true,
      "workflows": {
        "expression": true,
        "activity": true,
        "background": true,
        "daily_post": true,
        "share": true,
        "trending": true,
        "trending_news": true,
        "video": true,
        "logo": true
      }
    },
    "templates": {
      "visible": true,
      "items": {
        "instructions": true,
        "prompts": true,
        "activity_templates": true,
        "daily_post_templates": true
      }
    },
    "admin": {
      "visible": false,
      "items": {
        "users": false,
        "api_keys": false,
        "logs": false,
        "models": false,
        "hotspot_import": false,
        "share_instructions": false
      }
    }
  }
}'::jsonb
WHERE role = 'operator'
  AND (
    permissions IS NULL
    OR permissions = '{}'::jsonb
    OR permissions->'modules' IS NULL
    OR permissions->'modules' = '{}'::jsonb
  );

-- reviewer
UPDATE users
SET permissions = '{
  "delete": {"assets": false, "gallery": false, "video_gallery": false},
  "modules": {
    "dashboard": true,
    "assets": false,
    "review": true,
    "gallery": true,
    "stats": true,
    "video_gallery": true,
    "tasks": {
      "visible": false,
      "workflows": {
        "expression": false,
        "activity": false,
        "background": false,
        "daily_post": false,
        "share": false,
        "trending": false,
        "trending_news": false,
        "video": false,
        "logo": false
      }
    },
    "templates": {
      "visible": false,
      "items": {
        "instructions": false,
        "prompts": false,
        "activity_templates": false,
        "daily_post_templates": false
      }
    },
    "admin": {
      "visible": false,
      "items": {
        "users": false,
        "api_keys": false,
        "logs": false,
        "models": false,
        "hotspot_import": false,
        "share_instructions": false
      }
    }
  }
}'::jsonb
WHERE role = 'reviewer'
  AND (
    permissions IS NULL
    OR permissions = '{}'::jsonb
    OR permissions->'modules' IS NULL
    OR permissions->'modules' = '{}'::jsonb
  );

-- viewer
UPDATE users
SET permissions = '{
  "delete": {"assets": false, "gallery": false, "video_gallery": false},
  "modules": {
    "dashboard": true,
    "assets": false,
    "review": false,
    "gallery": true,
    "stats": false,
    "video_gallery": true,
    "tasks": {
      "visible": false,
      "workflows": {
        "expression": false,
        "activity": false,
        "background": false,
        "daily_post": false,
        "share": false,
        "trending": false,
        "trending_news": false,
        "video": false,
        "logo": false
      }
    },
    "templates": {
      "visible": false,
      "items": {
        "instructions": false,
        "prompts": false,
        "activity_templates": false,
        "daily_post_templates": false
      }
    },
    "admin": {
      "visible": false,
      "items": {
        "users": false,
        "api_keys": false,
        "logs": false,
        "models": false,
        "hotspot_import": false,
        "share_instructions": false
      }
    }
  }
}'::jsonb
WHERE role = 'viewer'
  AND (
    permissions IS NULL
    OR permissions = '{}'::jsonb
    OR permissions->'modules' IS NULL
    OR permissions->'modules' = '{}'::jsonb
  );

COMMIT;
