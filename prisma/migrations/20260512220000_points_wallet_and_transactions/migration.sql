-- 积分体系升级：User.balance、新流水表；迁移旧钱包余额后删除 wallets；重建 transactions（旧结构不兼容）

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "balance" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallets') THEN
    UPDATE "users" u
    SET "balance" = GREATEST(0, ROUND(w.balance)::integer)
    FROM "wallets" w
    WHERE w.user_id = u.id;
  END IF;
END $$;

DROP TABLE IF EXISTS "wallets" CASCADE;
DROP TABLE IF EXISTS "transactions" CASCADE;

DROP TYPE IF EXISTS "TransactionStatus";
DROP TYPE IF EXISTS "TransactionType";
DROP TYPE IF EXISTS "PointsTransactionType" CASCADE;

CREATE TYPE "PointsTransactionType" AS ENUM ('RECHARGE', 'CONSUME');

CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "PointsTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "task_id" TEXT,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "transactions_user_id_created_at_idx" ON "transactions"("user_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
