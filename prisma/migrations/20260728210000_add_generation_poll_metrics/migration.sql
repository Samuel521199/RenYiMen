ALTER TABLE "video_generation_candidates"
ADD COLUMN "upstream_submitted_at" TIMESTAMP(3),
ADD COLUMN "upstream_poll_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "upstream_poll_total_ms" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "upstream_last_polled_at" TIMESTAMP(3),
ADD COLUMN "upstream_completed_seen_at" TIMESTAMP(3);

UPDATE "video_generation_candidates"
SET "upstream_submitted_at" = "created_at"
WHERE "upstream_submitted_at" IS NULL
  AND "task_id" IS NOT NULL;
