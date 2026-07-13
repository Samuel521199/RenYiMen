import re
import unittest
from pathlib import Path

from app.database import Base
from app.models import (
    activity_batch,
    activity_template,
    asset,
    asset_tag,
    audit,
    background,
    gallery_tag,
    image,
    model_config,
    instruction,
    prompt,
    review,
    stats,
    task,
    user,
    user_model_permission,
    workflow_session,
    trending,
)


class ModelMetadataTests(unittest.TestCase):
    expected_tables = {
        "activity_generation_jobs",
        "activity_generation_batches",
        "activity_batch_images",
        "activity_field_definitions",
        "activity_template_types",
        "activity_templates",
        "activity_variable_presets",
        "api_keys",
        "assets",
        "asset_tag_relations",
        "asset_tags",
        "audit_logs",
        "background_generation_batches",
        "background_images",
        "daily_cost_stats",
        "daily_post_backgrounds",
        "daily_post_bull_actions",
        "daily_post_color_moods",
        "daily_post_jobs",
        "daily_post_templates",
        "final_images",
        "generation_logs",
        "gallery_tags",
        "instructions",
        "model_configs",
        "prompt_templates",
        "publish_stats",
        "review_logs",
        "roles",
        "share_game_instructions",
        "share_backgrounds",
        "share_bull_actions",
        "share_color_moods",
        "share_jobs",
        "task_images",
        "tasks",
        "trending_jobs",
        "trending_news_tasks",
        "trending_topic_type_config",
        "user_model_permissions",
        "users",
        "workflow_types",
        "workflow_sessions",
        "video_jobs",
        "video_motion_data",
        "video_drafts",
    }

    def test_all_core_tables_have_orm_models(self):
        self.assertTrue(activity_template.ActivityTemplateType)
        self.assertTrue(activity_template.ActivityTemplate)
        self.assertTrue(activity_template.ActivityFieldDefinition)
        self.assertTrue(activity_template.ActivityVariablePreset)
        self.assertTrue(activity_template.ActivityGenerationJob)
        self.assertTrue(activity_batch.ActivityGenerationBatch)
        self.assertTrue(activity_batch.ActivityBatchImage)
        self.assertTrue(background.BackgroundGenerationBatch)
        self.assertTrue(background.BackgroundImage)
        self.assertTrue(user.User)
        self.assertTrue(user.Role)
        self.assertTrue(user.ApiKey)
        self.assertTrue(task.Task)
        self.assertTrue(image.TaskImage)
        self.assertTrue(image.GenerationLog)
        self.assertTrue(image.FinalImage)
        self.assertTrue(prompt.PromptTemplate)
        self.assertTrue(asset.Asset)
        self.assertTrue(asset_tag.AssetTag)
        self.assertTrue(gallery_tag.GalleryTag)
        self.assertTrue(review.ReviewLog)
        self.assertTrue(stats.DailyCostStat)
        self.assertTrue(stats.PublishStat)
        self.assertTrue(audit.AuditLog)
        self.assertTrue(model_config.ModelConfig)
        self.assertTrue(instruction.WorkflowType)
        self.assertTrue(instruction.Instruction)
        self.assertTrue(user_model_permission.UserModelPermission)
        self.assertTrue(workflow_session.WorkflowSession)

        self.assertEqual(set(Base.metadata.tables), self.expected_tables)

    def test_key_columns_and_constraints_are_mapped(self):
        template_types = Base.metadata.tables["activity_template_types"]
        self.assertFalse(template_types.c.name.nullable)
        self.assertFalse(template_types.c.code.nullable)
        self.assertTrue(template_types.c.code.unique)

        templates = Base.metadata.tables["activity_templates"]
        self.assertTrue(templates.c.template_no.unique)
        self.assertTrue(templates.c.type_id.foreign_keys)
        self.assertTrue(templates.c.created_by.foreign_keys)
        self.assertEqual(templates.c.is_active.default.arg, True)
        self.assertIn("usage_scenario", templates.c)
        self.assertIn("bg_description", templates.c)
        self.assertIn("forbidden_rules", templates.c)
        self.assertIn("rule_character", templates.c)
        self.assertIn("rule_scene", templates.c)
        self.assertIn("rule_visual", templates.c)
        self.assertIn("rule_copy", templates.c)
        self.assertIn("rule_button", templates.c)
        self.assertIn("rule_quality", templates.c)
        self.assertIn("rule_forbidden", templates.c)
        self.assertIn("style_guide", templates.c)
        self.assertIn("style_tag", templates.c)

        field_definitions = Base.metadata.tables["activity_field_definitions"]
        self.assertTrue(field_definitions.c.template_id.foreign_keys)
        self.assertFalse(field_definitions.c.field_key.nullable)
        self.assertFalse(field_definitions.c.field_name.nullable)
        self.assertFalse(field_definitions.c.field_type.nullable)
        self.assertEqual(field_definitions.c.is_required.default.arg, True)
        self.assertEqual(field_definitions.c.sort_order.default.arg, 0)
        self.assertIn("options_json", field_definitions.c)

        variable_presets = Base.metadata.tables["activity_variable_presets"]
        self.assertFalse(variable_presets.c.var_type.nullable)
        self.assertFalse(variable_presets.c.value.nullable)
        self.assertFalse(variable_presets.c.label.nullable)

        generation_jobs = Base.metadata.tables["activity_generation_jobs"]
        self.assertTrue(generation_jobs.c.template_id.foreign_keys)
        self.assertTrue(generation_jobs.c.task_id.foreign_keys)
        self.assertTrue(generation_jobs.c.operator_id.foreign_keys)
        self.assertTrue(generation_jobs.c.model_config_id.foreign_keys)
        self.assertEqual(generation_jobs.c.status.default.arg, "pending")

        generation_batches = Base.metadata.tables["activity_generation_batches"]
        self.assertTrue(generation_batches.c.template_id.foreign_keys)
        self.assertTrue(generation_batches.c.task_id.foreign_keys)
        self.assertTrue(generation_batches.c.operator_id.foreign_keys)
        self.assertTrue(generation_batches.c.model_config_id.foreign_keys)
        self.assertIn("session_id", generation_batches.c)
        self.assertTrue(generation_batches.c.session_id.foreign_keys)
        self.assertEqual(generation_batches.c.status.default.arg, "draft")
        self.assertEqual(generation_batches.c.max_images.default.arg, 8)

        batch_images = Base.metadata.tables["activity_batch_images"]
        self.assertTrue(batch_images.c.batch_id.foreign_keys)
        self.assertTrue(batch_images.c.job_id.foreign_keys)
        self.assertTrue(batch_images.c.parent_image_id.foreign_keys)
        self.assertEqual(batch_images.c.status.default.arg, "pending")
        self.assertEqual(batch_images.c.sort_order.default.arg, 0)

        background_batches = Base.metadata.tables["background_generation_batches"]
        self.assertTrue(background_batches.c.created_by.foreign_keys)
        self.assertTrue(background_batches.c.session_id.foreign_keys)
        self.assertEqual(background_batches.c.whitespace_positions.type.__class__.__name__, "ARRAY")
        self.assertEqual(background_batches.c.mood.type.__class__.__name__, "ARRAY")
        self.assertEqual(background_batches.c.status.default.arg, "draft")
        self.assertEqual(background_batches.c.localized.default.arg, False)
        self.assertEqual(background_batches.c.game_feel.default.arg, "medium")
        self.assertEqual(background_batches.c.count.default.arg, 4)
        self.assertIn("extra_prompt", background_batches.c)

        background_images = Base.metadata.tables["background_images"]
        self.assertTrue(background_images.c.batch_id.foreign_keys)
        self.assertEqual(background_images.c.tags.type.__class__.__name__, "JSONB")
        self.assertEqual(background_images.c.review_status.default.arg, "pending")
        self.assertEqual(background_images.c.is_recommended.default.arg, False)
        self.assertEqual(background_images.c.use_count.default.arg, 0)

        final_images = Base.metadata.tables["final_images"]
        self.assertIn("source_type", final_images.c)
        self.assertIn("sub_category", final_images.c)
        self.assertIn("style_tag", final_images.c)
        self.assertEqual(final_images.c.source_type.default.arg, "expression")

        gallery_tags = Base.metadata.tables["gallery_tags"]
        self.assertFalse(gallery_tags.c.name.nullable)
        self.assertFalse(gallery_tags.c.source_type.nullable)
        self.assertIn("name_en", gallery_tags.c)
        self.assertIn("name_zh", gallery_tags.c)
        self.assertEqual(gallery_tags.c.image_count.default.arg, 0)

        users = Base.metadata.tables["users"]
        self.assertTrue(users.c.username.unique)
        self.assertFalse(users.c.password_hash.nullable)

        tasks = Base.metadata.tables["tasks"]
        self.assertEqual(tasks.c.status.default.arg, "created")
        self.assertTrue(tasks.c.creator_id.foreign_keys)

        review_logs = Base.metadata.tables["review_logs"]
        self.assertFalse(review_logs.c.status.nullable)
        self.assertTrue(review_logs.c.image_id.foreign_keys)

        daily_cost_stats = Base.metadata.tables["daily_cost_stats"]
        unique_columns = {
            column.name
            for constraint in daily_cost_stats.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
            for column in constraint.columns
        }
        self.assertEqual(unique_columns, {"stat_date", "user_id", "model_provider"})

        model_configs = Base.metadata.tables["model_configs"]
        self.assertFalse(model_configs.c.name.nullable)
        self.assertFalse(model_configs.c.provider.nullable)
        self.assertFalse(model_configs.c.model_name.nullable)
        self.assertFalse(model_configs.c.api_key.nullable)
        self.assertEqual(model_configs.c.usage_type.default.arg, "both")
        self.assertEqual(model_configs.c.price_per_image.default.arg, 0)
        self.assertEqual(model_configs.c.daily_limit.default.arg, 0)

        permissions = Base.metadata.tables["user_model_permissions"]
        unique_permission_columns = {
            column.name
            for constraint in permissions.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
            for column in constraint.columns
        }
        self.assertEqual(unique_permission_columns, {"user_id", "model_config_id"})
        self.assertTrue(permissions.c.user_id.foreign_keys)
        self.assertTrue(permissions.c.model_config_id.foreign_keys)
        self.assertTrue(permissions.c.granted_by.foreign_keys)

        asset_tags = Base.metadata.tables["asset_tags"]
        self.assertFalse(asset_tags.c.name.nullable)
        self.assertFalse(asset_tags.c.category.nullable)
        self.assertIn("name_en", asset_tags.c)
        self.assertIn("name_zh", asset_tags.c)
        self.assertIn("tag_group", asset_tags.c)
        self.assertTrue(asset_tags.c.tag_group.nullable)
        tag_unique_columns = {
            column.name
            for constraint in asset_tags.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
            for column in constraint.columns
        }
        self.assertEqual(tag_unique_columns, {"category", "name"})

        asset_tag_relations = Base.metadata.tables["asset_tag_relations"]
        self.assertTrue(asset_tag_relations.c.asset_id.foreign_keys)
        self.assertTrue(asset_tag_relations.c.tag_id.foreign_keys)

        assets = Base.metadata.tables["assets"]
        self.assertIn("use_count", assets.c)
        self.assertEqual(assets.c.use_count.default.arg, 0)

        workflow_types = Base.metadata.tables["workflow_types"]
        self.assertFalse(workflow_types.c.name.nullable)
        self.assertFalse(workflow_types.c.slug.nullable)
        self.assertTrue(workflow_types.c.slug.unique)
        self.assertEqual(workflow_types.c.active.default.arg, True)

        instructions = Base.metadata.tables["instructions"]
        self.assertFalse(instructions.c.name.nullable)
        self.assertFalse(instructions.c.content.nullable)
        self.assertTrue(instructions.c.workflow_type_id.foreign_keys)
        self.assertTrue(instructions.c.created_by.foreign_keys)
        self.assertEqual(instructions.c.active.default.arg, True)

        workflow_sessions = Base.metadata.tables["workflow_sessions"]
        self.assertFalse(workflow_sessions.c.workflow_type.nullable)
        self.assertFalse(workflow_sessions.c.mode.nullable)
        self.assertEqual(workflow_sessions.c.status.default.arg, "draft")
        self.assertEqual(workflow_sessions.c.current_step.default.arg, 1)
        self.assertTrue(workflow_sessions.c.task_id.foreign_keys)
        self.assertTrue(workflow_sessions.c.created_by.foreign_keys)

    def test_migration_sql_creates_core_tables(self):
        sql = (Path(__file__).resolve().parents[1] / "migrations" / "init.sql").read_text(
            encoding="utf-8"
        )
        created_tables = set(
            re.findall(r"CREATE TABLE IF NOT EXISTS ([a-z_]+)", sql, flags=re.IGNORECASE)
        )

        self.assertEqual(created_tables, self.expected_tables)
        self.assertIn("INSERT INTO roles", sql)
        self.assertIn("INSERT INTO users", sql)
        self.assertIn("INSERT INTO activity_template_types", sql)
        self.assertIn("INSERT INTO activity_variable_presets", sql)
        self.assertIn("ALTER TABLE activity_templates", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS activity_field_definitions", sql)
        self.assertIn("ALTER TABLE activity_generation_batches", sql)
        self.assertIn("ADD COLUMN IF NOT EXISTS session_id INT REFERENCES workflow_sessions(id)", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS background_generation_batches", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS background_images", sql)
        self.assertIn("ALTER TABLE assets ADD COLUMN IF NOT EXISTS use_count INT DEFAULT 0", sql)
        self.assertIn("tag_group VARCHAR(50) DEFAULT NULL", sql)
        self.assertIn("ALTER TABLE asset_tags ADD COLUMN IF NOT EXISTS tag_group VARCHAR(50) DEFAULT NULL", sql)
        self.assertIn("('活动', 'background', 'purpose')", sql)
        self.assertIn("('暖色调', 'background', 'color_style')", sql)
        self.assertIn("whitespace_positions", sql)
        self.assertIn("CHECK (template_no ~ '^T(0[1-9]|1[0-9]|2[0-5])$')", sql)


if __name__ == "__main__":
    unittest.main()
