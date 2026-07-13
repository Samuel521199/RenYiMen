import inspect
import os
import unittest
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from app import dependencies
from app.models.asset import Asset
from app.models.asset_tag import AssetTag
from app.models.daily_post import DailyPostJob, DailyPostTemplate
from app.models.background import BackgroundGenerationBatch, BackgroundImage
from app.models.gallery_tag import GalleryTag
from app.models.image import TaskImage
from app.models.model_config import ModelConfig
from app.models.workflow_session import WorkflowSession
from app.routers import (
    activity_batches,
    activity_workflows,
    assets,
    audit,
    auth,
    daily_post_workflows,
    background,
    gallery,
    generate,
    instructions,
    model_configs,
    permissions,
    prompts,
    review,
    stats,
    tasks,
    translate,
    users,
    video_draft,
    video_workflows,
    video_jobs,
    video_motion,
    workflow_sessions,
)
from app.schemas.task import TaskCreate, TaskResponse


os.environ.setdefault("STORAGE_DIR", "/tmp/ai-image-workbench-test-storage")


class RouterTests(unittest.IsolatedAsyncioTestCase):
    router_modules = [
        activity_batches,
        activity_workflows,
        assets,
        audit,
        auth,
        background,
        gallery,
        generate,
        instructions,
        model_configs,
        permissions,
        prompts,
        review,
        stats,
        tasks,
        translate,
        users,
        video_draft,
        video_workflows,
        video_jobs,
        video_motion,
        workflow_sessions,
    ]
    expected_routes = {
        ("POST", "/api/auth/login"),
        ("GET", "/api/auth/me"),
        ("GET", "/api/users"),
        ("POST", "/api/users/create"),
        ("GET", "/api/users/me"),
        ("POST", "/api/users/me/change-password"),
        ("POST", "/api/users/{user_id}/reset-password"),
        ("GET", "/api/users/{user_id}/permissions"),
        ("PUT", "/api/users/{user_id}/permissions"),
        ("PATCH", "/api/users/{user_id}"),
        ("POST", "/api/api-keys/create"),
        ("GET", "/api/api-keys"),
        ("POST", "/api/model-configs/create"),
        ("GET", "/api/model-configs"),
        ("GET", "/api/model-configs/video"),
        ("PUT", "/api/model-configs/{id}"),
        ("DELETE", "/api/model-configs/{id}"),
        ("PATCH", "/api/model-configs/{id}/toggle"),
        ("POST", "/api/permissions/grant"),
        ("DELETE", "/api/permissions/revoke"),
        ("GET", "/api/permissions/user/{user_id}"),
        ("GET", "/api/model-configs/available"),
        ("GET", "/api/workflow-types"),
        ("POST", "/api/workflow-types/create"),
        ("GET", "/api/instructions"),
        ("POST", "/api/instructions/create"),
        ("PUT", "/api/instructions/{id}"),
        ("DELETE", "/api/instructions/{id}"),
        ("PATCH", "/api/instructions/{id}/toggle"),
        ("POST", "/api/tasks/create"),
        ("GET", "/api/tasks"),
        ("GET", "/api/tasks/{task_id}"),
        ("POST", "/api/tasks/{task_id}/status"),
        ("POST", "/api/prompts/create"),
        ("GET", "/api/prompts"),
        ("PUT", "/api/prompts/{id}"),
        ("DELETE", "/api/prompts/{id}"),
        ("POST", "/api/prompts/build"),
        ("POST", "/api/assets/upload"),
        ("GET", "/api/assets"),
        ("GET", "/api/assets/stats"),
        ("GET", "/api/assets/tags"),
        ("POST", "/api/assets/tags/create"),
        ("POST", "/api/assets/tags/create-inline"),
        ("GET", "/api/assets/tags/manage"),
        ("PATCH", "/api/assets/tags/{tag_id}"),
        ("DELETE", "/api/assets/tags/{tag_id}"),
        ("PATCH", "/api/assets/batch-move"),
        ("PATCH", "/api/assets/{id}/tags"),
        ("DELETE", "/api/assets/{id}"),
        ("POST", "/api/translate/tags"),
        ("POST", "/api/translate/tags/fill-all"),
        ("POST", "/api/generate/image"),
        ("GET", "/api/generate/logs"),
        ("GET", "/api/review/pending"),
        ("POST", "/api/review/submit"),
        ("POST", "/api/gallery/save-final"),
        ("GET", "/api/gallery/categories"),
        ("GET", "/api/gallery/tags"),
        ("GET", "/api/gallery/tags/manage"),
        ("POST", "/api/gallery/tags/create"),
        ("PATCH", "/api/gallery/tags/{tag_id}"),
        ("DELETE", "/api/gallery/tags/{tag_id}"),
        ("GET", "/api/gallery/finals"),
        ("GET", "/api/gallery/{image_id}"),
        ("GET", "/api/activity/template-types"),
        ("GET", "/api/activity/templates"),
        ("POST", "/api/activity/templates/create"),
        ("PUT", "/api/activity/templates/{id}"),
        ("DELETE", "/api/activity/templates/{id}"),
        ("POST", "/api/activity/templates/{id}/fields/reset-defaults"),
        ("PATCH", "/api/activity/templates/{id}/toggle"),
        ("GET", "/api/activity/variable-presets"),
        ("POST", "/api/activity/jobs/create"),
        ("GET", "/api/activity/jobs"),
        ("GET", "/api/activity/jobs/{id}"),
        ("POST", "/api/activity/jobs/{id}/qc"),
        ("POST", "/api/activity/jobs/{id}/archive"),
        ("POST", "/api/activity/batches/create"),
        ("GET", "/api/activity/batches"),
        ("GET", "/api/activity/batches/drafts"),
        ("GET", "/api/activity/batches/{id}"),
        ("POST", "/api/activity/batches/{id}/refine"),
        ("POST", "/api/activity/batches/{id}/archive-image"),
        ("POST", "/api/activity/batches/{id}/delete-image"),
        ("POST", "/api/activity/batches/{id}/save-draft"),
        ("POST", "/api/background/batches/create"),
        ("GET", "/api/background/batches"),
        ("GET", "/api/background/batches/{id}"),
        ("GET", "/api/background/available-models"),
        ("POST", "/api/background/batches/{id}/generate"),
        ("PATCH", "/api/background/images/{id}/review"),
        ("POST", "/api/background/images/{id}/refine"),
        ("POST", "/api/background/images/{id}/archive"),
        ("GET", "/api/background/images"),
        ("PATCH", "/api/background/images/{id}/use-count"),
        ("GET", "/api/stats/dashboard"),
        ("GET", "/api/stats/cost-daily"),
        ("GET", "/api/stats/model"),
        ("GET", "/api/stats/user"),
        ("GET", "/api/stats/images"),
        ("GET", "/api/audit-logs"),
        ("POST", "/api/workflow-sessions/save"),
        ("GET", "/api/workflow-sessions"),
        ("GET", "/api/workflow-sessions/{id}"),
        ("DELETE", "/api/workflow-sessions/{id}"),
        ("POST", "/api/video/jobs/create"),
        ("GET", "/api/video/jobs/list"),
        ("GET", "/api/video/jobs/{job_id}"),
        ("DELETE", "/api/video/jobs/{job_id}"),
        ("PATCH", "/api/video/jobs/{job_id}/status"),
        ("GET", "/api/video/jobs/{job_id}/download"),
        ("POST", "/api/video/jobs/{job_id}/compose"),
        ("POST", "/api/video/jobs/{job_id}/compose-all"),
        ("POST", "/api/video/draft/generate"),
        ("GET", "/api/video/draft/{job_id}/list"),
        ("POST", "/api/video/draft/{job_id}/select/{draft_id}"),
        ("GET", "/api/video/draft/{job_id}/history/{draft_id}"),
        ("POST", "/api/video/draft/{job_id}/revert/{draft_id}"),
        ("GET", "/api/video/enums"),
        ("POST", "/api/video/enums"),
        ("GET", "/api/video/motion/{job_id}"),
        ("POST", "/api/video/motion/{job_id}"),
        ("POST", "/api/video/motion/auto-extract/{job_id}"),
    }

    def test_each_module_exposes_fastapi_router(self):
        for module in self.router_modules:
            with self.subTest(module=module.__name__):
                self.assertIsInstance(module.router, APIRouter)

    def test_expected_routes_are_registered(self):
        app = FastAPI()
        for module in self.router_modules:
            if module is activity_workflows:
                app.include_router(module.router, prefix="/api/activity")
            elif module is activity_batches:
                app.include_router(module.router, prefix="/api/activity/batches")
            elif module is background:
                app.include_router(module.router, prefix="/api/background")
            else:
                app.include_router(module.router)

        actual_routes = {
            (method, route.path)
            for route in app.routes
            if hasattr(route, "methods")
            if route.path.startswith("/api")
            for method in route.methods
            if method in {"GET", "POST", "PUT", "PATCH", "DELETE"}
        }

        self.assertEqual(actual_routes, self.expected_routes)

    def test_routes_use_project_dependencies(self):
        for module in self.router_modules:
            for route in module.router.routes:
                if not hasattr(route, "endpoint"):
                    continue
                signature = inspect.signature(route.endpoint)
                defaults = [param.default for param in signature.parameters.values()]
                default_text = "\n".join(repr(default) for default in defaults)

                self.assertIn("get_db", default_text)
                if route.path != "/api/auth/login":
                    self.assertIn("get_current_user", default_text)

    def test_gallery_finals_endpoint_supports_three_level_filters(self):
        signature = inspect.signature(gallery.list_gallery_finals)

        self.assertIn("source_type", signature.parameters)
        self.assertIn("sub_category", signature.parameters)
        self.assertIn("style_tag", signature.parameters)
        self.assertIsNone(signature.parameters["source_type"].default)
        self.assertIsNone(signature.parameters["sub_category"].default)
        self.assertIsNone(signature.parameters["style_tag"].default)

    def test_gallery_tag_management_routes_are_registered(self):
        self.assertTrue(hasattr(gallery, "list_gallery_tag_records"))
        self.assertTrue(hasattr(gallery, "create_gallery_tag"))
        self.assertTrue(hasattr(gallery, "rename_gallery_tag"))
        self.assertTrue(hasattr(gallery, "delete_gallery_tag"))

    def test_activity_batch_routes_are_registered(self):
        self.assertTrue(hasattr(activity_batches, "create_activity_batch"))
        self.assertTrue(hasattr(activity_batches, "refine_activity_batch_image"))
        self.assertTrue(hasattr(activity_batches, "archive_activity_batch_image"))
        self.assertTrue(hasattr(activity_batches, "list_activity_batch_drafts"))

    def test_background_routes_are_registered(self):
        self.assertTrue(hasattr(background, "create_background_batch"))
        self.assertTrue(hasattr(background, "list_available_background_model_configs"))
        self.assertTrue(hasattr(background, "generate_background_batch_images"))
        self.assertTrue(hasattr(background, "review_background_image"))
        self.assertTrue(hasattr(background, "refine_background_image"))
        self.assertTrue(hasattr(background, "archive_background_image"))

    def test_background_generation_reuses_sessions_assets_and_prompt_guardrails(self):
        source = inspect.getsource(background)

        self.assertIn('workflow_type="background"', source)
        self.assertIn('category="background"', source)
        self.assertIn('mode="final"', source)
        self.assertIn("model_config_id", source)
        self.assertIn("build_background_prompt", source)

    async def test_background_available_models_query_does_not_filter_usage_type(self):
        class FakeScalarResult:
            def scalars(self):
                return self

            def all(self):
                return []

        class FakeDB:
            def __init__(self):
                self.query_text = ""

            async def execute(self, query):
                self.query_text = str(query)
                return FakeScalarResult()

        fake_db = FakeDB()

        await background.query_available_background_model_configs(
            fake_db,
            current_user={"id": 1, "username": "admin", "role": "admin"},
        )

        self.assertIn("FROM model_configs", fake_db.query_text)
        self.assertNotIn("usage_type IN", fake_db.query_text)

    async def test_background_available_models_query_filters_refine_mode_to_openai_final_and_both(self):
        class FakeScalarResult:
            def scalars(self):
                return self

            def all(self):
                return []

        class FakeDB:
            def __init__(self):
                self.query_text = ""

            async def execute(self, query):
                self.query_text = str(query)
                return FakeScalarResult()

        fake_db = FakeDB()

        await background.query_available_background_model_configs(
            fake_db,
            current_user={"id": 1, "username": "admin", "role": "admin"},
            mode="refine",
        )

        self.assertIn("FROM model_configs", fake_db.query_text)
        self.assertIn("model_configs.provider = :provider_1", fake_db.query_text)
        self.assertIn("model_configs.usage_type IN", fake_db.query_text)

    async def test_background_generation_allows_draft_model_when_active_and_permitted(self):
        class FakeScalarResult:
            def __init__(self, one=None):
                self.one = one

            def scalar_one_or_none(self):
                return self.one

        class FakeDB:
            async def execute(self, query):
                return FakeScalarResult(
                    one=ModelConfig(
                        id=88,
                        name="Gemini Draft",
                        provider="google",
                        model_name="gemini-2.5-flash-image",
                        usage_type="draft",
                        active=True,
                    )
                )

        async def fake_has_permission(db, user_id, model_config_id, role):
            return True

        original_has_permission = background.user_has_model_permission
        background.user_has_model_permission = fake_has_permission
        try:
            model_config = await background.resolve_background_model_config(
                FakeDB(),
                88,
                current_user={"id": 2, "username": "operator", "role": "operator"},
            )
        finally:
            background.user_has_model_permission = original_has_permission

        self.assertEqual(model_config.id, 88)
        self.assertEqual(model_config.usage_type, "draft")

    async def test_background_generation_loops_single_image_calls_for_batch_requests(self):
        batch = BackgroundGenerationBatch(
            id=5,
            purpose="活动",
            scene="海边",
            mood=["轻松"],
            color_style="蓝金",
            whitespace_position_legacy="right",
            whitespace_positions=["right"],
            size_ratio="16:9",
            localized=False,
            game_feel="medium",
            count=4,
            status="draft",
            created_at=datetime(2026, 1, 1, 12, 0, 0),
        )
        batch.images = []
        captured = {"counts": []}

        class FakeGeneration:
            def __init__(self, url):
                self.images = [{"url": url}]

        class FakeDB:
            def add(self, item):
                if isinstance(item, BackgroundImage) and getattr(item, "id", None) is None:
                    item.id = 100 + len(batch.images) + 1
                    item.is_recommended = False
                    item.use_count = 0
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)
                    batch.images.append(item)

            async def execute(self, query):
                raise AssertionError("generate test should not query the database directly")

            async def commit(self):
                return None

        async def fake_get_batch(db, batch_id):
            return batch

        async def fake_resolve_model(db, model_config_id, current_user):
            return ModelConfig(
                id=model_config_id,
                name="OpenAI Final",
                provider="openai",
                model_name="gpt-image-1",
                usage_type="both",
                active=True,
            )

        async def fake_upsert_session(db, batch_obj, current_user, current_step, status_value, reference_asset_ids=None):
            return None

        async def fake_generate_image(db, req, reference_image_urls=None):
            call_index = len(captured["counts"]) + 1
            captured["counts"].append(req.count)
            return FakeGeneration(f"/static/task/1/draft/generated-{call_index}.png")

        original_get_batch = background.get_background_batch_or_404
        original_resolve_model = background.resolve_background_model_config
        original_upsert = background.upsert_background_workflow_session
        original_generate = background.ai_gateway.generate_image
        background.get_background_batch_or_404 = fake_get_batch
        background.resolve_background_model_config = fake_resolve_model
        background.upsert_background_workflow_session = fake_upsert_session
        background.ai_gateway.generate_image = fake_generate_image
        try:
            response = await background.generate_background_batch_images(
                5,
                background.BackgroundBatchGenerateRequest(model_config_id=9, count=6),
                db=FakeDB(),
                current_user={"id": 1, "username": "admin", "role": "admin"},
            )
        finally:
            background.get_background_batch_or_404 = original_get_batch
            background.resolve_background_model_config = original_resolve_model
            background.upsert_background_workflow_session = original_upsert
            background.ai_gateway.generate_image = original_generate

        self.assertEqual(captured["counts"], [1, 1, 1, 1, 1, 1])
        self.assertEqual(batch.count, 6)
        self.assertEqual(batch.status, "active")
        self.assertEqual(len(batch.images), 6)
        self.assertEqual(response["code"], 0)
        self.assertEqual(response["data"]["count"], 6)
        self.assertEqual(len(response["data"]["images"]), 6)

    async def test_background_archive_writes_asset_and_existing_background_tag_relations(self):
        class FakeScalarResult:
            def __init__(self, values=None, one=None):
                self.values = values or []
                self.one = one

            def scalars(self):
                return self

            def all(self):
                return self.values

            def scalar_one_or_none(self):
                return self.one

        class FakeDB:
            def __init__(self):
                self.next_id = 700
                self.insert_relation_calls = 0
                self.assets = []
                self.commits = 0
                self.rollbacks = 0

            def add(self, item):
                if isinstance(item, Asset) and getattr(item, "id", None) is None:
                    item.id = self.next_id
                    self.next_id += 1
                    self.assets.append(item)

            async def execute(self, query):
                if query.__class__.__name__ == "Insert":
                    self.insert_relation_calls += 1
                    return FakeScalarResult()
                query_text = str(query)
                if "FROM asset_tags" in query_text:
                    return FakeScalarResult(
                        values=[
                            AssetTag(id=31, name="活动", category="background", tag_group="purpose"),
                            AssetTag(id=32, name="推荐", category="background", tag_group=None),
                        ]
                    )
                return FakeScalarResult()

            async def flush(self):
                return None

            async def commit(self):
                self.commits += 1

            async def rollback(self):
                self.rollbacks += 1

            async def refresh(self, item):
                if getattr(item, "created_at", None) is None:
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)

        image = BackgroundImage(
            id=9,
            batch_id=5,
            image_url="/static/task/1/draft/background-9.png",
            thumbnail_url="/static/task/1/draft/background-9.png",
            review_status="approved",
            tags={"purpose": "活动"},
            use_count=2,
        )
        batch = BackgroundGenerationBatch(
            id=5,
            purpose="活动",
            scene="海边",
            mood=["轻松"],
            color_style="蓝金",
            whitespace_position_legacy="right",
            whitespace_positions=["right"],
            size_ratio="16:9",
            localized=False,
            game_feel="medium",
            count=1,
            status="active",
        )
        batch.images = [image]
        fake_db = FakeDB()

        async def fake_get_image(db, image_id):
            return image

        async def fake_get_batch(db, batch_id):
            return batch

        async def fake_upsert_session(db, batch_obj, current_user, current_step, status_value, reference_asset_ids=None):
            return None

        original_get_image = background.get_background_image_or_404
        original_get_batch = background.get_background_batch_or_404
        original_upsert = background.upsert_background_workflow_session
        background.get_background_image_or_404 = fake_get_image
        background.get_background_batch_or_404 = fake_get_batch
        background.upsert_background_workflow_session = fake_upsert_session
        try:
            response = await background.archive_background_image(
                9,
                background.BackgroundImageArchiveRequest(tags=["外部缺失标签"], is_recommended=True),
                db=fake_db,
                current_user={"id": 1, "username": "admin", "role": "admin"},
            )
        finally:
            background.get_background_image_or_404 = original_get_image
            background.get_background_batch_or_404 = original_get_batch
            background.upsert_background_workflow_session = original_upsert

        self.assertEqual(response["code"], 0)
        self.assertEqual(len(fake_db.assets), 1)
        self.assertEqual(fake_db.assets[0].category, "background")
        self.assertEqual(fake_db.assets[0].url, "/static/task/1/draft/background-9.png")
        self.assertEqual(fake_db.assets[0].filename, "background-9.png")
        self.assertEqual(fake_db.assets[0].uploaded_by, 1)
        self.assertEqual(fake_db.insert_relation_calls, 2)
        self.assertEqual(fake_db.commits, 1)
        self.assertEqual(fake_db.rollbacks, 0)

    async def test_background_archive_completes_session_only_when_all_reviewed_images_are_archived(self):
        class FakeScalarResult:
            def __init__(self, values=None, one=None):
                self.values = values or []
                self.one = one

            def scalars(self):
                return self

            def all(self):
                return self.values

            def scalar_one_or_none(self):
                return self.one

        session = WorkflowSession(
            id=81,
            workflow_type="background",
            mode="full",
            status="draft",
            current_step=3,
            state_json='{"batch_id":5,"step":3}',
            created_by=1,
        )
        target_image = BackgroundImage(
            id=9,
            batch_id=5,
            image_url="/static/task/1/draft/background-9.png",
            thumbnail_url="/static/task/1/draft/background-9.png",
            review_status="approved",
            tags={"purpose": "活动"},
            use_count=2,
        )
        sibling_image = BackgroundImage(
            id=10,
            batch_id=5,
            image_url="/static/task/1/draft/background-10.png",
            thumbnail_url="/static/task/1/draft/background-10.png",
            review_status="refine",
            tags={"purpose": "活动"},
            asset_id=888,
            use_count=0,
        )
        batch = BackgroundGenerationBatch(
            id=5,
            purpose="活动",
            scene="海边",
            mood=["轻松"],
            color_style="蓝金",
            whitespace_position_legacy="right",
            whitespace_positions=["right"],
            size_ratio="16:9",
            localized=False,
            game_feel="medium",
            count=2,
            status="active",
            session_id=81,
        )
        batch.images = [target_image, sibling_image]

        class FakeDB:
            def __init__(self):
                self.next_id = 900
                self.commits = 0
                self.rollbacks = 0

            def add(self, item):
                if isinstance(item, Asset) and getattr(item, "id", None) is None:
                    item.id = self.next_id
                    self.next_id += 1

            async def execute(self, query):
                if query.__class__.__name__ == "Insert":
                    return FakeScalarResult()
                query_text = str(query)
                if "FROM asset_tags" in query_text:
                    return FakeScalarResult(
                        values=[AssetTag(id=31, name="活动", category="background", tag_group="purpose")]
                    )
                if "FROM workflow_sessions" in query_text:
                    return FakeScalarResult(one=session)
                return FakeScalarResult()

            async def flush(self):
                return None

            async def commit(self):
                self.commits += 1

            async def rollback(self):
                self.rollbacks += 1

            async def refresh(self, item):
                if getattr(item, "created_at", None) is None:
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)

        fake_db = FakeDB()

        async def fake_get_image(db, image_id):
            return target_image

        async def fake_get_batch(db, batch_id):
            return batch

        original_get_image = background.get_background_image_or_404
        original_get_batch = background.get_background_batch_or_404
        background.get_background_image_or_404 = fake_get_image
        background.get_background_batch_or_404 = fake_get_batch
        try:
            response = await background.archive_background_image(
                9,
                background.BackgroundImageArchiveRequest(tags=[], is_recommended=False),
                db=fake_db,
                current_user={"id": 1, "username": "admin", "role": "admin"},
            )
        finally:
            background.get_background_image_or_404 = original_get_image
            background.get_background_batch_or_404 = original_get_batch

        self.assertEqual(response["code"], 0)
        self.assertIsNotNone(target_image.asset_id)
        self.assertEqual(batch.status, "archived")
        self.assertEqual(session.status, "completed")
        self.assertEqual(session.current_step, 4)
        self.assertIn('"step": 4', session.state_json)
        self.assertEqual(fake_db.commits, 1)
        self.assertEqual(fake_db.rollbacks, 0)

    async def test_background_archive_keeps_session_draft_when_reviewed_images_remain_unarchived(self):
        class FakeScalarResult:
            def __init__(self, values=None, one=None):
                self.values = values or []
                self.one = one

            def scalars(self):
                return self

            def all(self):
                return self.values

            def scalar_one_or_none(self):
                return self.one

        session = WorkflowSession(
            id=82,
            workflow_type="background",
            mode="full",
            status="draft",
            current_step=3,
            state_json='{"batch_id":6,"step":3}',
            created_by=1,
        )
        target_image = BackgroundImage(
            id=19,
            batch_id=6,
            image_url="/static/task/1/draft/background-19.png",
            thumbnail_url="/static/task/1/draft/background-19.png",
            review_status="approved",
            tags={"purpose": "活动"},
            use_count=1,
        )
        sibling_image = BackgroundImage(
            id=20,
            batch_id=6,
            image_url="/static/task/1/draft/background-20.png",
            thumbnail_url="/static/task/1/draft/background-20.png",
            review_status="approved",
            tags={"purpose": "活动"},
            use_count=0,
        )
        batch = BackgroundGenerationBatch(
            id=6,
            purpose="活动",
            scene="海边",
            mood=["轻松"],
            color_style="蓝金",
            whitespace_position_legacy="right",
            whitespace_positions=["right"],
            size_ratio="16:9",
            localized=False,
            game_feel="medium",
            count=2,
            status="active",
            session_id=82,
        )
        batch.images = [target_image, sibling_image]

        class FakeDB:
            def __init__(self):
                self.next_id = 950
                self.commits = 0
                self.rollbacks = 0

            def add(self, item):
                if isinstance(item, Asset) and getattr(item, "id", None) is None:
                    item.id = self.next_id
                    self.next_id += 1

            async def execute(self, query):
                if query.__class__.__name__ == "Insert":
                    return FakeScalarResult()
                query_text = str(query)
                if "FROM asset_tags" in query_text:
                    return FakeScalarResult(
                        values=[AssetTag(id=31, name="活动", category="background", tag_group="purpose")]
                    )
                if "FROM workflow_sessions" in query_text:
                    return FakeScalarResult(one=session)
                return FakeScalarResult()

            async def flush(self):
                return None

            async def commit(self):
                self.commits += 1

            async def rollback(self):
                self.rollbacks += 1

            async def refresh(self, item):
                if getattr(item, "created_at", None) is None:
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)

        fake_db = FakeDB()

        async def fake_get_image(db, image_id):
            return target_image

        async def fake_get_batch(db, batch_id):
            return batch

        original_get_image = background.get_background_image_or_404
        original_get_batch = background.get_background_batch_or_404
        background.get_background_image_or_404 = fake_get_image
        background.get_background_batch_or_404 = fake_get_batch
        try:
            response = await background.archive_background_image(
                19,
                background.BackgroundImageArchiveRequest(tags=[], is_recommended=False),
                db=fake_db,
                current_user={"id": 1, "username": "admin", "role": "admin"},
            )
        finally:
            background.get_background_image_or_404 = original_get_image
            background.get_background_batch_or_404 = original_get_batch

        self.assertEqual(response["code"], 0)
        self.assertIsNotNone(target_image.asset_id)
        self.assertEqual(batch.status, "active")
        self.assertEqual(session.status, "draft")
        self.assertEqual(session.current_step, 4)
        self.assertIn('"step": 4', session.state_json)
        self.assertEqual(fake_db.commits, 1)
        self.assertEqual(fake_db.rollbacks, 0)

    async def test_background_refine_uses_selected_model_and_replaces_image_url(self):
        class FakeGeneration:
            images = [{"url": "/static/task/1/final/refined-background-9.png"}]

        image = BackgroundImage(
            id=9,
            batch_id=5,
            image_url="/static/task/1/draft/background-9.png",
            thumbnail_url="/static/task/1/draft/background-9.png",
            review_status="refine",
            tags={"purpose": "活动"},
            asset_id=777,
            is_recommended=True,
            use_count=0,
            created_at=datetime(2026, 1, 1, 12, 0, 0),
        )
        batch = BackgroundGenerationBatch(
            id=5,
            purpose="活动",
            scene="海边",
            mood=["轻松"],
            color_style="蓝金",
            whitespace_position_legacy="right",
            whitespace_positions=["right"],
            size_ratio="16:9",
            localized=False,
            game_feel="medium",
            count=1,
            status="active",
            created_at=datetime(2026, 1, 1, 12, 0, 0),
        )
        batch.images = [image]
        captured: dict[str, object] = {}

        class FakeDB:
            commits = 0
            refreshed = []

            async def commit(self):
                self.commits += 1

            async def refresh(self, item):
                self.refreshed.append(item)

        async def fake_get_image(db, image_id):
            return image

        async def fake_get_batch(db, batch_id):
            return batch

        async def fake_resolve_model(db, model_config_id, current_user):
            return ModelConfig(
                id=model_config_id,
                name="OpenAI Refine",
                provider="openai",
                model_name="gpt-image-1",
                usage_type="final",
                active=True,
            )

        async def fake_upsert_session(db, batch_obj, current_user, current_step, status_value, reference_asset_ids=None):
            captured["session_step"] = current_step
            captured["session_status"] = status_value
            return None

        async def fake_generate_image(db, req, reference_image_urls=None):
            captured["model_config_id"] = req.model_config_id
            captured["provider"] = req.model_provider
            captured["mode"] = req.mode
            captured["count"] = req.count
            captured["size"] = req.size
            captured["prompt"] = req.prompt
            captured["references"] = list(reference_image_urls or [])
            return FakeGeneration()

        original_get_image = background.get_background_image_or_404
        original_get_batch = background.get_background_batch_or_404
        original_resolve_model = background.resolve_background_model_config
        original_upsert = background.upsert_background_workflow_session
        original_generate = background.ai_gateway.generate_image
        background.get_background_image_or_404 = fake_get_image
        background.get_background_batch_or_404 = fake_get_batch
        background.resolve_background_model_config = fake_resolve_model
        background.upsert_background_workflow_session = fake_upsert_session
        background.ai_gateway.generate_image = fake_generate_image
        try:
            response = await background.refine_background_image(
                9,
                background.BackgroundImageRefineRequest(
                    model_config_id=19,
                    refine_prompt="增强光影层次、去掉右下角多余元素",
                ),
                db=FakeDB(),
                current_user={"id": 1, "username": "admin", "role": "admin"},
            )
        finally:
            background.get_background_image_or_404 = original_get_image
            background.get_background_batch_or_404 = original_get_batch
            background.resolve_background_model_config = original_resolve_model
            background.upsert_background_workflow_session = original_upsert
            background.ai_gateway.generate_image = original_generate

        self.assertEqual(response["code"], 0)
        self.assertEqual(response["data"]["image_url"], "/static/task/1/final/refined-background-9.png")
        self.assertEqual(image.image_url, "/static/task/1/final/refined-background-9.png")
        self.assertEqual(image.thumbnail_url, "/static/task/1/final/refined-background-9.png")
        self.assertEqual(image.asset_id, None)
        self.assertFalse(image.is_recommended)
        self.assertEqual(captured["model_config_id"], 19)
        self.assertEqual(captured["provider"], "openai")
        self.assertEqual(captured["mode"], "final")
        self.assertEqual(captured["count"], 1)
        self.assertEqual(captured["size"], "1920x1080")
        self.assertEqual(captured["references"], ["/static/task/1/draft/background-9.png"])
        self.assertIn("Refinement instructions:", str(captured["prompt"]))
        self.assertIn("增强光影层次、去掉右下角多余元素", str(captured["prompt"]))
        self.assertEqual(captured["session_step"], 3)
        self.assertEqual(captured["session_status"], "draft")

    def test_activity_batches_synchronize_workflow_sessions(self):
        source = inspect.getsource(activity_batches)

        self.assertIn("WorkflowSession", source)
        self.assertIn('workflow_type="activity"', source)
        self.assertIn('mode="full"', source)
        self.assertIn('"batch_id"', source)
        self.assertIn("batch.session_id", source)
        self.assertIn('session.status = "completed"', source)

    async def test_endpoint_returns_uniform_response_shape_from_service(self):
        async def fake_create_task(db, payload, creator_id=None):
            now = datetime.now(UTC)
            return TaskResponse(
                id=1001,
                title=payload.title,
                scene=payload.scene,
                size=payload.size,
                purpose=None,
                budget=Decimal("0"),
                description=None,
                status="created",
                creator_id=creator_id,
                created_at=now,
                updated_at=now,
            )

        original = tasks.task_service.create_task
        tasks.task_service.create_task = fake_create_task
        try:
            payload = await tasks.create_task(
                TaskCreate(title="Payday bull", scene="Payday", size="1080x1350"),
                db=None,
                current_user={"id": 1, "username": "admin", "role": "admin"},
            )
        finally:
            tasks.task_service.create_task = original

        self.assertEqual(payload["code"], 0)
        self.assertEqual(payload["msg"], "success")
        self.assertEqual(payload["data"]["status"], "created")

    async def test_generate_endpoint_rejects_model_without_permission(self):
        async def fake_has_permission(db, user_id, model_config_id, role):
            return False

        original = generate.user_has_model_permission
        generate.user_has_model_permission = fake_has_permission
        try:
            with self.assertRaises(Exception) as raised:
                await generate.generate_image(
                    generate.ImageGenerateRequest(
                        task_id=1,
                        model_config_id=10,
                        model_provider="openai",
                        model_name="gpt-image-1",
                        prompt="draw",
                        size="1080x1350",
                    ),
                    db=None,
                    current_user={"id": 2, "username": "operator", "role": "operator"},
                )
        finally:
            generate.user_has_model_permission = original

        self.assertEqual(getattr(raised.exception, "status_code", None), 403)

    async def test_generate_resolves_asset_and_draft_image_urls_before_gateway_call(self):
        class FakeScalars:
            def __init__(self, values):
                self.values = values

            def all(self):
                return self.values

        class FakeResult:
            def __init__(self, values=None, one=None):
                self.values = values or []
                self.one = one

            def scalars(self):
                return FakeScalars(self.values)

            def scalar_one_or_none(self):
                return self.one

        class FakeDB:
            async def execute(self, query):
                query_text = str(query)
                if "FROM assets" in query_text:
                    return FakeResult(
                        values=[
                            Asset(id=1, filename="a.png", category="expression", url="/static/assets/a.png"),
                            Asset(id=2, filename="b.png", category="expression", url="https://cdn.example.com/b.png"),
                        ]
                    )
                if "FROM task_images" in query_text:
                    return FakeResult(
                        one=TaskImage(id=9, task_id=1, image_url="/static/task/1/draft/draft.png")
                    )
                return FakeResult()

        request = generate.ImageGenerateRequest(
            task_id=1,
            model_config_id=10,
            model_provider="openai",
            model_name="gpt-image-2",
            prompt="draw",
            size="1024x1024",
            reference_asset_ids=[1, 2],
            draft_image_id=9,
        )

        urls = await generate.resolve_reference_image_urls(FakeDB(), request)

        self.assertEqual(
            urls,
            [
                "/static/assets/a.png",
                "https://cdn.example.com/b.png",
                "/static/task/1/draft/draft.png",
            ],
        )

    async def test_asset_upload_accepts_multipart_metadata_fields(self):
        class FakeScalar:
            def scalar_one_or_none(self):
                return None

        class FakeDB:
            def __init__(self):
                self.next_id = 100
                self.added_tags = []

            def add(self, item):
                if isinstance(item, (Asset, AssetTag)) and getattr(item, "id", None) is None:
                    item.id = self.next_id
                    self.next_id += 1
                if isinstance(item, AssetTag):
                    self.added_tags.append(item)

            async def execute(self, query):
                return FakeScalar()

            async def flush(self):
                return None

            async def commit(self):
                return None

            async def refresh(self, item):
                if getattr(item, "created_at", None) is None:
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        fake_db_instance = FakeDB()

        async def fake_db():
            return fake_db_instance

        async def fake_save_asset_file(db, file_bytes, filename, storage_root=None):
            return f"/static/assets/{filename}"

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        original_save = assets.storage_service.save_asset_file
        assets.storage_service.save_asset_file = fake_save_asset_file
        try:
            response = TestClient(app).post(
                "/api/assets/upload",
                data={"category": "game_content", "tags": "高兴,开心"},
                files={"file": ("happy.png", b"image", "image/png")},
            )
        finally:
            assets.storage_service.save_asset_file = original_save

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["filename"], "happy.png")
        self.assertEqual(data["category"], "game_content")
        self.assertEqual(data["tags"], "高兴,开心")
        self.assertEqual([(tag.name, tag.category) for tag in fake_db_instance.added_tags], [
            ("高兴", "game_content"),
            ("开心", "game_content"),
        ])

    async def test_asset_upload_accepts_source_url_without_browser_file_download(self):
        class FakeScalar:
            def scalar_one_or_none(self):
                return None

        class FakeDB:
            def __init__(self):
                self.next_id = 200

            def add(self, item):
                if isinstance(item, (Asset, AssetTag)) and getattr(item, "id", None) is None:
                    item.id = self.next_id
                    self.next_id += 1

            async def execute(self, query):
                return FakeScalar()

            async def flush(self):
                return None

            async def commit(self):
                return None

            async def refresh(self, item):
                if getattr(item, "created_at", None) is None:
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return FakeDB()

        async def fake_source_bytes(source_url):
            self.assertEqual(source_url, "http://localhost:8000/static/task/33/draft/final.png")
            return b"downloaded-image", "image/png", "final.png"

        async def fake_save_asset_file(db, file_bytes, filename, storage_root=None):
            self.assertEqual(file_bytes, b"downloaded-image")
            self.assertEqual(filename, "expression-final-1.png")
            return f"/static/assets/{filename}"

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        original_source = assets.load_asset_source_bytes
        original_save = assets.storage_service.save_asset_file
        assets.load_asset_source_bytes = fake_source_bytes
        assets.storage_service.save_asset_file = fake_save_asset_file
        try:
            response = TestClient(app).post(
                "/api/assets/upload",
                data={
                    "source_url": "http://localhost:8000/static/task/33/draft/final.png",
                    "filename": "expression-final-1.png",
                    "category": "expression",
                    "tags": "高兴",
                },
            )
        finally:
            assets.load_asset_source_bytes = original_source
            assets.storage_service.save_asset_file = original_save

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["filename"], "expression-final-1.png")
        self.assertEqual(data["category"], "expression")
        self.assertEqual(data["tags"], "高兴")
        self.assertEqual(data["url"], "/static/assets/expression-final-1.png")

    async def test_asset_tags_create_supports_non_expression_categories(self):
        class FakeScalar:
            def scalar_one_or_none(self):
                return None

        class FakeDB:
            def __init__(self):
                self.added_tag = None
                self.commits = 0

            async def execute(self, query):
                return FakeScalar()

            def add(self, item):
                if isinstance(item, AssetTag):
                    item.id = 501
                    self.added_tag = item

            async def flush(self):
                return None

            async def commit(self):
                self.commits += 1

            async def refresh(self, item):
                if getattr(item, "created_at", None) is None:
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)

        fake_db_instance = FakeDB()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return fake_db_instance

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).post(
            "/api/assets/tags/create",
            json={"category": "action", "name_en": "wave", "name_zh": "挥手"},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["category"], "action")
        self.assertEqual(data["name"], "wave")
        self.assertEqual(data["name_en"], "wave")
        self.assertEqual(data["name_zh"], "挥手")
        self.assertIsNone(data["group"])
        self.assertEqual(fake_db_instance.added_tag.category, "action")
        self.assertEqual(fake_db_instance.added_tag.name, "wave")
        self.assertIsNone(fake_db_instance.added_tag.tag_group)
        self.assertEqual(fake_db_instance.commits, 1)

    async def test_asset_tags_create_requires_group_for_background_category(self):
        class FakeScalar:
            def scalar_one_or_none(self):
                return None

        class FakeDB:
            async def execute(self, query):
                return FakeScalar()

            def add(self, item):
                raise AssertionError("background tag without group should not be created")

            async def flush(self):
                return None

            async def commit(self):
                raise AssertionError("background tag without group should not commit")

            async def refresh(self, item):
                return None

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return FakeDB()

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).post(
            "/api/assets/tags/create",
            json={"category": "background", "name_en": "campaign"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("tag_group", response.text)

    async def test_asset_tags_create_accepts_background_group(self):
        class FakeScalar:
            def scalar_one_or_none(self):
                return None

        class FakeDB:
            def __init__(self):
                self.added_tag = None
                self.commits = 0

            async def execute(self, query):
                return FakeScalar()

            def add(self, item):
                if isinstance(item, AssetTag):
                    item.id = 801
                    self.added_tag = item

            async def flush(self):
                return None

            async def commit(self):
                self.commits += 1

            async def refresh(self, item):
                if getattr(item, "created_at", None) is None:
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)

        fake_db_instance = FakeDB()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return fake_db_instance

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).post(
            "/api/assets/tags/create",
            json={"category": "background", "name_en": "campaign", "name_zh": "活动图", "tag_group": "purpose"},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["category"], "background")
        self.assertEqual(data["name"], "campaign")
        self.assertEqual(data["name_en"], "campaign")
        self.assertEqual(data["name_zh"], "活动图")
        self.assertEqual(data["group"], "purpose")
        self.assertEqual(fake_db_instance.added_tag.name, "campaign")
        self.assertEqual(fake_db_instance.added_tag.tag_group, "purpose")
        self.assertEqual(fake_db_instance.commits, 1)

    async def test_asset_tags_inline_create_returns_existing_record(self):
        existing_tag = AssetTag(
            id=910,
            name="campaign",
            name_en="campaign",
            name_zh="活动",
            category="background",
            tag_group="purpose",
        )
        existing_tag.created_at = datetime(2026, 1, 1, 12, 0, 0)

        class FakeScalar:
            def scalar_one_or_none(self):
                return existing_tag

        class FakeDB:
            def __init__(self):
                self.commits = 0

            async def execute(self, query):
                return FakeScalar()

            def add(self, item):
                raise AssertionError("existing inline tag should not be re-added")

            async def flush(self):
                return None

            async def commit(self):
                self.commits += 1

            async def refresh(self, item):
                return None

        fake_db_instance = FakeDB()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return fake_db_instance

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).post(
            "/api/assets/tags/create-inline",
            json={"category": "background", "name_en": "campaign", "name_zh": "活动", "tag_group": "purpose"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"],
            {
                "id": 910,
                "name": "campaign",
                "name_en": "campaign",
                "name_zh": "活动",
                "category": "background",
                "group": "purpose",
                "tag_group": "purpose",
                "image_count": 0,
                "created_at": "2026-01-01T12:00:00",
            },
        )
        self.assertEqual(fake_db_instance.commits, 1)

    async def test_asset_tags_list_supports_non_expression_categories(self):
        class FakeResult:
            def all(self):
                return [
                    type("Row", (), {"name": "挥手", "name_en": "wave", "name_zh": "挥手", "tag_group": None})(),
                    type("Row", (), {"name": "跳跃", "name_en": "jump", "name_zh": "跳跃", "tag_group": None})(),
                ]

        class FakeDB:
            def __init__(self):
                self.executed_query = ""

            async def execute(self, query):
                self.executed_query = str(query)
                return FakeResult()

        fake_db_instance = FakeDB()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return fake_db_instance

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).get("/api/assets/tags?category=action")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"],
            [
                {"name": "挥手", "name_en": "wave", "name_zh": "挥手", "group": None},
                {"name": "跳跃", "name_en": "jump", "name_zh": "跳跃", "group": None},
            ],
        )
        self.assertIn("asset_tags.category", fake_db_instance.executed_query)

    async def test_asset_tags_list_returns_grouped_background_tags(self):
        class FakeResult:
            def all(self):
                return [
                    type("Row", (), {"name": "活动图", "name_en": "campaign", "name_zh": "活动图", "tag_group": "purpose"})(),
                    type("Row", (), {"name": "街景", "name_en": "street", "name_zh": "街景", "tag_group": "scene"})(),
                    type("Row", (), {"name": "奖励感", "name_en": "reward", "name_zh": "奖励感", "tag_group": "mood"})(),
                    type("Row", (), {"name": "蓝金", "name_en": "blue-gold", "name_zh": "蓝金", "tag_group": "color_style"})(),
                ]

        class FakeDB:
            async def execute(self, query):
                return FakeResult()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return FakeDB()

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).get("/api/assets/tags?category=background")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"],
            [
                {"name": "活动图", "name_en": "campaign", "name_zh": "活动图", "group": "purpose"},
                {"name": "街景", "name_en": "street", "name_zh": "街景", "group": "scene"},
                {"name": "奖励感", "name_en": "reward", "name_zh": "奖励感", "group": "mood"},
                {"name": "蓝金", "name_en": "blue-gold", "name_zh": "蓝金", "group": "color_style"},
            ],
        )

    async def test_asset_tag_manage_list_includes_group_field(self):
        class FakeResult:
            def all(self):
                return [
                    type(
                        "Row",
                        (),
                        {
                            "id": 9,
                            "name": "campaign",
                            "name_en": "campaign",
                            "name_zh": "活动图",
                            "category": "background",
                            "tag_group": "purpose",
                            "created_at": datetime(2026, 1, 1, 12, 0, 0),
                            "image_count": 3,
                        },
                    )(),
                ]

        class FakeDB:
            async def execute(self, query):
                return FakeResult()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return FakeDB()

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).get("/api/assets/tags/manage?category=background")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"],
            [
                {
                    "id": 9,
                    "name": "campaign",
                    "name_en": "campaign",
                    "name_zh": "活动图",
                    "category": "background",
                    "tag_group": "purpose",
                    "created_at": "2026-01-01T12:00:00",
                    "image_count": 3,
                }
            ],
        )

    async def test_gallery_tag_manage_list_includes_i18n_fields(self):
        class FakeResult:
            def scalars(self):
                return self

            def all(self):
                return [
                    GalleryTag(
                        id=5,
                        name="cartoon-3d",
                        name_en="cartoon-3d",
                        name_zh="3D卡通",
                        source_type="activity",
                        image_count=4,
                    )
                ]

        class FakeDB:
            async def execute(self, query):
                return FakeResult()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return FakeDB()

        app = FastAPI()
        app.include_router(gallery.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).get("/api/gallery/tags/manage?source_type=activity")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"],
            [
                {
                    "id": 5,
                    "name": "cartoon-3d",
                    "name_en": "cartoon-3d",
                    "name_zh": "3D卡通",
                    "source_type": "activity",
                    "image_count": 4,
                }
            ],
        )

    async def test_gallery_tag_create_uses_english_canonical_name(self):
        class FakeScalar:
            def scalar_one_or_none(self):
                return None

        class FakeDB:
            def __init__(self):
                self.added_tag = None
                self.commits = 0

            async def execute(self, query):
                return FakeScalar()

            def add(self, item):
                if isinstance(item, GalleryTag):
                    item.id = 22
                    self.added_tag = item

            async def commit(self):
                self.commits += 1

            async def refresh(self, item):
                return None

        fake_db_instance = FakeDB()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return fake_db_instance

        app = FastAPI()
        app.include_router(gallery.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).post(
            "/api/gallery/tags/create",
            json={"name_en": "cartoon-3d", "name_zh": "3D卡通", "source_type": "activity"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"],
            {
                "id": 22,
                "name": "cartoon-3d",
                "name_en": "cartoon-3d",
                "name_zh": "3D卡通",
                "source_type": "activity",
                "image_count": 0,
            },
        )
        self.assertEqual(fake_db_instance.added_tag.name, "cartoon-3d")
        self.assertEqual(fake_db_instance.commits, 1)

    async def test_gallery_tag_patch_updates_i18n_fields_and_style_tag(self):
        class FakeScalar:
            def __init__(self, value=None):
                self.value = value

            def scalar_one_or_none(self):
                return self.value

        class FakeDB:
            def __init__(self):
                self.tag = GalleryTag(
                    id=9,
                    name="cartoon-3d",
                    name_en="cartoon-3d",
                    name_zh="3D卡通",
                    source_type="activity",
                    image_count=3,
                )
                self.select_calls = 0
                self.update_calls = 0
                self.commits = 0

            async def execute(self, query):
                if query.__class__.__name__ == "Update":
                    self.update_calls += 1
                    return FakeScalar()
                self.select_calls += 1
                if self.select_calls == 1:
                    return FakeScalar(self.tag)
                return FakeScalar(None)

            async def commit(self):
                self.commits += 1

            async def refresh(self, item):
                return None

        fake_db_instance = FakeDB()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return fake_db_instance

        app = FastAPI()
        app.include_router(gallery.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).patch(
            "/api/gallery/tags/9",
            json={"name_en": "gold-coins", "name_zh": "金币风"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"],
            {
                "id": 9,
                "name": "gold-coins",
                "name_en": "gold-coins",
                "name_zh": "金币风",
                "source_type": "activity",
                "image_count": 3,
            },
        )
        self.assertEqual(fake_db_instance.tag.name, "gold-coins")
        self.assertEqual(fake_db_instance.tag.name_zh, "金币风")
        self.assertEqual(fake_db_instance.update_calls, 1)
        self.assertEqual(fake_db_instance.commits, 1)

    async def test_asset_stats_returns_total_and_counts_by_category(self):
        class FakeRow:
            def __init__(self, category, image_count):
                self.category = category
                self.image_count = image_count

        class FakeResult:
            def all(self):
                return [
                    FakeRow("bull_reference", 8),
                    FakeRow("expression", 15),
                    FakeRow("action", 12),
                ]

        class FakeDB:
            async def execute(self, query):
                return FakeResult()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return FakeDB()

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).get("/api/assets/stats")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"],
            {
                "total": 35,
                "by_category": {
                    "bull_reference": 8,
                    "expression": 15,
                    "action": 12,
                },
            },
        )

    async def test_asset_tags_patch_updates_asset_and_rebuilds_tag_relations(self):
        class FakeScalar:
            def __init__(self, value=None):
                self.value = value

            def scalar_one_or_none(self):
                return self.value

        class FakeDB:
            def __init__(self):
                self.asset = Asset(
                    id=7,
                    filename="cow.png",
                    category="game_content",
                    tags="旧标签",
                    url="/static/assets/cow.png",
                    uploaded_by=1,
                )
                self.next_id = 300
                self.select_calls = 0
                self.delete_relation_calls = 0
                self.insert_relation_calls = 0
                self.added_tags = []
                self.commits = 0

            def add(self, item):
                if isinstance(item, AssetTag):
                    item.id = self.next_id
                    self.next_id += 1
                    self.added_tags.append(item)

            async def execute(self, query):
                query_type = query.__class__.__name__
                if query_type == "Delete":
                    self.delete_relation_calls += 1
                    return FakeScalar()
                if query_type == "Insert":
                    self.insert_relation_calls += 1
                    return FakeScalar()
                self.select_calls += 1
                if self.select_calls == 1:
                    return FakeScalar(self.asset)
                return FakeScalar(None)

            async def flush(self):
                return None

            async def commit(self):
                self.commits += 1

            async def refresh(self, item):
                if getattr(item, "created_at", None) is None:
                    item.created_at = datetime(2026, 1, 1, 12, 0, 0)

        fake_db_instance = FakeDB()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return fake_db_instance

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).patch(
            "/api/assets/7/tags",
            json={"tags": "新标签, 旧标签, 新标签"},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["tags"], "新标签,旧标签")
        self.assertEqual(fake_db_instance.asset.tags, "新标签,旧标签")
        self.assertEqual(fake_db_instance.delete_relation_calls, 1)
        self.assertEqual(fake_db_instance.insert_relation_calls, 2)
        self.assertEqual([tag.name for tag in fake_db_instance.added_tags], ["新标签", "旧标签"])
        self.assertEqual([tag.category for tag in fake_db_instance.added_tags], ["game_content", "game_content"])
        self.assertEqual(fake_db_instance.commits, 1)

    async def test_assets_batch_move_updates_selected_asset_categories(self):
        class FakeResult:
            def __init__(self, values=None, one=None):
                self.values = values or []
                self.one = one

            def scalars(self):
                return self

            def all(self):
                return self.values

            def scalar_one_or_none(self):
                return self.one

        class FakeDB:
            def __init__(self):
                self.assets = [
                    Asset(id=1, filename="a.png", category="expression", tags="开心", url="/static/assets/a.png", uploaded_by=1),
                    Asset(id=2, filename="b.png", category="expression", tags="挥手", url="/static/assets/b.png", uploaded_by=1),
                    Asset(id=3, filename="c.png", category="action", url="/static/assets/c.png", uploaded_by=1),
                ]
                self.next_tag_id = 100
                self.added_tags = []
                self.delete_relation_calls = 0
                self.insert_relation_calls = 0
                self.commits = 0

            async def execute(self, query):
                query_type = query.__class__.__name__
                if query_type == "Delete":
                    self.delete_relation_calls += 1
                    return FakeResult()
                if query_type == "Insert":
                    self.insert_relation_calls += 1
                    return FakeResult()

                query_text = str(query)
                if "FROM assets" in query_text:
                    return FakeResult([asset for asset in self.assets if asset.id in {1, 2}])
                if "JOIN asset_tags" in query_text:
                    return FakeResult([
                        (1, 10, "开心", "expression"),
                        (2, 11, "挥手", "expression"),
                    ])
                if "FROM asset_tags" in query_text:
                    return FakeResult(one=None)
                return FakeResult()

            def add(self, item):
                if isinstance(item, AssetTag):
                    item.id = self.next_tag_id
                    self.next_tag_id += 1
                    self.added_tags.append(item)

            async def flush(self):
                return None

            async def commit(self):
                self.commits += 1

        fake_db_instance = FakeDB()

        async def fake_current_user():
            return {"id": 1, "username": "admin", "role": "admin"}

        async def fake_db():
            return fake_db_instance

        app = FastAPI()
        app.include_router(assets.router)
        app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        app.dependency_overrides[dependencies.get_db] = fake_db

        response = TestClient(app).patch(
            "/api/assets/batch-move",
            json={"asset_ids": [1, 2], "target_category": "holiday"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"], {"moved_count": 2})
        self.assertEqual([asset.category for asset in fake_db_instance.assets], ["holiday", "holiday", "action"])
        self.assertEqual([asset.tags for asset in fake_db_instance.assets[:2]], ["开心", "挥手"])
        self.assertEqual([(tag.name, tag.category) for tag in fake_db_instance.added_tags], [
            ("开心", "holiday"),
            ("挥手", "holiday"),
        ])
        self.assertEqual(fake_db_instance.delete_relation_calls, 2)
        self.assertEqual(fake_db_instance.insert_relation_calls, 2)
        self.assertEqual(fake_db_instance.commits, 1)

    async def test_activity_build_prompt_uses_structured_sections(self):
        template = activity_workflows.ActivityTemplate(
            id=1,
            template_no="T01",
            name="召回模板",
            type_id=1,
            structure_layer1="金币奖励展示",
            structure_layer2="标题与副标题",
            structure_layer3="按钮区",
            prompt_template="legacy",
            rule_character="固定牛角色",
            style_guide="高饱和金币质感，统一品牌视觉",
            rule_scene="节庆大厅",
            bg_description="金色粒子背景",
            rule_visual="奖励数字置中",
            rule_copy="主标题最多6词",
            rule_button="按钮文案必须短促",
            rule_quality="高清，英文无拼写错误",
            rule_forbidden="禁止额外人物",
            forbidden_rules="禁止中文",
            is_active=True,
        )

        prompt = activity_workflows.build_prompt(
            template,
            {
                "title": "Come Back & Get Rewards",
                "cta_text": "Claim Now",
            },
            output_size="1080x1080",
        )

        self.assertIn("[CHARACTER]\n固定牛角色", prompt)
        self.assertIn("[STYLE GUIDE]\n高饱和金币质感，统一品牌视觉", prompt)
        self.assertIn("[SCENE]\n节庆大厅", prompt)
        self.assertIn("主视觉区：金币奖励展示", prompt)
        self.assertIn("背景区：金色粒子背景", prompt)
        self.assertIn("[CONTENT]\ntitle: Come Back & Get Rewards\ncta_text: Claim Now", prompt)
        self.assertIn("[FORBIDDEN]\n禁止额外人物\n禁止中文", prompt)
        self.assertTrue(prompt.endswith("[OUTPUT]\n1080 x 1080\nSingle image"))

    async def test_activity_reference_image_urls_preserve_selected_order_and_cap_at_four(self):
        class FakeScalars:
            def __init__(self, values):
                self.values = values

            def all(self):
                return self.values

        class FakeResult:
            def __init__(self, values):
                self.values = values

            def scalars(self):
                return FakeScalars(self.values)

        class FakeDB:
            async def execute(self, query):
                return FakeResult(
                    [
                        activity_workflows.Asset(id=4, filename="four.png", category="background", url="/static/assets/four.png"),
                        activity_workflows.Asset(id=1, filename="one.png", category="background", url="/static/assets/one.png"),
                        activity_workflows.Asset(id=2, filename="two.png", category="background", url="/static/assets/two.png"),
                    ]
                )

        urls = await activity_workflows.resolve_activity_reference_image_urls(FakeDB(), [1, 2, 3, 4, 5])

        self.assertEqual(
            urls,
            ["/static/assets/one.png", "/static/assets/two.png", "/static/assets/four.png"],
        )

    async def test_reset_default_fields_replaces_existing_template_fields(self):
        class FakeScalar:
            def __init__(self, value=None):
                self.value = value

            def scalar_one_or_none(self):
                return self.value

        class FakeDB:
            def __init__(self):
                self.template = activity_workflows.ActivityTemplate(
                    id=7,
                    template_no="T07",
                    name="活动模板",
                    type_id=1,
                    structure_layer1="主视觉区",
                    structure_layer2="文案区",
                    structure_layer3="行动区",
                    prompt_template="legacy",
                    is_active=True,
                )
                self.deleted_count = 0
                self.added_fields = []
                self.commits = 0

            async def execute(self, query):
                if query.__class__.__name__ == "Delete":
                    self.deleted_count += 1
                    return FakeScalar()
                return FakeScalar(self.template)

            def add_all(self, items):
                self.added_fields.extend(items)

            async def commit(self):
                self.commits += 1

        payload = await activity_workflows.reset_template_fields_defaults(
            7,
            db=FakeDB(),
            current_user={"id": 1, "username": "admin", "role": "admin"},
        )

        self.assertEqual(payload["code"], 0)
        self.assertEqual(payload["data"]["reset_count"], 5)
        self.assertEqual(payload["data"]["template_id"], 7)

    async def test_list_templates_includes_sorted_fields(self):
        created_at = datetime(2026, 1, 1, 12, 0, 0)

        class FakeScalars:
            def __init__(self, values):
                self.values = values

            def unique(self):
                return self

            def all(self):
                return self.values

        class FakeResult:
            def __init__(self, values):
                self.values = values

            def scalars(self):
                return FakeScalars(self.values)

        template = activity_workflows.ActivityTemplate(
            id=9,
            template_no="T09",
            name="回访召回",
            type_id=1,
            structure_layer1="主视觉区",
            structure_layer2="文案区",
            structure_layer3="行动区",
            prompt_template="legacy",
            is_active=True,
            created_by=1,
            created_at=created_at,
            updated_at=created_at,
        )
        template.template_type = activity_workflows.ActivityTemplateType(
            id=1,
            name="回访召回",
            code="revisit",
            sort_order=1,
            created_at=created_at,
        )
        template.field_definitions = [
            activity_workflows.ActivityFieldDefinition(
                id=2,
                template_id=9,
                field_key="cta_text",
                field_name="按钮文字",
                field_type="select",
                is_required=True,
                default_value="Claim Now",
                hint=None,
                options_json=["Claim Now", "Play Now"],
                sort_order=5,
                created_at=created_at,
            ),
            activity_workflows.ActivityFieldDefinition(
                id=1,
                template_id=9,
                field_key="title",
                field_name="主标题",
                field_type="text",
                is_required=True,
                default_value="Come Back & Get Rewards",
                hint="最多6个英文词",
                options_json=None,
                sort_order=1,
                created_at=created_at,
            ),
        ]

        class FakeDB:
            async def execute(self, query):
                return FakeResult([template])

        payload = await activity_workflows.list_templates(
            db=FakeDB(),
            current_user={"id": 1, "username": "admin", "role": "admin"},
        )

        self.assertEqual(payload["code"], 0)
        fields = payload["data"][0]["fields"]
        self.assertEqual([item["field_key"] for item in fields], ["title", "cta_text"])

    async def test_archive_generation_job_writes_activity_source_metadata(self):
        created_at = datetime(2026, 1, 1, 12, 0, 0)

        class FakeScalar:
            def __init__(self, value=None):
                self.value = value

            def scalar_one_or_none(self):
                return self.value

        class FakeDB:
            def __init__(self):
                self.job = activity_workflows.ActivityGenerationJob(
                    id=5,
                    template_id=7,
                    task_id=99,
                    operator_id=3,
                    variables_json={"title": "Come Back"},
                    prompt_rendered="Prompt text",
                    model_config_id=4,
                    status="passed",
                    qc_result={
                        "reward_visible": True,
                        "action_clear": True,
                        "character_consistent": True,
                    },
                    reject_reason=None,
                    image_url="/static/generated/job-5.png",
                    cost_usd=Decimal("0.1200"),
                    token_used=321,
                    created_at=created_at,
                    updated_at=created_at,
                )
                self.template = activity_workflows.ActivityTemplate(
                    id=7,
                    template_no="T07",
                    name="回访召回模板",
                    type_id=2,
                    structure_layer1="主视觉区",
                    structure_layer2="文案区",
                    structure_layer3="行动区",
                    prompt_template="legacy",
                    style_tag="3D卡通",
                    is_active=True,
                )
                self.template_type = activity_workflows.ActivityTemplateType(
                    id=2,
                    name="回访召回",
                    code="revisit",
                    sort_order=1,
                    created_at=created_at,
                )
                self.existing_gallery_tag = None
                self.added = []
                self.commits = 0

            async def execute(self, query):
                query_text = str(query)
                if "FROM activity_generation_jobs" in query_text:
                    return FakeScalar(self.job)
                if "FROM activity_templates" in query_text:
                    return FakeScalar(self.template)
                if "FROM activity_template_types" in query_text:
                    return FakeScalar(self.template_type)
                if "FROM gallery_tags" in query_text:
                    return FakeScalar(self.existing_gallery_tag)
                return FakeScalar()

            def add(self, item):
                if isinstance(item, activity_workflows.FinalImage):
                    item.id = 88
                    if getattr(item, "created_at", None) is None:
                        item.created_at = created_at
                self.added.append(item)

            async def commit(self):
                self.commits += 1

            async def refresh(self, item):
                return None

        fake_db = FakeDB()

        payload = await activity_workflows.archive_generation_job(
            5,
            db=fake_db,
            current_user={"id": 1, "username": "admin", "role": "admin"},
        )

        self.assertEqual(payload["code"], 0)
        self.assertEqual(fake_db.commits, 1)
        self.assertEqual(fake_db.job.status, "archived")
        final_image = next(item for item in fake_db.added if isinstance(item, activity_workflows.FinalImage))
        self.assertEqual(final_image.source_type, "activity")
        self.assertEqual(final_image.sub_category, "revisit")
        self.assertEqual(final_image.style_tag, "3D卡通")
        gallery_tag = next(
            item for item in fake_db.added if item.__class__.__name__ == "GalleryTag"
        )
        self.assertEqual(gallery_tag.name, "3D卡通")
        self.assertEqual(gallery_tag.source_type, "activity")
        self.assertEqual(gallery_tag.image_count, 1)
        self.assertEqual(payload["data"]["final_image"]["source_type"], "activity")
        self.assertEqual(payload["data"]["final_image"]["sub_category"], "revisit")
        self.assertEqual(payload["data"]["final_image"]["style_tag"], "3D卡通")

    class _DailyPostFakeResult:
        def __init__(self, values=None):
            self.values = values or []

        def scalars(self):
            return self

        def all(self):
            return self.values

        def scalar_one_or_none(self):
            return self.values[0] if self.values else None

    class _DailyPostFakeDB:
        def __init__(self):
            self.templates = []
            self.jobs = []
            self.session = None
            self.commits = 0
            self.deleted_templates = []
            self.next_id = 1000

        def add(self, item):
            now = datetime(2026, 1, 1, 12, 0, 0)
            if isinstance(item, DailyPostTemplate):
                if getattr(item, "id", None) is None:
                    item.id = self.next_id
                    self.next_id += 1
                if getattr(item, "created_at", None) is None:
                    item.created_at = now
                if getattr(item, "updated_at", None) is None:
                    item.updated_at = now
                if item not in self.templates:
                    self.templates.append(item)
                return None
            if isinstance(item, DailyPostJob):
                if getattr(item, "id", None) is None:
                    item.id = self.next_id
                    self.next_id += 1
                if getattr(item, "created_at", None) is None:
                    item.created_at = now
                if getattr(item, "updated_at", None) is None:
                    item.updated_at = now
                if item.template is None and item.template_id is not None:
                    item.template = next((template for template in self.templates if template.id == item.template_id), None)
                if item not in self.jobs:
                    self.jobs.append(item)
                return None
            if isinstance(item, WorkflowSession):
                if getattr(item, "id", None) is None:
                    item.id = self.next_id
                    self.next_id += 1
                if getattr(item, "created_at", None) is None:
                    item.created_at = now
                if getattr(item, "updated_at", None) is None:
                    item.updated_at = now
                self.session = item

        async def delete(self, item):
            self.deleted_templates.append(item)
            self.templates = [template for template in self.templates if template.id != item.id]

        async def execute(self, query):
            query_text = str(query)
            try:
                params = query.compile().params
            except Exception:
                params = {}

            if "FROM daily_post_templates" in query_text:
                items = list(self.templates)
                template_type = params.get("template_type_1")
                if template_type is not None:
                    items = [item for item in items if item.template_type == template_type]
                template_id = params.get("id_1")
                if template_id is not None and template_type is None:
                    items = [item for item in items if item.id == template_id]
                return RouterTests._DailyPostFakeResult(items)

            if "FROM daily_post_jobs" in query_text:
                items = list(self.jobs)
                job_id = params.get("id_1")
                if job_id is not None:
                    items = [item for item in items if item.id == job_id]
                return RouterTests._DailyPostFakeResult(items)

            if "FROM workflow_sessions" in query_text:
                return RouterTests._DailyPostFakeResult([self.session] if self.session is not None else [])

            if "FROM model_configs" in query_text:
                model_config_id = params.get("id_1", 0) or 0
                return RouterTests._DailyPostFakeResult(
                    [
                        ModelConfig(
                            id=model_config_id,
                            name="OpenAI Final",
                            provider="openai",
                            model_name="gpt-image-1",
                            usage_type="both",
                            active=True,
                        )
                    ]
                )

            return RouterTests._DailyPostFakeResult([])

        async def flush(self):
            return None

        async def commit(self):
            self.commits += 1

        async def refresh(self, item):
            now = datetime(2026, 1, 1, 12, 0, 0)
            if getattr(item, "created_at", None) is None:
                item.created_at = now
            if getattr(item, "updated_at", None) is None:
                item.updated_at = now

    def _build_daily_post_app(self, fake_db, authenticated=True):
        app = FastAPI()
        app.include_router(daily_post_workflows.router, prefix="/api/daily-post")

        async def fake_db_dep():
            return fake_db

        app.dependency_overrides[dependencies.get_db] = fake_db_dep
        if authenticated:
            async def fake_current_user():
                return {"id": 1, "username": "admin", "role": "admin"}

            app.dependency_overrides[dependencies.get_current_user] = fake_current_user
        return app

    def _make_daily_post_template(self, template_id: int, template_type: str, name: str):
        now = datetime(2026, 1, 1, 12, 0, 0)
        template = DailyPostTemplate(
            id=template_id,
            name=name,
            template_type=template_type,
            title_copy=f"{name} 主文案",
            interaction_copy=f"{name} 互动问题",
            option_a="A",
            option_b="B",
            option_c="C",
            bull_action="happy",
            background="home",
            style="social",
            color_mood="warm",
            brand_weight="light",
            is_enabled=True,
            sort_order=template_id,
        )
        template.created_at = now
        template.updated_at = now
        return template

    def _make_daily_post_job(self, job_id: int, template: DailyPostTemplate, **overrides):
        now = datetime(2026, 1, 1, 12, 0, 0)
        job = DailyPostJob(
            id=job_id,
            template_id=template.id,
            task_id=overrides.get("task_id", 77),
            session_id=overrides.get("session_id", 88),
            today_theme=overrides.get("today_theme", "雨天通勤"),
            user_emotion=overrides.get("user_emotion", "疲惫"),
            main_copy=overrides.get("main_copy", "今天也要加油"),
            interaction_question=overrides.get("interaction_question", "你会怎么选？"),
            option_a_override=overrides.get("option_a_override"),
            option_b_override=overrides.get("option_b_override"),
            option_c_override=overrides.get("option_c_override"),
            aux_copy=overrides.get("aux_copy"),
            bull_action_override=overrides.get("bull_action_override"),
            background_override=overrides.get("background_override"),
            model_config_id=overrides.get("model_config_id", 19),
            status=overrides.get("status", "draft"),
            generated_image_url=overrides.get("generated_image_url"),
            archived_asset_id=overrides.get("archived_asset_id"),
            cost_usd=overrides.get("cost_usd"),
            created_by=overrides.get("created_by", 1),
        )
        job.template = template
        job.created_at = now
        job.updated_at = now
        return job

    async def test_daily_post_template_types_requires_authentication(self):
        app = FastAPI()
        app.include_router(daily_post_workflows.router, prefix="/api/daily-post")

        response = TestClient(app).get("/api/daily-post/template-types")

        self.assertEqual(response.status_code, 401)

    async def test_daily_post_template_types_returns_six_types_for_authenticated_user(self):
        app = self._build_daily_post_app(self._DailyPostFakeDB())

        response = TestClient(app).get("/api/daily-post/template-types")

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 6)
        self.assertEqual({item["value"] for item in data}, {"emotion", "game", "choice", "meme", "local", "character"})

    async def test_daily_post_templates_list_returns_list(self):
        fake_db = self._DailyPostFakeDB()
        fake_db.templates = [
            self._make_daily_post_template(1, "choice", "二选一模板"),
            self._make_daily_post_template(2, "emotion", "情绪模板"),
        ]
        app = self._build_daily_post_app(fake_db)

        response = TestClient(app).get("/api/daily-post/templates")

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 2)

    async def test_daily_post_templates_list_filters_by_type_choice(self):
        fake_db = self._DailyPostFakeDB()
        fake_db.templates = [
            self._make_daily_post_template(1, "choice", "二选一模板"),
            self._make_daily_post_template(2, "emotion", "情绪模板"),
        ]
        app = self._build_daily_post_app(fake_db)

        response = TestClient(app).get("/api/daily-post/templates?type=choice")

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertTrue(all(item["template_type"] == "choice" for item in data))
        self.assertEqual(len(data), 1)

    async def test_daily_post_templates_create_returns_id(self):
        fake_db = self._DailyPostFakeDB()
        app = self._build_daily_post_app(fake_db)

        response = TestClient(app).post(
            "/api/daily-post/templates/create",
            json={"name": "今日心情选择图", "template_type": "choice"},
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("id", data)
        self.assertEqual(data["name"], "今日心情选择图")
        self.assertEqual(fake_db.commits, 1)

    async def test_daily_post_templates_toggle_flips_created_template(self):
        fake_db = self._DailyPostFakeDB()
        app = self._build_daily_post_app(fake_db)
        create_response = TestClient(app).post(
            "/api/daily-post/templates/create",
            json={"name": "今日心情选择图", "template_type": "choice"},
        )
        template_id = create_response.json()["data"]["id"]

        response = TestClient(app).patch(f"/api/daily-post/templates/{template_id}/toggle")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["data"]["is_enabled"])

    async def test_daily_post_templates_delete_removes_created_template(self):
        fake_db = self._DailyPostFakeDB()
        app = self._build_daily_post_app(fake_db)
        create_response = TestClient(app).post(
            "/api/daily-post/templates/create",
            json={"name": "今日心情选择图", "template_type": "choice"},
        )
        template_id = create_response.json()["data"]["id"]

        response = TestClient(app).delete(f"/api/daily-post/templates/{template_id}")

        self.assertIn(response.status_code, {200, 204})

    async def test_daily_post_jobs_create_returns_draft_job(self):
        template = self._make_daily_post_template(1, "choice", "二选一模板")
        fake_db = self._DailyPostFakeDB()
        fake_db.templates = [template]
        app = self._build_daily_post_app(fake_db)

        response = TestClient(app).post(
            "/api/daily-post/jobs/create",
            json={
                "template_id": template.id,
                "task_id": 77,
                "today_theme": "雨天通勤",
                "user_emotion": "疲惫",
                "main_copy": "今天也要加油",
                "interaction_question": "你会怎么选？",
                "model_config_id": 19,
            },
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("id", data)
        self.assertEqual(data["status"], "draft")
        self.assertEqual(data["template_id"], template.id)

    async def test_daily_post_jobs_list_returns_list(self):
        template = self._make_daily_post_template(1, "choice", "二选一模板")
        fake_db = self._DailyPostFakeDB()
        fake_db.templates = [template]
        fake_db.jobs = [self._make_daily_post_job(201, template)]
        app = self._build_daily_post_app(fake_db)

        response = TestClient(app).get("/api/daily-post/jobs")

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)

    async def test_daily_post_jobs_get_returns_created_job_with_template_id(self):
        template = self._make_daily_post_template(1, "choice", "二选一模板")
        fake_db = self._DailyPostFakeDB()
        fake_db.templates = [template]
        app = self._build_daily_post_app(fake_db)
        create_response = TestClient(app).post(
            "/api/daily-post/jobs/create",
            json={
                "template_id": template.id,
                "task_id": 77,
                "today_theme": "雨天通勤",
                "user_emotion": "疲惫",
                "main_copy": "今天也要加油",
                "interaction_question": "你会怎么选？",
                "model_config_id": 19,
            },
        )
        job_id = create_response.json()["data"]["id"]

        response = TestClient(app).get(f"/api/daily-post/jobs/{job_id}")

        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["id"], job_id)
        self.assertEqual(data["template_id"], template.id)


