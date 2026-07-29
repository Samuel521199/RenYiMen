ALTER TABLE "video_production_jobs"
  ADD COLUMN "model_attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_model_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "stage_repair_attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_stage_repair_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "infrastructure_attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_infrastructure_attempts" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "lease_loss_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "user_retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_interruption_reason" TEXT,
  ADD COLUMN "deployment_grace_until" TIMESTAMP(3);

-- A claim was previously counted as an attempt. Active claims have not proven
-- a business/model failure, so start their separated business budgets at zero.
UPDATE "video_production_jobs"
SET
  "attempt" = 0,
  "model_attempt" = 0
WHERE "status" IN ('queued', 'claimed', 'running', 'waiting_upstream', 'waiting_review');

-- Recover legacy jobs whose only terminal reason was Worker lease loss. A
-- planning job is safe to resume only when its durable planner checkpoint is
-- present; non-planning target jobs already persist their target/upstream state.
UPDATE "video_production_jobs" AS job
SET
  "status" = 'queued',
  "attempt" = 0,
  "model_attempt" = 0,
  "infrastructure_attempt" = GREATEST(job."infrastructure_attempt", job."attempt"),
  "lease_loss_count" = GREATEST(job."lease_loss_count", job."attempt"),
  "available_at" = NOW(),
  "completed_at" = NULL,
  "lease_token" = NULL,
  "worker_id" = NULL,
  "claimed_worker_version" = NULL,
  "lease_expires_at" = NULL,
  "last_interruption_reason" = 'legacy_worker_lease_expired',
  "last_error" = 'Worker interruption detected; checkpoint preserved and automatic recovery queued.',
  "error_category" = 'internal_scheduling',
  "error_code" = 'INFRASTRUCTURE_RECOVERY_QUEUED',
  "recovery_action" = 'AUTO_RETRY_INFRASTRUCTURE'
FROM "video_projects" AS project
WHERE job."project_id" = project."id"
  AND job."status" = 'failed'
  AND job."error_code" = 'RETRY_EXHAUSTED'
  AND job."last_error" = 'Worker lease expired; job returned to the durable queue.'
  AND (
    job."kind" <> 'planning'
    OR project."plan_json"->'plannerCheckpoint' IS NOT NULL
  );

UPDATE "video_projects" AS project
SET
  "status" = 'WAITING_RECOVERY',
  "error_message" = NULL
WHERE EXISTS (
  SELECT 1
  FROM "video_production_jobs" AS job
  WHERE job."project_id" = project."id"
    AND job."status" = 'queued'
    AND job."recovery_action" = 'AUTO_RETRY_INFRASTRUCTURE'
);

CREATE INDEX "video_production_jobs_infrastructure_recovery_idx"
  ON "video_production_jobs" ("status", "infrastructure_attempt", "available_at");
