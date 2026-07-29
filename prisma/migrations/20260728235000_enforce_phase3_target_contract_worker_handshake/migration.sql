-- Phase 3.1: classify every historical missing target without guessing the
-- first generatable entity.
UPDATE "video_production_jobs"
SET "target_id" = "project_id"
WHERE NULLIF(BTRIM("target_id"), '') IS NULL
  AND "kind" IN ('planning', 'image_quality');

UPDATE "video_production_jobs"
SET "target_id" = 'final'
WHERE NULLIF(BTRIM("target_id"), '') IS NULL
  AND "kind" = 'compose';

UPDATE "video_production_jobs" AS job
SET "target_id" = keyframe."id"
FROM "video_keyframes" AS keyframe
WHERE NULLIF(BTRIM(job."target_id"), '') IS NULL
  AND job."kind" = 'image_prepare_submit'
  AND keyframe."project_id" = job."project_id"
  AND job."artifact_id" ~ '^(keyframe|consistency_reference):-?[0-9]+:image$'
  AND keyframe."keyframe_no" =
    substring(job."artifact_id" FROM ':(-?[0-9]+):image$')::integer;

UPDATE "video_production_jobs" AS job
SET "target_id" = segment."id"
FROM "video_segments" AS segment
WHERE NULLIF(BTRIM(job."target_id"), '') IS NULL
  AND job."kind" = 'clip_prepare_submit'
  AND segment."project_id" = job."project_id"
  AND job."artifact_id" ~ '^segment:[0-9]+:video$'
  AND segment."segment_no" = (
    regexp_match(job."artifact_id", '^segment:([0-9]+):video$')
  )[1]::integer;

UPDATE "video_production_jobs"
SET "target_id" = "project_id" || ':' || "artifact_id"
WHERE NULLIF(BTRIM("target_id"), '') IS NULL
  AND "kind" = 'micro_shot_prepare_submit'
  AND NULLIF(BTRIM("artifact_id"), '') IS NOT NULL
  AND "artifact_id" ~ '^segment:[0-9]+:micro_shot:[0-9]+:image$';

UPDATE "video_production_jobs"
SET
  "target_id" = 'migration_failed:' || "id",
  "status" = 'cancelled',
  "stage" = 'contract_validation',
  "completed_at" = COALESCE("completed_at", NOW()),
  "lease_token" = NULL,
  "worker_id" = NULL,
  "claimed_worker_version" = NULL,
  "lease_expires_at" = NULL,
  "last_error" = 'Phase 3 target migration could not identify the canonical entity target.',
  "error_category" = 'internal_scheduling',
  "error_code" = 'MIGRATION_FAILED_TARGET',
  "recovery_action" = 'MIGRATE_TARGET_ID'
WHERE NULLIF(BTRIM("target_id"), '') IS NULL;

UPDATE "video_production_jobs"
SET
  "status" = 'cancelled',
  "stage" = 'contract_validation',
  "completed_at" = COALESCE("completed_at", NOW()),
  "lease_token" = NULL,
  "worker_id" = NULL,
  "claimed_worker_version" = NULL,
  "lease_expires_at" = NULL,
  "last_error" = COALESCE(
    "last_error",
    'Historical project_reconcile archived during Phase 3 target migration.'
  )
WHERE "kind" = 'project_reconcile';

ALTER TABLE "video_production_jobs"
  ALTER COLUMN "target_id" SET NOT NULL;

ALTER TABLE "video_production_jobs"
  DROP CONSTRAINT IF EXISTS "video_production_jobs_target_scoped_check";

ALTER TABLE "video_production_jobs"
  ADD CONSTRAINT "video_production_jobs_target_scoped_check"
  CHECK (LENGTH(BTRIM("target_id")) > 0);

-- Phase 3.4: a Worker advertises the payload protocol versions it can consume.
ALTER TABLE "video_production_worker_runtimes"
  ADD COLUMN IF NOT EXISTS "supported_payload_versions" JSONB NOT NULL DEFAULT '[2]'::jsonb;

-- Rows registered by pre-Phase-3 Workers are historical runtime evidence. They
-- must not claim support for payload v2 until a new Worker heartbeats.
UPDATE "video_production_worker_runtimes"
SET "supported_payload_versions" = '[1]'::jsonb;

-- Terminal historical rows remain auditable as protocol v1 and cannot be
-- claimed. Active rows keep their existing v2 payload when valid.
UPDATE "video_production_jobs"
SET "required_worker_version" = COALESCE(
  NULLIF(BTRIM("required_worker_version"), ''),
  CASE
    WHEN "status" IN ('completed', 'failed', 'cancelled')
      THEN 'archived:terminal-v1'
    ELSE 'migration_failed:worker-version:' || "id"
  END
);

UPDATE "video_production_jobs"
SET "payload" = COALESCE("payload", '{}'::jsonb) || jsonb_build_object(
  'payloadSchemaVersion',
    CASE
      WHEN "status" IN ('queued', 'claimed', 'running', 'waiting_upstream', 'waiting_review')
        AND COALESCE("payload"->>'payloadSchemaVersion', '') ~ '^[0-9]+$'
        THEN ("payload"->>'payloadSchemaVersion')::integer
      WHEN "status" IN ('queued', 'claimed', 'running', 'waiting_upstream', 'waiting_review')
        THEN 0
      ELSE 1
    END,
  'requiredWorkerVersion', "required_worker_version",
  'contractVersion',
    CASE
      WHEN "status" IN ('queued', 'claimed', 'running', 'waiting_upstream', 'waiting_review')
        AND COALESCE("payload"->>'payloadSchemaVersion', '') = '2'
        THEN 2
      ELSE 1
    END
);

UPDATE "video_production_jobs"
SET
  "last_error" = 'No compatible Worker can execute this legacy or incomplete payload.',
  "error_category" = 'internal_scheduling',
  "error_code" = 'NO_COMPATIBLE_WORKER',
  "recovery_action" = 'MIGRATE_OR_REENQUEUE_PAYLOAD'
WHERE "status" IN ('queued', 'claimed', 'running', 'waiting_upstream', 'waiting_review')
  AND (
    "payload"->>'payloadSchemaVersion' <> '2'
    OR "payload"->>'contractVersion' <> '2'
    OR "payload"->>'requiredWorkerVersion' <> "required_worker_version"
  );

ALTER TABLE "video_production_jobs"
  ALTER COLUMN "required_worker_version" SET NOT NULL;

ALTER TABLE "video_production_jobs"
  DROP CONSTRAINT IF EXISTS "video_production_jobs_version_handshake_check";

ALTER TABLE "video_production_jobs"
  ADD CONSTRAINT "video_production_jobs_version_handshake_check"
  CHECK (
    LENGTH(BTRIM("required_worker_version")) > 0
    AND jsonb_typeof("payload"->'payloadSchemaVersion') = 'number'
    AND jsonb_typeof("payload"->'contractVersion') = 'number'
    AND jsonb_typeof("payload"->'requiredWorkerVersion') = 'string'
    AND "payload"->>'requiredWorkerVersion' = "required_worker_version"
  );
