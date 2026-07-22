CREATE TABLE "video_consistency_anchor_images" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "artifact_id" TEXT NOT NULL, "anchor_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "image_url" TEXT, "status" TEXT NOT NULL DEFAULT 'draft',
  "approved" BOOLEAN NOT NULL DEFAULT false, "user_accepted" BOOLEAN NOT NULL DEFAULT false, "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_consistency_anchor_images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "video_consistency_anchor_images_project_id_artifact_id_revision_key" ON "video_consistency_anchor_images"("project_id", "artifact_id", "revision");
CREATE INDEX "video_consistency_anchor_images_project_id_anchor_id_approved_idx" ON "video_consistency_anchor_images"("project_id", "anchor_id", "approved");

CREATE TABLE "video_anchor_reference_views" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "artifact_id" TEXT NOT NULL, "anchor_id" TEXT NOT NULL, "view" TEXT NOT NULL,
  "orientation" TEXT NOT NULL DEFAULT 'unknown', "revision" INTEGER NOT NULL DEFAULT 1, "source_artifact_id" TEXT, "source_revision_id" TEXT,
  "image_url" TEXT, "status" TEXT NOT NULL DEFAULT 'draft', "approved" BOOLEAN NOT NULL DEFAULT false, "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_anchor_reference_views_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "video_anchor_reference_views_project_id_artifact_id_revision_key" ON "video_anchor_reference_views"("project_id", "artifact_id", "revision");
CREATE INDEX "video_anchor_reference_views_project_id_anchor_id_view_approved_idx" ON "video_anchor_reference_views"("project_id", "anchor_id", "view", "approved");

CREATE TABLE "video_reference_selection_outputs" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "target_artifact_id" TEXT NOT NULL, "target_type" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1, "selected_artifact_ids" JSONB NOT NULL DEFAULT '[]', "selected_reference_urls" JSONB NOT NULL DEFAULT '[]',
  "payload" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_reference_selection_outputs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "video_reference_selection_outputs_project_id_target_artifact_id_revision_key" ON "video_reference_selection_outputs"("project_id", "target_artifact_id", "revision");
CREATE INDEX "video_reference_selection_outputs_project_id_target_type_updated_at_idx" ON "video_reference_selection_outputs"("project_id", "target_type", "updated_at");

CREATE TABLE "video_prompt_compilations" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "target_artifact_id" TEXT NOT NULL, "target_type" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1, "final_prompt" TEXT NOT NULL DEFAULT '', "negative_prompt" TEXT NOT NULL DEFAULT '', "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_prompt_compilations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "video_prompt_compilations_project_id_target_artifact_id_revision_key" ON "video_prompt_compilations"("project_id", "target_artifact_id", "revision");
CREATE INDEX "video_prompt_compilations_project_id_target_type_updated_at_idx" ON "video_prompt_compilations"("project_id", "target_type", "updated_at");

CREATE TABLE "video_generation_quality_reports" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "asset_id" TEXT NOT NULL, "report_key" TEXT NOT NULL DEFAULT 'active', "candidate_id" TEXT, "revision" INTEGER NOT NULL DEFAULT 1,
  "passed" BOOLEAN NOT NULL DEFAULT false, "user_accepted" BOOLEAN NOT NULL DEFAULT false, "composite_score" DOUBLE PRECISION,
  "retry_instruction" TEXT, "payload" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_generation_quality_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "video_generation_quality_reports_project_id_asset_id_report_key_revision_key" ON "video_generation_quality_reports"("project_id", "asset_id", "report_key", "revision");
CREATE INDEX "video_generation_quality_reports_project_id_passed_updated_at_idx" ON "video_generation_quality_reports"("project_id", "passed", "updated_at");
CREATE INDEX "video_generation_quality_reports_candidate_id_idx" ON "video_generation_quality_reports"("candidate_id");

CREATE TABLE "video_audio_assets" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "artifact_id" TEXT NOT NULL, "kind" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "url" TEXT, "status" TEXT NOT NULL DEFAULT 'draft', "approved" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_audio_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "video_audio_assets_project_id_artifact_id_revision_key" ON "video_audio_assets"("project_id", "artifact_id", "revision");
CREATE INDEX "video_audio_assets_project_id_kind_active_idx" ON "video_audio_assets"("project_id", "kind", "active");

CREATE TABLE "video_transition_references" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "artifact_id" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "from_camera_id" TEXT, "to_camera_id" TEXT NOT NULL DEFAULT '', "to_segment_no" INTEGER, "mode" TEXT NOT NULL DEFAULT 'short',
  "status" TEXT NOT NULL DEFAULT 'planned', "video_url" TEXT, "selected_frame_url" TEXT, "locked" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_transition_references_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "video_transition_references_project_id_artifact_id_revision_key" ON "video_transition_references"("project_id", "artifact_id", "revision");
CREATE INDEX "video_transition_references_project_id_to_camera_id_status_idx" ON "video_transition_references"("project_id", "to_camera_id", "status");

CREATE TABLE "video_artifact_metadata" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "artifact_id" TEXT NOT NULL, "artifact_type" TEXT NOT NULL DEFAULT '',
  "produced_by_stage" TEXT NOT NULL DEFAULT '', "revision" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'draft',
  "retry_from_stage" TEXT, "user_accepted" BOOLEAN NOT NULL DEFAULT false, "invalidated_by_artifact_ids" JSONB NOT NULL DEFAULT '[]',
  "parent_revision_ids" JSONB NOT NULL DEFAULT '[]', "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_artifact_metadata_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "video_artifact_metadata_project_id_artifact_id_revision_key" ON "video_artifact_metadata"("project_id", "artifact_id", "revision");
CREATE INDEX "video_artifact_metadata_project_id_status_retry_from_stage_idx" ON "video_artifact_metadata"("project_id", "status", "retry_from_stage");

ALTER TABLE "video_consistency_anchor_images" ADD CONSTRAINT "video_consistency_anchor_images_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_anchor_reference_views" ADD CONSTRAINT "video_anchor_reference_views_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_reference_selection_outputs" ADD CONSTRAINT "video_reference_selection_outputs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_prompt_compilations" ADD CONSTRAINT "video_prompt_compilations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_generation_quality_reports" ADD CONSTRAINT "video_generation_quality_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_audio_assets" ADD CONSTRAINT "video_audio_assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_transition_references" ADD CONSTRAINT "video_transition_references_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_artifact_metadata" ADD CONSTRAINT "video_artifact_metadata_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
