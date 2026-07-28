-- The old progress accumulator stopped the story-contract timer only after the
-- semantic critic returned. Stage observations have the precise model-call
-- duration, so use their sum to repair already collected rows.
WITH observed AS (
  SELECT
    "run_id",
    SUM("duration_ms")::integer AS "duration_ms"
  FROM "video_planning_stage_metrics"
  WHERE "stage" = 'story_contract_repair'
    AND "status" = 'completed'
  GROUP BY "run_id"
)
UPDATE "video_planning_run_metrics" AS r
SET
  "story_contract_repair_ms" = observed."duration_ms",
  "updated_at" = NOW()
FROM observed
WHERE observed."run_id" = r."id"
  AND observed."duration_ms" <> r."story_contract_repair_ms";
