from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
import unittest

from pydantic import ValidationError

from app.schemas.asset import AssetResponse, AssetTagRecord, AssetUpdate
from app.schemas.asset_tag import AssetTagCreate, AssetTagResponse, AssetTagUpdate
from app.schemas.activity_template import (
    ActivityFieldDefinitionCreate,
    ActivityFieldDefinitionResponse,
    ActivityGenerationJobCreate,
    ActivityGenerationJobResponse,
    ActivityTemplateCreate,
    ActivityTemplateResponse,
    ActivityTemplateTypeResponse,
    ActivityTemplateUpdate,
    ActivityVariablePresetResponse,
    QCSubmitRequest,
)
from app.schemas.activity_batch import (
    ActivityBatchArchiveRequest,
    ActivityBatchCreate,
    ActivityBatchImageResponse,
    ActivityBatchRefineRequest,
    ActivityBatchResponse,
)
from app.schemas.auth import LoginRequest, TokenResponse, UserInfo
from app.schemas.background import (
    BackgroundBatchCreate,
    BackgroundBatchGenerateRequest,
    BackgroundBatchResponse,
    BackgroundImageArchiveRequest,
    BackgroundImageRefineRequest,
    BackgroundImageResponse,
    BackgroundImageReviewRequest,
)
from app.schemas.generate import (
    GenerationLogResponse,
    ImageGenerateRequest,
    ImageGenerateResponse,
)
from app.schemas.gallery_tag import GalleryTagCreate, GalleryTagResponse, GalleryTagUpdate
from app.schemas.model_config import (
    ModelConfigCreate,
    ModelConfigResponse,
    ModelConfigUpdate,
)
from app.schemas.instruction import (
    InstructionCreate,
    InstructionResponse,
    InstructionUpdate,
    WorkflowTypeResponse,
)
from app.schemas.prompt import (
    PromptBuildRequest,
    PromptBuildResponse,
    PromptTemplateCreate,
    PromptTemplateResponse,
    PromptTemplateUpdate,
)
from app.schemas.review import ReviewResponse, ReviewSubmitRequest
from app.schemas.stats import (
    DailyCostStat,
    DashboardStats,
    ModelStat,
    PublishStatCreate,
    PublishStatResponse,
    UserStat,
)
from app.schemas.task import TaskCreate, TaskResponse, TaskStatusUpdate, TaskUpdate
from app.schemas.user_model_permission import PermissionGrant, PermissionResponse


