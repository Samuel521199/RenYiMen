-- CreateEnum
CREATE TYPE "VideoProjectStatus" AS ENUM (
  'DRAFT',
  'PLANNING',
  'PLAN_REVIEW',
  'IMAGE_GENERATING',
  'IMAGE_REVIEW',
  'CLIP_GENERATING',
  'CLIP_REVIEW',
  'COMPOSING',
  'FINAL_REVIEW',
  'DONE',
  'FAILED'
);

-- CreateEnum
CREATE TYPE "VideoShotStatus" AS ENUM (
  'SCRIPT_READY',
  'IMAGE_PENDING',
  'IMAGE_RUNNING',
  'IMAGE_READY',
  'IMAGE_APPROVED',
  'CLIP_PENDING',
  'CLIP_RUNNING',
  'CLIP_READY',
  'CLIP_APPROVED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "video_projects" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" "VideoProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL DEFAULT '',
  "user_prompt" TEXT NOT NULL,
  "plan_json" JSONB,
  "aspect_ratio" TEXT NOT NULL DEFAULT '9:16',
  "duration_seconds" INTEGER NOT NULL DEFAULT 30,
  "style_preset" TEXT NOT NULL DEFAULT '',
  "final_video_url" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "video_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_shots" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "shot_no" INTEGER NOT NULL,
  "status" "VideoShotStatus" NOT NULL DEFAULT 'SCRIPT_READY',
  "duration_seconds" INTEGER NOT NULL DEFAULT 5,
  "purpose" TEXT NOT NULL DEFAULT '',
  "camera" TEXT NOT NULL DEFAULT '',
  "action" TEXT NOT NULL DEFAULT '',
  "image_prompt" TEXT NOT NULL,
  "video_prompt" TEXT NOT NULL,
  "negative_prompt" TEXT NOT NULL DEFAULT '',
  "subtitle" TEXT NOT NULL DEFAULT '',
  "image_url" TEXT,
  "clip_url" TEXT,
  "image_task_id" TEXT,
  "clip_task_id" TEXT,
  "quality_score" INTEGER,
  "error_message" TEXT,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "video_shots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_projects_user_id_created_at_idx" ON "video_projects"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_shots_project_id_shot_no_key" ON "video_shots"("project_id", "shot_no");

-- CreateIndex
CREATE INDEX "video_shots_project_id_status_idx" ON "video_shots"("project_id", "status");

-- AddForeignKey
ALTER TABLE "video_projects"
ADD CONSTRAINT "video_projects_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_shots"
ADD CONSTRAINT "video_shots_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
