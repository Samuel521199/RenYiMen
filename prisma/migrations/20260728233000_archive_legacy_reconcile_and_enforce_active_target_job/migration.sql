-- The earlier target invariant migration was recorded in some environments
-- before its final SQL existed. Re-assert the invariant idempotently here.
UPDATE "video_production_jobs"
SET
  "target_id" = "project_id",
  "last_error" = CASE
    WHEN "status" IN ('queued', 'running')
      THEN 'Legacy job targetId was migrated to its projectId; re-enqueue target-scoped media work explicitly.'
    ELSE "last_error"
  END
WHERE NULLIF(BTRIM("target_id"), '') IS NULL;

ALTER TABLE "video_production_jobs"
  ALTER COLUMN "target_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'video_production_jobs_target_scoped_check'
  ) THEN
    ALTER TABLE "video_production_jobs"
      ADD CONSTRAINT "video_production_jobs_target_scoped_check"
      CHECK (NULLIF(BTRIM("target_id"), '') IS NOT NULL);
  END IF;
END
$$;

-- project_reconcile is no longer an executable production-job kind.
-- Preserve the rows for audit, but make their terminal archival state explicit.
UPDATE "video_production_jobs"
SET
  "status" = 'cancelled',
  "stage" = 'archived',
  "completed_at" = COALESCE("completed_at", NOW()),
  "lease_token" = NULL,
  "worker_id" = NULL,
  "claimed_worker_version" = NULL,
  "lease_expires_at" = NULL,
  "last_error" = COALESCE(
    "last_error",
    'Archived during Phase 1: project_reconcile is no longer executable.'
  )
WHERE "kind" = 'project_reconcile';

-- Defensive cleanup for databases that already contain duplicate live jobs for
-- one target. Keep the oldest row (the durable identity) and archive the rest.
WITH ranked_active_jobs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "kind", "target_id", COALESCE("artifact_id", '')
      ORDER BY "created_at" ASC, "id" ASC
    ) AS duplicate_rank
  FROM "video_production_jobs"
  WHERE "status" IN ('queued', 'running')
)
UPDATE "video_production_jobs" AS job
SET
  "status" = 'cancelled',
  "stage" = 'archived_duplicate',
  "completed_at" = NOW(),
  "lease_token" = NULL,
  "worker_id" = NULL,
  "claimed_worker_version" = NULL,
  "lease_expires_at" = NULL,
  "last_error" = 'Archived during Phase 1: duplicate active target job.'
FROM ranked_active_jobs AS ranked
WHERE job."id" = ranked."id"
  AND ranked.duplicate_rank > 1;

-- A target can have only one live durable job of a given kind/artifact.
-- Revisions must explicitly finish or cancel the previous job before starting.
CREATE UNIQUE INDEX "video_production_jobs_one_active_target"
  ON "video_production_jobs" (
    "kind",
    "target_id",
    COALESCE("artifact_id", '')
  )
  WHERE "status" IN ('queued', 'running');
