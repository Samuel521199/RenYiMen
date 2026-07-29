ALTER TYPE "VideoProjectStatus" ADD VALUE IF NOT EXISTS 'WAITING_RECOVERY';
ALTER TYPE "VideoProjectStatus" ADD VALUE IF NOT EXISTS 'STATE_INVARIANT_VIOLATION';

ALTER TABLE "video_production_jobs"
  ADD COLUMN IF NOT EXISTS "error_code" TEXT,
  ADD COLUMN IF NOT EXISTS "recovery_action" TEXT;

-- A stopped Worker must never leave ownership behind during this migration.
UPDATE "video_production_jobs"
SET
  "status" = 'queued',
  "available_at" = NOW(),
  "lease_token" = NULL,
  "worker_id" = NULL,
  "claimed_worker_version" = NULL,
  "lease_expires_at" = NULL
WHERE "status" = 'running';

-- Stage now means only the production phase. Waiting and failure reasons live
-- in status/error_code/recovery_action/payload instead.
UPDATE "video_production_jobs"
SET "stage" = CASE
  WHEN "kind" = 'planning' THEN 'planning'
  WHEN "kind" = 'compose' THEN 'composition'
  WHEN "kind" = 'image_quality' THEN 'quality_evaluation'
  WHEN "stage" IN ('contract_repair_required', 'terminal_failed') THEN 'contract_validation'
  WHEN "stage" IN ('submitted', 'generating', 'waiting_quality') THEN 'provider_polling'
  ELSE 'provider_submission'
END;

UPDATE "video_production_jobs"
SET
  "error_code" = COALESCE(
    "error_code",
    CASE
      WHEN "error_category" = 'contract_validation' THEN 'EXECUTION_CONTRACT_INVALID'
      WHEN "error_category" = 'internal_capacity' THEN 'CAPACITY_RETRY_EXHAUSTED'
      ELSE 'PRODUCTION_JOB_FAILED'
    END
  ),
  "recovery_action" = COALESCE(
    "recovery_action",
    CASE
      WHEN "error_category" = 'contract_validation' THEN 'REPAIR_CONTRACT'
      WHEN "error_category" = 'internal_capacity' THEN 'RESUME_TARGET'
      ELSE 'RETRY_TARGET'
    END
  ),
  "completed_at" = COALESCE("completed_at", NOW())
WHERE "status" = 'failed';

UPDATE "video_production_jobs"
SET "completed_at" = COALESCE("completed_at", NOW())
WHERE "status" IN ('completed', 'cancelled');

UPDATE "video_production_jobs"
SET "completed_at" = NULL
WHERE "status" IN ('queued', 'claimed', 'running', 'waiting_upstream', 'waiting_review');

DROP INDEX IF EXISTS "video_production_jobs_one_active_target";

CREATE UNIQUE INDEX "video_production_jobs_one_active_target"
  ON "video_production_jobs" (
    "kind",
    "target_id",
    COALESCE("artifact_id", '')
  )
  WHERE "status" IN ('queued', 'claimed', 'running', 'waiting_upstream', 'waiting_review');

ALTER TABLE "video_production_jobs"
  DROP CONSTRAINT IF EXISTS "video_production_jobs_status_check",
  DROP CONSTRAINT IF EXISTS "video_production_jobs_stage_check",
  DROP CONSTRAINT IF EXISTS "video_production_jobs_worker_lease_check",
  DROP CONSTRAINT IF EXISTS "video_production_jobs_terminal_error_check";

ALTER TABLE "video_production_jobs"
  ADD CONSTRAINT "video_production_jobs_status_check"
    CHECK ("status" IN (
      'queued',
      'claimed',
      'running',
      'waiting_upstream',
      'waiting_review',
      'completed',
      'failed',
      'cancelled'
    )),
  ADD CONSTRAINT "video_production_jobs_stage_check"
    CHECK ("stage" IN (
      'planning',
      'contract_validation',
      'provider_submission',
      'provider_polling',
      'quality_evaluation',
      'composition'
    )),
  ADD CONSTRAINT "video_production_jobs_worker_lease_check"
    CHECK (
      (
        "status" IN ('claimed', 'running')
        AND "lease_token" IS NOT NULL
        AND "worker_id" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
      )
      OR
      (
        "status" NOT IN ('claimed', 'running')
        AND "lease_token" IS NULL
        AND "worker_id" IS NULL
        AND "lease_expires_at" IS NULL
      )
    ),
  ADD CONSTRAINT "video_production_jobs_terminal_error_check"
    CHECK (
      "status" <> 'failed'
      OR (
        NULLIF(BTRIM("last_error"), '') IS NOT NULL
        AND NULLIF(BTRIM("error_code"), '') IS NOT NULL
        AND NULLIF(BTRIM("recovery_action"), '') IS NOT NULL
      )
    );

