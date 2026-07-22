CREATE TABLE "video_generation_candidates" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "candidate_no" INTEGER NOT NULL,
    "task_id" TEXT,
    "media_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "prompt" TEXT NOT NULL DEFAULT '',
    "negative_prompt" TEXT NOT NULL DEFAULT '',
    "quality_report" JSONB,
    "composite_score" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "user_accepted" BOOLEAN NOT NULL DEFAULT false,
    "retry_instruction" TEXT,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_generation_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_generation_candidates_project_id_artifact_id_batch_id_candidate_no_key"
ON "video_generation_candidates"("project_id", "artifact_id", "batch_id", "candidate_no");

CREATE INDEX "video_generation_candidates_project_id_artifact_id_created_at_idx"
ON "video_generation_candidates"("project_id", "artifact_id", "created_at");

CREATE INDEX "video_generation_candidates_project_id_status_idx"
ON "video_generation_candidates"("project_id", "status");

ALTER TABLE "video_generation_candidates"
ADD CONSTRAINT "video_generation_candidates_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
