ALTER TABLE "generation_histories"
  ADD COLUMN IF NOT EXISTS "error_message" TEXT;
