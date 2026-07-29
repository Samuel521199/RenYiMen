-- Failed is now a recoverable production projection, not an unstructured sink.
UPDATE "video_projects"
SET "status" = 'WAITING_RECOVERY'
WHERE "status" = 'FAILED';

-- A persisted generating status without an owning active job is never allowed
-- to masquerade as work in progress.
UPDATE "video_projects" AS project
SET
  "status" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "video_production_jobs" AS failed_job
      WHERE failed_job."project_id" = project."id"
        AND failed_job."status" = 'failed'
    ) THEN 'WAITING_RECOVERY'::"VideoProjectStatus"
    ELSE 'STATE_INVARIANT_VIOLATION'::"VideoProjectStatus"
  END,
  "error_message" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "video_production_jobs" AS failed_job
      WHERE failed_job."project_id" = project."id"
        AND failed_job."status" = 'failed'
    ) THEN COALESCE(
      (
        SELECT '[' || COALESCE(failed_job."error_code", 'PRODUCTION_JOB_FAILED') || '] '
          || COALESCE(failed_job."last_error", 'Production job failed')
        FROM "video_production_jobs" AS failed_job
        WHERE failed_job."project_id" = project."id"
          AND failed_job."status" = 'failed'
        ORDER BY failed_job."updated_at" DESC
        LIMIT 1
      ),
      '[PRODUCTION_JOB_FAILED] Production job failed'
    )
    ELSE '[STATE_INVARIANT_VIOLATION] Persisted generating status has no active production job.'
  END
WHERE project."status" IN ('PLANNING', 'IMAGE_GENERATING', 'CLIP_GENERATING', 'COMPOSING')
  AND NOT EXISTS (
    SELECT 1
    FROM "video_production_jobs" AS active_job
    WHERE active_job."project_id" = project."id"
      AND active_job."status" IN ('queued', 'claimed', 'running', 'waiting_upstream', 'waiting_review')
  );

