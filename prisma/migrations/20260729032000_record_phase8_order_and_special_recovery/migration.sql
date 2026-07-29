CREATE TABLE "video_architecture_migration_audits" (
  "id" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "audit_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "observed_from" TIMESTAMP(3) NOT NULL,
  "observed_to" TIMESTAMP(3) NOT NULL,
  "release_cycle_id" TEXT,
  "evidence" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_architecture_migration_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "video_architecture_migration_audits_phase_status_idx"
  ON "video_architecture_migration_audits" ("phase", "status");

CREATE TABLE "video_special_project_recovery_records" (
  "project_id" TEXT NOT NULL,
  "source_backup" TEXT NOT NULL,
  "source_backup_sha256" TEXT NOT NULL,
  "original_status" TEXT NOT NULL,
  "resulting_state" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "recovery_actions" JSONB NOT NULL,
  "orphan_lease_disposition" TEXT NOT NULL,
  "planning_restarted" BOOLEAN NOT NULL DEFAULT false,
  "planning_job_count_before" INTEGER NOT NULL,
  "planning_job_count_after" INTEGER NOT NULL,
  "evidence" JSONB NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_special_project_recovery_records_pkey" PRIMARY KEY ("project_id")
);

CREATE INDEX "video_special_project_recovery_records_resulting_state_disposition_idx"
  ON "video_special_project_recovery_records" ("resulting_state", "disposition");
