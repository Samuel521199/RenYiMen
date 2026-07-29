UPDATE "video_provider_task_leases"
SET
  "target_id" = 'invalid:' || "id",
  "status" = 'released',
  "lease_token" = NULL,
  "upstream_task_id" = NULL,
  "lease_expires_at" = NULL,
  "last_error" = 'Legacy capacity entry had an empty targetId and was released before provider submission.'
WHERE NULLIF(BTRIM("target_id"), '') IS NULL;

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

ALTER TABLE "video_provider_task_leases"
  ADD CONSTRAINT "video_provider_task_leases_nonempty_target_check"
  CHECK (NULLIF(BTRIM("target_id"), '') IS NOT NULL);

ALTER TABLE "video_production_jobs"
  ADD CONSTRAINT "video_production_jobs_target_scoped_check"
  CHECK (NULLIF(BTRIM("target_id"), '') IS NOT NULL);
