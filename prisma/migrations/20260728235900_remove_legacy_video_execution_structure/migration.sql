-- Phase 8 hard cutover: archive every historical legacy value before removal.
CREATE TABLE "video_legacy_execution_archive" (
  "id" BIGSERIAL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "source_table" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "legacy_payload" JSONB NOT NULL,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "video_legacy_execution_archive_project_id_idx"
  ON "video_legacy_execution_archive" ("project_id", "source_table");

INSERT INTO "video_legacy_execution_archive" (
  "project_id",
  "source_table",
  "source_id",
  "legacy_payload"
)
SELECT
  "id",
  'video_projects',
  "id",
  jsonb_build_object('compose_task_id', "compose_task_id")
FROM "video_projects"
WHERE "compose_task_id" IS NOT NULL;

INSERT INTO "video_legacy_execution_archive" (
  "project_id",
  "source_table",
  "source_id",
  "legacy_payload"
)
SELECT
  "project_id",
  'video_keyframes',
  "id",
  jsonb_build_object('image_task_id', "image_task_id")
FROM "video_keyframes"
WHERE "image_task_id" IS NOT NULL;

INSERT INTO "video_legacy_execution_archive" (
  "project_id",
  "source_table",
  "source_id",
  "legacy_payload"
)
SELECT
  "project_id",
  'video_segments',
  "id",
  jsonb_build_object('clip_task_id', "clip_task_id")
FROM "video_segments"
WHERE "clip_task_id" IS NOT NULL;

INSERT INTO "video_legacy_execution_archive" (
  "project_id",
  "source_table",
  "source_id",
  "legacy_payload"
)
SELECT
  "project_id",
  'video_shots',
  "id",
  to_jsonb("video_shots")
FROM "video_shots";

DROP TABLE "video_shots";
ALTER TABLE "video_projects" DROP COLUMN "compose_task_id";
ALTER TABLE "video_keyframes" DROP COLUMN "image_task_id";
ALTER TABLE "video_segments" DROP COLUMN "clip_task_id";
