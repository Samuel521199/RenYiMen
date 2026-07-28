ALTER TABLE "video_planning_run_metrics"
ADD COLUMN "root_task_id" TEXT,
ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1;

UPDATE "video_planning_run_metrics"
SET "root_task_id" = "task_id"
WHERE "root_task_id" IS NULL;

ALTER TABLE "video_planning_run_metrics"
ALTER COLUMN "root_task_id" SET NOT NULL;

CREATE UNIQUE INDEX "video_planning_run_metrics_root_task_id_attempt_number_key"
ON "video_planning_run_metrics"("root_task_id", "attempt_number");

CREATE INDEX "video_planning_run_metrics_root_task_id_completed_at_idx"
ON "video_planning_run_metrics"("root_task_id", "completed_at");
