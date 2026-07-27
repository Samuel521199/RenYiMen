CREATE TABLE "video_quality_evaluation_caches" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'evaluating',
    "candidate_content_hash" TEXT NOT NULL,
    "reference_set_hash" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "report_json" JSONB,
    "source_candidate_id" TEXT,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_quality_evaluation_caches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_quality_evaluation_caches_lease_token_key"
ON "video_quality_evaluation_caches"("lease_token");

CREATE UNIQUE INDEX "video_quality_evaluation_caches_project_id_cache_key_key"
ON "video_quality_evaluation_caches"("project_id", "cache_key");

CREATE INDEX "video_quality_evaluation_caches_project_id_status_updated_at_idx"
ON "video_quality_evaluation_caches"("project_id", "status", "updated_at");

ALTER TABLE "video_quality_evaluation_caches"
ADD CONSTRAINT "video_quality_evaluation_caches_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "video_projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
