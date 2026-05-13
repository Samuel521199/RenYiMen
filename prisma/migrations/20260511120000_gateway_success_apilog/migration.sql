-- 旧库：若仍存在已废弃的 TransactionStatus 枚举则追加 SUCCESS；空库/基线库无此类型则跳过
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TransactionStatus') THEN
    BEGIN
      ALTER TYPE "TransactionStatus" ADD VALUE 'SUCCESS';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ApiLog：上游任务 ID 与耗时（基线已含列时 IF NOT EXISTS 为 no-op）
ALTER TABLE "api_logs" ADD COLUMN IF NOT EXISTS "external_task_id" TEXT;
ALTER TABLE "api_logs" ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER;
