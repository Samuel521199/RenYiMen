-- 基线 20260509120000_baseline 已创建完整 generation_histories；此处仅兼容「无基线」的旧空库路径
DO $$
BEGIN
  CREATE TYPE "GenerationHistoryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "generation_histories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" "GenerationHistoryStatus" NOT NULL DEFAULT 'PENDING',
    "result_url" TEXT,
    "media_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_histories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "generation_histories_task_id_key" ON "generation_histories"("task_id");

CREATE INDEX IF NOT EXISTS "generation_histories_user_id_created_at_idx" ON "generation_histories"("user_id", "created_at");

DO $$
BEGIN
  ALTER TABLE "generation_histories" ADD CONSTRAINT "generation_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
