CREATE TABLE "tool_projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "form_state" JSONB NOT NULL DEFAULT '{}',
    "output_state" JSONB NOT NULL DEFAULT '{}',
    "active_task_id" TEXT,
    "provider_code" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_projects_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "generation_histories" ADD COLUMN "tool_project_id" TEXT;

CREATE INDEX "tool_projects_user_id_sku_id_updated_at_idx"
ON "tool_projects"("user_id", "sku_id", "updated_at");

CREATE INDEX "generation_histories_tool_project_id_created_at_idx"
ON "generation_histories"("tool_project_id", "created_at");

ALTER TABLE "tool_projects"
ADD CONSTRAINT "tool_projects_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "generation_histories"
ADD CONSTRAINT "generation_histories_tool_project_id_fkey"
FOREIGN KEY ("tool_project_id") REFERENCES "tool_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