class SchemaTests(unittest.TestCase):
    response_classes = [
        AssetResponse,
        AssetTagRecord,
        ActivityGenerationJobResponse,
        ActivityBatchImageResponse,
        ActivityBatchResponse,
        ActivityTemplateResponse,
        ActivityTemplateTypeResponse,
        ActivityVariablePresetResponse,
        BackgroundBatchResponse,
        BackgroundImageResponse,
        DailyCostStat,
        DashboardStats,
        GenerationLogResponse,
        GalleryTagResponse,
        ImageGenerateResponse,
        ModelStat,
        ModelConfigResponse,
        PermissionResponse,
        InstructionResponse,
        PromptBuildResponse,
        PromptTemplateResponse,
        PublishStatResponse,
        ReviewResponse,
        TaskResponse,
        TokenResponse,
        UserInfo,
        UserStat,
        WorkflowTypeResponse,
    ]

    def test_response_schemas_enable_from_attributes(self):
        for schema in self.response_classes:
            with self.subTest(schema=schema.__name__):
                self.assertTrue(schema.model_config.get("from_attributes"))

    def test_auth_schemas(self):
        login = LoginRequest(username="admin", password="admin123")
        user = UserInfo.model_validate(
            SimpleNamespace(
                id=1,
                username="admin",
                role="admin",
                status=True,
                created_at=datetime(2026, 1, 1, 12, 0, 0),
            )
        )
        token = TokenResponse(token="jwt", user=user)

        self.assertEqual(login.username, "admin")
        self.assertEqual(token.user.role, "admin")

    def test_task_schemas_follow_task_model_fields(self):
        created = datetime(2026, 1, 1, 12, 0, 0)
        task = TaskCreate(title="Payday bull", scene="Payday", size="1080x1350")
        update = TaskUpdate(status="reviewing")
        status = TaskStatusUpdate(status="done")
        response = TaskResponse.model_validate(
            SimpleNamespace(
                id=1001,
                title="Payday bull",
                scene="Payday",
                size="1080x1350",
                purpose=None,
                budget=Decimal("20.00"),
                description=None,
                status="created",
                creator_id=1,
                created_at=created,
                updated_at=created,
            )
        )

        self.assertEqual(task.budget, Decimal("0"))
        self.assertEqual(update.status, "reviewing")
        self.assertEqual(status.status, "done")
        self.assertEqual(response.creator_id, 1)

    def test_prompt_and_asset_schemas(self):
        prompt = PromptTemplateCreate(name="Draft", mode="draft", content="Theme: {{theme}}")
        prompt_update = PromptTemplateUpdate(active=False)
        prompt_response = PromptTemplateResponse.model_validate(
            SimpleNamespace(
                id=1,
                name="Draft",
                mode="draft",
                content="Theme: {{theme}}",
                active=True,
                created_by=1,
                created_at=datetime(2026, 1, 1, 12, 0, 0),
                updated_at=datetime(2026, 1, 1, 12, 0, 0),
            )
        )
        build = PromptBuildRequest(task_id=1, mode="draft", asset_ids=[1, 2])
        built = PromptBuildResponse(task_id=1, mode="draft", prompt="prompt")
        asset = AssetResponse.model_validate(
            SimpleNamespace(
                id=1,
                filename="bull.png",
                category="bull_reference",
                tags="bull,standard",
                url="/storage/assets/bull.png",
                use_count=5,
                uploaded_by=1,
                created_at=datetime(2026, 1, 1, 12, 0, 0),
            )
        )
        asset_update = AssetUpdate(tags="new")

        self.assertTrue(prompt.active)
        self.assertFalse(prompt_update.active)
        self.assertEqual(prompt_response.created_by, 1)
        self.assertEqual(build.asset_ids, [1, 2])
        self.assertEqual(built.prompt, "prompt")
        self.assertEqual(asset.category, "bull_reference")
        self.assertEqual(asset.use_count, 5)
        self.assertEqual(asset_update.tags, "new")

    def test_asset_tag_schema_supports_grouped_and_ungrouped_payloads(self):
        grouped = AssetTagRecord.model_validate({"name": "活动图", "group": "purpose"})
        legacy = AssetTagRecord.model_validate({"name": "挥手", "group": None})

        self.assertEqual(grouped.group, "purpose")
        self.assertEqual(grouped.model_dump(), {"name": "活动图", "group": "purpose"})
        self.assertIsNone(legacy.group)

    def test_background_generation_schemas(self):
        created = datetime(2026, 1, 1, 12, 0, 0)
        create = BackgroundBatchCreate(
            purpose="运营背景",
            scene="海滩",
            mood=["轻松", "热带"],
            color_style="明亮高饱和",
            whitespace_positions=["right", "top"],
            size_ratio="16:9",
            localized=True,
            game_feel="strong",
            count=4,
            model_config_id=9,
            session_id=12,
            reference_asset_ids=[1, 2],
        )
        review = BackgroundImageReviewRequest(review_status="approved")
        archive = BackgroundImageArchiveRequest(tags=["运营背景", "海滩"], is_recommended=True)
        image = BackgroundImageResponse.model_validate(
            SimpleNamespace(
                id=5,
                batch_id=3,
                image_url="/static/assets/background-1.png",
                thumbnail_url="/static/assets/background-1-thumb.png",
                review_status="pending",
                is_recommended=False,
                tags={"purpose": "运营背景"},
                use_count=2,
                created_at=created,
            )
        )
        batch = BackgroundBatchResponse.model_validate(
            SimpleNamespace(
                id=3,
                purpose="运营背景",
                scene="海滩",
                mood=["轻松", "热带"],
                color_style="明亮高饱和",
                whitespace_positions=["right", "top"],
                size_ratio="16:9",
                localized=True,
                game_feel="strong",
                count=4,
                status="draft",
                session_id=12,
                model_config_id=9,
                created_by=1,
                created_at=created,
                images=[image],
            )
        )
        refine = BackgroundImageRefineRequest(
            model_config_id=9,
            refine_prompt="增强光影层次、去掉右下角多余元素",
        )

        self.assertEqual(create.reference_asset_ids, [1, 2])
        self.assertEqual(create.whitespace_positions, ["right", "top"])
        self.assertEqual(review.review_status, "approved")
        self.assertEqual(refine.refine_prompt, "增强光影层次、去掉右下角多余元素")
        self.assertEqual(archive.tags, ["运营背景", "海滩"])
        self.assertEqual(image.use_count, 2)
        self.assertEqual(batch.images[0].batch_id, 3)
        self.assertEqual(create.count, 4)

    def test_background_generate_request_requires_model_config_id_and_count(self):
        req = BackgroundBatchGenerateRequest(model_config_id=7, count=6)

        self.assertEqual(req.model_config_id, 7)
        self.assertEqual(req.count, 6)

    def test_background_generate_request_validates_count_range(self):
        with self.assertRaises(ValidationError):
            BackgroundBatchGenerateRequest(model_config_id=7, count=0)

        with self.assertRaises(ValidationError):
            BackgroundBatchGenerateRequest(model_config_id=7, count=9)

    def test_generate_review_and_stats_schemas(self):
        generate = ImageGenerateRequest(
            task_id=1,
            model_config_id=10,
            model_provider="openai",
            model_name="gpt-image-1",
            prompt="draw",
            size="1080x1350",
        )
        generated = ImageGenerateResponse(
            task_id=1,
            model_provider="openai",
            model_name="gpt-image-1",
            images=[{"image_id": 1, "url": "/x.png", "type": "draft"}],
            token_used=2300,
            cost_usd=Decimal("0.2200"),
        )
        log = GenerationLogResponse.model_validate(
            SimpleNamespace(
                id=1,
                task_id=1,
                operator_id=1,
                model_provider="openai",
                model_name="gpt-image-1",
                prompt="draw",
                image_count=1,
                token_used=2300,
                cost_usd=Decimal("0.2200"),
                status="success",
                created_at=datetime(2026, 1, 1, 12, 0, 0),
            )
        )
        review = ReviewSubmitRequest(image_id=1, score=95, status="pass", tags=["brand"])
        review_response = ReviewResponse.model_validate(
            SimpleNamespace(
                id=1,
                image_id=1,
                reviewer_id=2,
                score=95,
                status="pass",
                reason=None,
                tags="brand",
                created_at=datetime(2026, 1, 1, 12, 0, 0),
            )
        )
        dashboard = DashboardStats(
            today_tasks=1,
            today_cost_usd=Decimal("0.22"),
            today_images=2,
            pending_reviews=3,
        )
        daily = DailyCostStat.model_validate(
            SimpleNamespace(
                id=1,
                stat_date=date(2026, 1, 1),
                user_id=1,
                model_provider="openai",
                total_tokens=2300,
                total_cost=Decimal("0.2200"),
                image_count=2,
            )
        )
        model_stat = ModelStat(model_provider="openai", total_tokens=2300, total_cost=Decimal("0.22"), image_count=2)
        user_stat = UserStat(user_id=1, username="admin", total_tokens=2300, total_cost=Decimal("0.22"), image_count=2)
        publish_create = PublishStatCreate(image_id=1, publish_date=date(2026, 1, 1))
        publish_response = PublishStatResponse.model_validate(
            SimpleNamespace(
                id=1,
                image_id=1,
                final_image_id=None,
                publish_date=date(2026, 1, 1),
                channel="facebook",
                likes=10,
                comments=2,
                shares=1,
                notes=None,
                created_at=datetime(2026, 1, 1, 12, 0, 0),
            )
        )

        self.assertEqual(generate.model_config_id, 10)
        self.assertEqual(generate.count, 4)
        self.assertEqual(generated.token_used, 2300)
        self.assertEqual(log.status, "success")
        self.assertEqual(review_response.score, 95)
        self.assertEqual(review.tags, ["brand"])
        self.assertEqual(dashboard.pending_reviews, 3)
        self.assertEqual(daily.total_cost, Decimal("0.2200"))
        self.assertEqual(model_stat.model_provider, "openai")
        self.assertEqual(user_stat.username, "admin")
        self.assertEqual(publish_create.likes, 0)
        self.assertEqual(publish_response.channel, "facebook")

    def test_model_config_schemas_mask_api_key(self):
        created_at = datetime(2026, 1, 1, 12, 0, 0)
        create = ModelConfigCreate(
            name="GPT Image 1",
            provider="openai",
            model_name="gpt-image-1",
            api_key="sk-test-123456",
            price_per_image=Decimal("0.040000"),
            daily_limit=Decimal("20.00"),
        )
        update = ModelConfigUpdate(base_url="https://proxy.example.com")
        usage_update = ModelConfigUpdate(usage_type="final")
        response = ModelConfigResponse.from_model(
            SimpleNamespace(
                id=1,
                name="GPT Image 1",
                provider="openai",
                model_name="gpt-image-1",
                api_key="sk-test-123456",
                base_url=None,
                usage_type="draft",
                price_per_image=Decimal("0.040000"),
                daily_limit=Decimal("20.00"),
                used_today=Decimal("0.0000"),
                active=True,
                created_at=created_at,
                updated_at=created_at,
            )
        )

        self.assertEqual(create.model_name, "gpt-image-1")
        self.assertEqual(create.usage_type, "both")
        self.assertEqual(usage_update.usage_type, "final")
        self.assertEqual(update.base_url, "https://proxy.example.com")
        self.assertEqual(response.api_key, "3456")
        self.assertEqual(response.usage_type, "draft")

    def test_activity_template_schemas(self):
        created_at = datetime(2026, 1, 1, 12, 0, 0)
        type_response = ActivityTemplateTypeResponse.model_validate(
            SimpleNamespace(
                id=1,
                name="回访召回",
                code="revisit",
                sort_order=1,
                created_at=created_at,
            )
        )
        create = ActivityTemplateCreate(
            template_no="T01",
            name="老用户回流",
            type_id=1,
            structure_layer1="主视觉区",
            structure_layer2="文案区",
            structure_layer3="行动区",
            prompt_template="{TITLE} {SUBTITLE} {REWARD_AMOUNT} {BONUS_TYPE}",
            style_tag="3D卡通",
            created_by=1,
        )
        update = ActivityTemplateUpdate(name="老用户回流升级", is_active=False)
        response = ActivityTemplateResponse.model_validate(
            SimpleNamespace(
                id=1,
                template_no="T01",
                name="老用户回流",
                type_id=1,
                type_name="回访召回",
                structure_layer1="主视觉区",
                structure_layer2="文案区",
                structure_layer3="行动区",
                prompt_template="{TITLE} {SUBTITLE} {REWARD_AMOUNT} {BONUS_TYPE}",
                usage_scenario="召回活动",
                bg_description="金币雨背景",
                forbidden_rules="禁止中文",
                style_guide="品牌活动图使用高饱和金币风格",
                style_tag="3D卡通",
                rule_character="使用标准牛角色",
                rule_scene="节日庆典大厅",
                rule_visual="奖励居中展示",
                rule_copy="主标题不超过6词",
                rule_button="按钮高对比",
                rule_quality="高清无错别字",
                rule_forbidden="禁止额外角色",
                is_active=True,
                created_by=1,
                created_at=created_at,
                updated_at=created_at,
                fields=[
                    SimpleNamespace(
                        id=11,
                        template_id=1,
                        field_key="title",
                        field_name="主标题",
                        field_type="text",
                        is_required=True,
                        default_value="Come Back & Get Rewards",
                        hint="最多6个英文词",
                        options_json=None,
                        sort_order=1,
                        created_at=created_at,
                    )
                ],
            )
        )
        field_create = ActivityFieldDefinitionCreate(
            template_id=1,
            field_key="bonus_type",
            field_name="奖励类型",
            field_type="select",
            is_required=True,
            default_value="Coins",
            hint=None,
            options_json=["Coins", "Bonus"],
            sort_order=4,
        )
        field_response = ActivityFieldDefinitionResponse.model_validate(
            SimpleNamespace(
                id=12,
                template_id=1,
                field_key="cta_text",
                field_name="按钮文字",
                field_type="select",
                is_required=True,
                default_value="Claim Now",
                hint=None,
                options_json=["Claim Now", "Play Now"],
                sort_order=5,
                created_at=created_at,
            )
        )
        preset = ActivityVariablePresetResponse.model_validate(
            SimpleNamespace(
                id=1,
                var_type="reward_amount",
                value="1000",
                label="1000",
                sort_order=1,
            )
        )
        job_create = ActivityGenerationJobCreate(
            template_id=1,
            task_id=10,
            model_config_id=5,
            variables_json={"TITLE": "Come Back", "REWARD_AMOUNT": "1000"},
            reference_asset_ids=[1, 2],
            ad_size="1080x1920",
        )
        job_response = ActivityGenerationJobResponse.model_validate(
            SimpleNamespace(
                id=1,
                template_id=1,
                task_id=10,
                operator_id=2,
                variables_json={"TITLE": "Come Back"},
                prompt_rendered="Prompt text",
                model_config_id=5,
                status="qc_pending",
                qc_result={"reward_visible": True, "action_clear": True, "character_consistent": False},
                reject_reason=None,
                image_url="https://example.com/image.png",
                cost_usd=Decimal("0.1200"),
                token_used=320,
                created_at=created_at,
                updated_at=created_at,
            )
        )
        qc_submit = QCSubmitRequest(
            reward_visible=True,
            action_clear=True,
            character_consistent=False,
            reject_reason="character drift",
        )

        self.assertEqual(type_response.code, "revisit")
        self.assertEqual(create.template_no, "T01")
        self.assertEqual(create.style_tag, "3D卡通")
        self.assertFalse(update.is_active)
        self.assertEqual(response.usage_scenario, "召回活动")
        self.assertEqual(response.style_guide, "品牌活动图使用高饱和金币风格")
        self.assertEqual(response.style_tag, "3D卡通")
        self.assertEqual(response.fields[0].field_key, "title")
        self.assertEqual(field_create.options_json, ["Coins", "Bonus"])
        self.assertEqual(field_response.default_value, "Claim Now")
        self.assertEqual(response.type_name, "回访召回")
        self.assertEqual(preset.var_type, "reward_amount")
        self.assertEqual(job_create.variables_json["TITLE"], "Come Back")
        self.assertEqual(job_create.reference_asset_ids, [1, 2])
        self.assertEqual(job_create.ad_size, "1080x1920")
        self.assertEqual(job_response.status, "qc_pending")
        self.assertEqual(qc_submit.reject_reason, "character drift")

    def test_activity_template_schema_validation(self):
        valid_template = ActivityTemplateCreate(
            template_no="TX1",
            name="valid template",
            type_id=1,
            structure_layer1="主视觉区",
            structure_layer2="文案区",
            structure_layer3="行动区",
            prompt_template="{TITLE}",
        )
        self.assertEqual(valid_template.template_no, "TX1")

        with self.assertRaises(ValidationError):
            ActivityTemplateCreate(
                template_no="",
                name="invalid template",
                type_id=1,
                structure_layer1="主视觉区",
                structure_layer2="文案区",
                structure_layer3="行动区",
                prompt_template="{TITLE}",
            )

        with self.assertRaises(ValidationError):
            ActivityVariablePresetResponse.model_validate(
                SimpleNamespace(
                    id=1,
                    var_type="invalid",
                    value="x",
                    label="x",
                    sort_order=1,
                )
            )

    def test_activity_batch_schemas(self):
        created_at = datetime(2026, 1, 1, 12, 0, 0)
        create = ActivityBatchCreate(
            template_id=1,
            task_id=10,
            model_config_id=5,
            variables_json={"title": "Come Back"},
            global_extra_prompt="金币更闪亮",
            ad_size="1080x1920",
            reference_asset_ids=[1, 2],
            image_configs=[{"extra_prompt": "按钮更醒目"}],
        )
        image_response = ActivityBatchImageResponse.model_validate(
            SimpleNamespace(
                id=20,
                batch_id=3,
                image_url="/static/generated/a.png",
                extra_prompt="按钮更醒目",
                refine_prompt=None,
                parent_image_id=None,
                prompt_rendered="Prompt text",
                status="done",
                cost_usd=Decimal("0.120000"),
                token_used=320,
                sort_order=0,
                created_at=created_at,
            )
        )
        batch_response = ActivityBatchResponse.model_validate(
            SimpleNamespace(
                id=3,
                template_id=1,
                task_id=10,
                status="reviewing",
                ad_size="1080x1920",
                global_extra_prompt="金币更闪亮",
                model_config_id=5,
                images=[image_response],
                created_at=created_at,
                updated_at=created_at,
            )
        )
        refine = ActivityBatchRefineRequest(image_id=20, refine_prompt="修正角色手部")
        archive = ActivityBatchArchiveRequest(image_id=20)

        self.assertEqual(create.reference_asset_ids, [1, 2])
        self.assertEqual(create.image_configs[0]["extra_prompt"], "按钮更醒目")
        self.assertEqual(image_response.status, "done")
        self.assertEqual(batch_response.images[0].image_url, "/static/generated/a.png")
        self.assertEqual(refine.refine_prompt, "修正角色手部")
        self.assertEqual(archive.image_id, 20)

    def test_background_batch_schemas_include_extra_prompt(self):
        created_at = datetime(2026, 1, 1, 12, 0, 0)
        create = BackgroundBatchCreate(
            purpose="活动",
            scene="海边",
            mood=["轻松"],
            color_style="蓝金",
            whitespace_positions=["right"],
            size_ratio="16:9",
            localized=False,
            game_feel="medium",
            extra_prompt="地方集市，摊位密集",
            reference_asset_ids=[1],
        )
        image_response = BackgroundImageResponse.model_validate(
            SimpleNamespace(
                id=1,
                batch_id=2,
                asset_id=None,
                image_url="/static/generated/a.png",
                thumbnail_url="/static/generated/a.png",
                review_status="pending",
                is_recommended=False,
                tags=None,
                use_count=0,
                created_at=created_at,
            )
        )
        batch_response = BackgroundBatchResponse.model_validate(
            SimpleNamespace(
                id=2,
                purpose="活动",
                scene="海边",
                mood=["轻松"],
                color_style="蓝金",
                whitespace_positions=["right"],
                size_ratio="16:9",
                localized=False,
                game_feel="medium",
                extra_prompt="地方集市，摊位密集",
                count=4,
                status="draft",
                session_id=8,
                model_config_id=None,
                created_by=1,
                created_at=created_at,
                images=[image_response],
            )
        )

        self.assertEqual(create.extra_prompt, "地方集市，摊位密集")
        self.assertEqual(batch_response.extra_prompt, "地方集市，摊位密集")

    def test_user_model_permission_schemas(self):
        created_at = datetime(2026, 1, 1, 12, 0, 0)
        grant = PermissionGrant(user_id=2, model_config_id=10)
        response = PermissionResponse(
            user_id=2,
            model_config_id=10,
            model_name="gpt-image-1",
            username="operator",
            created_at=created_at,
        )

        self.assertEqual(grant.user_id, 2)
        self.assertEqual(grant.model_config_id, 10)
        self.assertEqual(response.username, "operator")

    def test_instruction_schemas(self):
        created_at = datetime(2026, 1, 1, 12, 0, 0)
        workflow = WorkflowTypeResponse.model_validate(
            SimpleNamespace(
                id=1,
                name="表情制作",
                slug="expression",
                description="牛角色表情图片生产工作流",
                active=True,
                created_at=created_at,
            )
        )
        create = InstructionCreate(
            workflow_type_id=1,
            name="高兴表情",
            content="生成高兴的牛角色表情",
            tags="高兴,表情",
        )
        update = InstructionUpdate(active=False)
        response = InstructionResponse.model_validate(
            SimpleNamespace(
                id=10,
                workflow_type_id=1,
                name="高兴表情",
                content="生成高兴的牛角色表情",
                tags="高兴,表情",
                active=True,
                created_by=1,
                created_at=created_at,
                updated_at=created_at,
            )
        )

        self.assertEqual(workflow.slug, "expression")

    def test_gallery_tag_schemas(self):
        create = GalleryTagCreate(name_en="cartoon-3d", name_zh="3D卡通", source_type="activity")
        update = GalleryTagUpdate(name_en="gold-coins", name_zh="金币风")
        response = GalleryTagResponse.model_validate(
            SimpleNamespace(
                id=1,
                name="cartoon-3d",
                name_en="cartoon-3d",
                name_zh="3D卡通",
                source_type="activity",
                image_count=2,
            )
        )

        self.assertEqual(create.source_type, "activity")
        self.assertEqual(create.name_en, "cartoon-3d")
        self.assertEqual(update.name_zh, "金币风")
        self.assertEqual(response.image_count, 2)
        self.assertEqual(response.name_zh, "3D卡通")

    def test_asset_tag_schemas(self):
        create = AssetTagCreate(
            name_en="happy",
            name_zh="高兴",
            category="expression",
            tag_group=None,
        )
        update = AssetTagUpdate(name_en="joyful", name_zh="开心", tag_group="purpose")
        response = AssetTagResponse.model_validate(
            SimpleNamespace(
                id=1,
                name="happy",
                name_en="happy",
                name_zh="高兴",
                category="expression",
                tag_group=None,
                image_count=2,
            )
        )

        self.assertEqual(create.name_en, "happy")
        self.assertEqual(update.name_zh, "开心")
        self.assertEqual(response.name_en, "happy")
        self.assertEqual(response.image_count, 2)

    def test_validation_rejects_invalid_review_score(self):
        with self.assertRaises(ValidationError):
            ReviewSubmitRequest(image_id=1, score=101, status="pass")


if __name__ == "__main__":
    unittest.main()
