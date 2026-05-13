-- AlterTable
ALTER TABLE "generation_histories" ADD COLUMN IF NOT EXISTS "duration_int" INTEGER NOT NULL DEFAULT 0;
