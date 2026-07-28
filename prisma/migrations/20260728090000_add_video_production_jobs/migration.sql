CREATE TABLE "video_production_jobs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "artifact_id" TEXT,
  "target_id" TEXT,
  "kind" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "idempotency_key" TEXT NOT NULL,
  "lease_token" TEXT,
  "worker_id" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "last_error" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_production_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "video_production_circuits" (
  "key" TEXT NOT NULL,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "open_until" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_production_circuits_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "video_production_jobs_idempotency_key_key"
  ON "video_production_jobs"("idempotency_key");
CREATE UNIQUE INDEX "video_production_jobs_lease_token_key"
  ON "video_production_jobs"("lease_token");
CREATE INDEX "video_production_jobs_status_available_at_priority_idx"
  ON "video_production_jobs"("status", "available_at", "priority");
CREATE INDEX "video_production_jobs_project_id_status_stage_idx"
  ON "video_production_jobs"("project_id", "status", "stage");
CREATE INDEX "video_production_jobs_kind_status_available_at_idx"
  ON "video_production_jobs"("kind", "status", "available_at");
CREATE INDEX "video_production_jobs_lease_expires_at_idx"
  ON "video_production_jobs"("lease_expires_at");
CREATE INDEX "video_production_circuits_open_until_idx"
  ON "video_production_circuits"("open_until");

ALTER TABLE "video_production_jobs"
  ADD CONSTRAINT "video_production_jobs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "video_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_production_jobs"
  ADD CONSTRAINT "video_production_jobs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