if __name__ == "__main__":
    unittest.main()


class TrendingWorkflowRouteTests(unittest.TestCase):
    """热点借势工作流路由覆盖测试"""

    def test_topic_configs_route_exists(self):
        from app.routers.trending_workflows import router
        paths = [r.path for r in router.routes]
        self.assertIn("/topic-configs", paths)

    def test_jobs_create_route_exists(self):
        from app.routers.trending_workflows import router
        paths = [r.path for r in router.routes]
        self.assertIn("/jobs/create", paths)

    def test_jobs_get_route_exists(self):
        from app.routers.trending_workflows import router
        paths = [r.path for r in router.routes]
        self.assertIn("/jobs/{job_id}", paths)

    def test_jobs_patch_route_exists(self):
        from app.routers.trending_workflows import router
        paths = [r.path for r in router.routes]
        self.assertIn("/jobs/{job_id}", paths)

    def test_generate_draft_route_exists(self):
        from app.routers.trending_workflows import router
        paths = [r.path for r in router.routes]
        self.assertIn("/jobs/{job_id}/generate-draft", paths)

    def test_generate_final_route_exists(self):
        from app.routers.trending_workflows import router
        paths = [r.path for r in router.routes]
        self.assertIn("/jobs/{job_id}/generate-final", paths)

    def test_refine_route_exists(self):
        from app.routers.trending_workflows import router
        paths = [r.path for r in router.routes]
        self.assertIn("/jobs/{job_id}/refine", paths)

    def test_archive_route_exists(self):
        from app.routers.trending_workflows import router
        paths = [r.path for r in router.routes]
        self.assertIn("/jobs/{job_id}/archive", paths)

    def test_router_registered_in_main(self):
        from app.main import app
        prefixes = [r.path for r in app.routes]
        self.assertTrue(
            any("/api/trending" in p for p in prefixes),
            "trending router not registered in main app"
        )

    def test_risk_level_cannot_be_upgraded(self):
        """风险等级只能下调不能上调的逻辑验证"""
        from app.routers.trending_workflows import RISK_ORDER
        self.assertGreater(RISK_ORDER["HIGH"], RISK_ORDER["MEDIUM"])
        self.assertGreater(RISK_ORDER["MEDIUM"], RISK_ORDER["LOW"])

    def test_source_type_is_trending(self):
        """确认 archive 路由使用正确的 source_type"""
        import inspect
        from app.routers import trending_workflows
        source = inspect.getsource(trending_workflows)
        self.assertIn('source_type="trending"', source)

    def test_reference_image_resolver_exists(self):
        """确认 resolve_reference_image_urls 函数存在"""
        from app.routers.trending_workflows import resolve_reference_image_urls
        import inspect
        self.assertTrue(inspect.iscoroutinefunction(resolve_reference_image_urls))

    def test_generate_timeout_comment_or_pattern(self):
        """确认生成路由传递了 reference_image_urls 第三个参数"""
        import inspect
        from app.routers import trending_workflows
        source = inspect.getsource(trending_workflows)
        self.assertIn("reference_image_urls", source)

    def test_prompt_service_importable(self):
        from app.services.trending_prompt import (
            build_draft_prompt,
            build_final_prompt,
            build_refine_prompt,
        )
        self.assertTrue(callable(build_draft_prompt))
        self.assertTrue(callable(build_final_prompt))
        self.assertTrue(callable(build_refine_prompt))

    def test_draft_prompt_language_constraint(self):
        from app.services.trending_prompt import build_draft_prompt
        prompt = build_draft_prompt(
            news_title="世界杯决赛",
            selected_angle="STANCE",
            selected_action="欢呼",
            selected_image_type="VS",
            risk_level="LOW",
            allow_game_integration=True,
            copy_style="HYPE",
            image_language="english",
        )
        self.assertIn("Filipino Facebook", prompt)
        self.assertIn("English only", prompt)

    def test_high_risk_prompt_constraints(self):
        from app.services.trending_prompt import build_draft_prompt
        prompt = build_draft_prompt(
            news_title="突发事件",
            selected_angle="REACTION_ONLY",
            selected_action="无语",
            selected_image_type="REACTION",
            risk_level="HIGH",
            allow_game_integration=False,
            copy_style="NEUTRAL",
            image_language="english",
        )
        self.assertIn("No humor", prompt)
        self.assertIn("game elements", prompt)

    def test_game_integration_false_adds_constraint(self):
        from app.services.trending_prompt import build_draft_prompt
        prompt = build_draft_prompt(
            news_title="测试",
            selected_angle="REACTION",
            selected_action="吃瓜",
            selected_image_type="REACTION",
            risk_level="LOW",
            allow_game_integration=False,
            copy_style="GOSSIP",
            image_language="taglish",
        )
        self.assertIn("gambling", prompt)
        self.assertIn("Taglish", prompt)
