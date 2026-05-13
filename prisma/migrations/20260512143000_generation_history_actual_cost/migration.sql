-- AlterTable（基线已含列时跳过）
ALTER TABLE "generation_histories" ADD COLUMN IF NOT EXISTS "actual_cost" INTEGER;
