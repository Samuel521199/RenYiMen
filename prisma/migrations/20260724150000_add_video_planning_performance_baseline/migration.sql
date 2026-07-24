CREATE TABLE "video_planning_run_metrics" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "planner_arch" TEXT NOT NULL DEFAULT 'v2',
    "model_name" TEXT,
    "duration_seconds" INTEGER NOT NULL,
    "segment_count" INTEGER NOT NULL DEFAULT 0,
    "reference_image_count" INTEGER NOT NULL DEFAULT 0,
    "checkpoint_resume" BOOLEAN NOT NULL DEFAULT false,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "queue_duration_ms" INTEGER,
    "total_duration_ms" INTEGER,
    "json_repair_count" INTEGER NOT NULL DEFAULT 0,
    "json_repair_duration_ms" INTEGER NOT NULL DEFAULT 0,
    "single_take_repair_count" INTEGER NOT NULL DEFAULT 0,
    "single_take_repair_duration_ms" INTEGER NOT NULL DEFAULT 0,
    "story_contract_repair_count" INTEGER NOT NULL DEFAULT 0,
    "story_contract_repair_ms" INTEGER NOT NULL DEFAULT 0,
    "failure_stage" TEXT,
    "error_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_planning_run_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "video_planning_stage_metrics" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "segment_no" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL DEFAULT 'model_call',
    "model_name" TEXT,
    "status" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "http_status" INTEGER,
    "retryable" BOOLEAN,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_planning_stage_metrics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_planning_run_metrics_task_id_key" ON "video_planning_run_metrics"("task_id");
CREATE INDEX "video_planning_run_metrics_status_completed_at_idx" ON "video_planning_run_metrics"("status", "completed_at");
CREATE INDEX "video_planning_run_metrics_duration_seconds_completed_at_idx" ON "video_planning_run_metrics"("duration_seconds", "completed_at");
CREATE INDEX "video_planning_run_metrics_model_name_completed_at_idx" ON "video_planning_run_metrics"("model_name", "completed_at");
CREATE INDEX "video_planning_run_metrics_user_id_completed_at_idx" ON "video_planning_run_metrics"("user_id", "completed_at");
CREATE INDEX "video_planning_stage_metrics_run_id_stage_idx" ON "video_planning_stage_metrics"("run_id", "stage");
CREATE INDEX "video_planning_stage_metrics_stage_completed_at_idx" ON "video_planning_stage_metrics"("stage", "completed_at");
CREATE INDEX "video_planning_stage_metrics_status_completed_at_idx" ON "video_planning_stage_metrics"("status", "completed_at");

ALTER TABLE "video_planning_run_metrics"
ADD CONSTRAINT "video_planning_run_metrics_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "video_planning_run_metrics"
ADD CONSTRAINT "video_planning_run_metrics_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "video_planning_stage_metrics"
ADD CONSTRAINT "video_planning_stage_metrics_run_id_fkey"
FOREIGN KEY ("run_id") REFERENCES "video_planning_run_metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
