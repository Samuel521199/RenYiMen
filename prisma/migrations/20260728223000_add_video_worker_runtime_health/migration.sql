ALTER TABLE "video_production_jobs"
  ADD COLUMN "required_worker_version" TEXT,
  ADD COLUMN "claimed_worker_version" TEXT,
  ADD COLUMN "error_category" TEXT,
  ADD COLUMN "progress_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "video_production_jobs"
  ADD CONSTRAINT "video_production_jobs_worker_version_check"
  CHECK (
    "status" <> 'running'
    OR "required_worker_version" IS NULL
    OR "claimed_worker_version" = "required_worker_version"
  );

CREATE TABLE "video_production_worker_runtimes" (
  "worker_id" TEXT NOT NULL,
  "runtime_version" TEXT NOT NULL,
  "supported_kinds" JSONB NOT NULL DEFAULT '[]',
  "process_id" INTEGER,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_claimed_at" TIMESTAMP(3),
  "last_meaningful_progress_at" TIMESTAMP(3),
  "current_job_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_production_worker_runtimes_pkey" PRIMARY KEY ("worker_id")
);

CREATE INDEX "video_production_worker_runtimes_runtime_version_heartbeat_at_idx"
  ON "video_production_worker_runtimes"("runtime_version", "heartbeat_at");
CREATE INDEX "video_production_worker_runtimes_heartbeat_at_idx"
  ON "video_production_worker_runtimes"("heartbeat_at");
