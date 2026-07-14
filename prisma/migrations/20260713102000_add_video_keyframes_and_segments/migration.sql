CREATE TABLE "video_keyframes" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "keyframe_no" INTEGER NOT NULL,
  "time_seconds" INTEGER NOT NULL,
  "status" "VideoShotStatus" NOT NULL DEFAULT 'SCRIPT_READY',
  "purpose" TEXT NOT NULL DEFAULT '',
  "scene" TEXT NOT NULL DEFAULT '',
  "character_state" TEXT NOT NULL DEFAULT '',
  "product_state" TEXT NOT NULL DEFAULT '',
  "image_prompt" TEXT NOT NULL,
  "negative_prompt" TEXT NOT NULL DEFAULT '',
  "image_url" TEXT,
  "image_task_id" TEXT,
  "quality_score" INTEGER,
  "error_message" TEXT,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "video_keyframes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "video_segments" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "segment_no" INTEGER NOT NULL,
  "status" "VideoShotStatus" NOT NULL DEFAULT 'SCRIPT_READY',
  "start_keyframe_no" INTEGER NOT NULL,
  "end_keyframe_no" INTEGER NOT NULL,
  "start_time_seconds" INTEGER NOT NULL,
  "end_time_seconds" INTEGER NOT NULL,
  "duration_seconds" INTEGER NOT NULL DEFAULT 5,
  "purpose" TEXT NOT NULL DEFAULT '',
  "motion" TEXT NOT NULL DEFAULT '',
  "camera" TEXT NOT NULL DEFAULT '',
  "subject_motion" TEXT NOT NULL DEFAULT '',
  "environment_motion" TEXT NOT NULL DEFAULT '',
  "video_prompt" TEXT NOT NULL,
  "negative_prompt" TEXT NOT NULL DEFAULT '',
  "subtitle" TEXT NOT NULL DEFAULT '',
  "clip_url" TEXT,
  "clip_task_id" TEXT,
  "quality_score" INTEGER,
  "error_message" TEXT,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "video_segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_keyframes_project_id_keyframe_no_key" ON "video_keyframes"("project_id", "keyframe_no");
CREATE INDEX "video_keyframes_project_id_status_idx" ON "video_keyframes"("project_id", "status");
CREATE UNIQUE INDEX "video_segments_project_id_segment_no_key" ON "video_segments"("project_id", "segment_no");
CREATE INDEX "video_segments_project_id_status_idx" ON "video_segments"("project_id", "status");

ALTER TABLE "video_keyframes" ADD CONSTRAINT "video_keyframes_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
