CREATE TABLE "video_provider_task_leases" (
    "id" TEXT NOT NULL,
    "resource_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "lease_token" TEXT,
    "upstream_task_id" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_expires_at" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_provider_task_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_provider_task_leases_lease_token_key"
ON "video_provider_task_leases"("lease_token");

CREATE UNIQUE INDEX "video_provider_task_leases_upstream_task_id_key"
ON "video_provider_task_leases"("upstream_task_id");

CREATE UNIQUE INDEX "video_provider_task_leases_resource_key_target_id_key"
ON "video_provider_task_leases"("resource_key", "target_id");

CREATE INDEX "video_provider_task_leases_resource_key_status_queued_at_idx"
ON "video_provider_task_leases"("resource_key", "status", "queued_at");

CREATE INDEX "video_provider_task_leases_resource_key_user_id_status_idx"
ON "video_provider_task_leases"("resource_key", "user_id", "status");

CREATE INDEX "video_provider_task_leases_project_id_status_idx"
ON "video_provider_task_leases"("project_id", "status");

ALTER TABLE "video_provider_task_leases"
ADD CONSTRAINT "video_provider_task_leases_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "video_provider_task_leases"
ADD CONSTRAINT "video_provider_task_leases_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
