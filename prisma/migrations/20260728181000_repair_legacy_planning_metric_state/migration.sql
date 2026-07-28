-- Older workers reopened the same metric row after a terminal attempt. That
-- could leave status='running' together with a non-null completed_at while
-- later stage observations were appended to the same row. We cannot recover
-- exact historical attempt boundaries, but we can keep those rows from
-- corrupting the logical-run baseline by restoring their terminal state and
-- end-to-end duration.
UPDATE "video_planning_run_metrics" AS r
SET
  "status" = CASE
    WHEN p."status" = 'FAILED' THEN 'failed'
    ELSE 'completed'
  END,
  "completed_at" = GREATEST(
    r."completed_at",
    COALESCE((
      SELECT MAX(s."completed_at")
      FROM "video_planning_stage_metrics" AS s
      WHERE s."run_id" = r."id"
    ), r."completed_at")
  ),
  "total_duration_ms" = GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (
      GREATEST(r."completed_at", COALESCE((
        SELECT MAX(s."completed_at")
        FROM "video_planning_stage_metrics" AS s
        WHERE s."run_id" = r."id"
      ), r."completed_at"))
      - r."queued_at"
    )) * 1000)::integer
  ),
  "checkpoint_resume" = true,
  "updated_at" = NOW()
FROM "video_projects" AS p
WHERE r."project_id" = p."id"
  AND r."status" = 'running'
  AND r."completed_at" IS NOT NULL
  AND p."status" IN (
    'PLAN_REVIEW',
    'IMAGE_GENERATING',
    'IMAGE_REVIEW',
    'MICRO_SHOT_REVIEW',
    'CLIP_GENERATING',
    'CLIP_REVIEW',
    'COMPOSING',
    'FINAL_REVIEW',
    'DONE',
    'FAILED'
  );
