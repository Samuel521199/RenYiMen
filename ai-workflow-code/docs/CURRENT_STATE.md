# Current State

## Video Workflow Snapshot (2026-05-07)

- 视频工作流 7 个步骤已全部打通，入口为 `/videos` 和 `/workflows/video`。
- 当前后端已具备：
  - `video_jobs`、`video_drafts`、`video_motion_data` 数据表
  - `video_generate_service.py` 的 302.ai Kling 异步生成链路（base64 图片）
  - `video_draft` 路由的草稿生成、列表、选择持久化、`draft_type` 区分
  - `video_motion` 路由的动作结构保存
  - `video_jobs` 路由的状态更新、代理下载、FFmpeg compose
  - `model_configs` 的 `purpose` 字段，支持 `video_draft` / `video_final`
  - 视频供应商配置：Kling Video、Google Veo、Runway
- 当前前端已具备：
  - Step 1 `FirstFramePicker`：三源选帧
  - Step 2 `DraftExplorer`：真实 Kling 草稿生成
  - Step 3 `MotionExtractor`：时间轴动作标记
  - Step 4 `MotionFXConfig`：程序动效预设
  - Step 5 `FinalGenerator`：精品生成与终稿选择
  - Step 6 `PostProcessor`：字幕 / CTA / Logo 后处理配置
  - Step 7 `ExportArchiver`：终稿预览、下载、归档
- 已完成验证：
  - Kling v2.6-std 草稿生成可用（约 `$0.21/条`）
  - Kling O3-pro 精品生成可用（约 `$0.56/条`，带音效）
  - base64 图片传输可用，不依赖公网图片地址
  - 视频任务状态可持久化并恢复
  - compose-all 全链路已打通：Logo 圆角叠加、字幕淡入、CTA 呼吸脉冲、camera/global 动效均已生效
  - 视频成品库 `/gallery/video` 已上线
  - 视频工作台草稿/已完成分 Tab
  - negative_prompt 抑制文字渲染
  - 情绪/动作标签扩充至 15/13 类
- 当前未完成 / 待修复：
  - 音频素材库未完成
  - `aspectRatio` 持久化存在一致性问题，Step 2 选择后恢复会丢失

## Backend

- Runtime foundation exists for settings, async database sessions, response helpers, JWT, and password hashing.
- `docs/WORKFLOW_DEVELOPMENT_CHECKLIST.md` now documents the current standard checklist for building any new workflow, including backend reference-image/archive/session rules, frontend Step 4/5/6 patterns, and release verification commands.
- Latest backend test baseline: 131 tests pass.
- Share workflow backend route is registered through `backend/app/routers/share_workflows.py`.
- Share game instruction templates are now backed by `share_game_instructions` in `backend/migrations/init.sql` and `backend/app/models/share.py`.
- `backend/app/routers/share_workflows.py` now also exposes share game-instruction admin APIs:
  - `GET /api/share/game-instructions`
  - `POST /api/share/game-instructions`
  - `PUT /api/share/game-instructions/{id}`
  - `PATCH /api/share/game-instructions/{id}/toggle`
  - `DELETE /api/share/game-instructions/{id}`
  - `PUT /api/share/game-types/rename`
- Database schema is represented in two layers:
  - SQL DDL: `backend/migrations/init.sql`
  - ORM models: `backend/app/models/`
- API validation schemas are ready in `backend/app/schemas/` and use Pydantic v2.
- Response schemas support ORM conversion with `ConfigDict(from_attributes=True)`.
- Router modules are ready in `backend/app/routers/` and expose the planned HTTP paths.
- Router functions use `get_db`, protected routes use `get_current_user`, and responses use `ok()`.
- `backend/tests/test_routers.py` now includes 10 `daily_post` route tests for template and job APIs; the file currently passes with 47 tests.
- `backend/app/routers/users.py` also exposes API key management endpoints for frontend admin screens.
- API key list responses return only the last 4 characters in the `api_key` field.
- `backend/app/routers/model_configs.py` exposes model configuration CRUD:
  - `POST /api/model-configs/create`
  - `GET /api/model-configs`
  - `PUT /api/model-configs/{id}`
  - `DELETE /api/model-configs/{id}`
  - `PATCH /api/model-configs/{id}/toggle`
- Model configuration responses never return the full API key; `api_key` is masked to the last 4 characters.
- Model configuration rows include `usage_type` (`draft`, `final`, or `both`) for distinguishing low-cost exploration models from high-quality final models. The field is present in `backend/migrations/init.sql`, SQLAlchemy, Pydantic create/update/response schemas, and the running Docker Postgres database.
- `backend/app/routers/permissions.py` exposes user/model permission endpoints:
  - `POST /api/permissions/grant`
  - `DELETE /api/permissions/revoke`
  - `GET /api/permissions/user/{user_id}`
  - `GET /api/model-configs/available`
- Admin users bypass model permission filtering and receive all active model configs from `/api/model-configs/available`.
- `backend/app/routers/stats.py` exposes image performance ranking from `publish_stats`.
- `backend/app/routers/instructions.py` exposes workflow type and instruction library endpoints:
  - `GET /api/workflow-types`
  - `POST /api/workflow-types/create`
  - `GET /api/instructions?workflow_type_id=xxx`
  - `POST /api/instructions/create`
  - `PUT /api/instructions/{id}`
  - `DELETE /api/instructions/{id}`
  - `PATCH /api/instructions/{id}/toggle`
- `backend/app/models/instruction.py` maps `WorkflowType` and `Instruction`.
- Running Postgres includes default workflow type `表情制作` with slug `expression`.
- `daily_post` workflow backend scaffolding is in place through `backend/app/models/daily_post.py`, `backend/app/schemas/daily_post.py`, `backend/app/routers/daily_post_workflows.py`, and `backend/app/main.py`; the manual SQL migration for `daily_post_templates` and `daily_post_jobs` is prepared for operator execution.
- `share` workflow Phase 1 backend scaffolding is now in place through `backend/app/models/share.py`, `backend/app/schemas/share.py`, `backend/app/services/_model_imports.py`, and the manual SQL additions in `backend/migrations/init.sql` for `share_bull_actions`, `share_backgrounds`, `share_color_moods`, and `share_jobs`.
- `backend/app/routers/daily_post_workflows.py` now accepts `reference_asset_ids` on `POST /api/daily-post/jobs/{id}/generate` and forwards them into `ImageGenerateRequest` for reference-guided generation.
- `backend/app/models/daily_post.py`, `backend/app/schemas/daily_post.py`, and `backend/app/routers/daily_post_workflows.py` now expose daily-post bull-action / background / color-mood option tables plus `GET`/`POST` APIs for operator-defined custom options.
- `daily_post_jobs` now includes `image_language` (`english` / `taglish` / `chinese`) in ORM and API schemas; `backend/app/routers/daily_post_workflows.py` appends strict on-image text language rules plus Filipino Facebook tone guidance to the daily-post generation prompt, and older null jobs serialize with a fallback of `english`.
- `backend/app/routers/daily_post_workflows.py` now writes archived daily-post images into `FinalImage` and increments `GalleryTag` counts when QC passes with `status="archived"`.
- `backend/app/schemas/activity_template.py` now treats `template_no` as a flexible non-empty string up to 20 characters at the API schema layer, instead of enforcing the older `T01`-`T25` regex.
- `backend/app/models/workflow_session.py` maps persisted workflow drafts/completions in `workflow_sessions`.
- `backend/app/routers/workflow_sessions.py` exposes workflow session persistence endpoints:
  - `POST /api/workflow-sessions/save`
  - `GET /api/workflow-sessions?status=draft&workflow_type=expression&mode=full`
  - `GET /api/workflow-sessions/{id}`
  - `DELETE /api/workflow-sessions/{id}`
- Running Postgres has the `workflow_sessions` table for expression workflow drafts and completed sessions.
- Background generation is now wired in end-to-end:
  - `backend/app/models/background.py`
  - `backend/app/schemas/background.py`
  - `backend/app/routers/background.py`
  - `background_generation_batches` / `background_images`
  - `workflow_type="background"` sessions for the new workflow page
- Background AI generation now uses the real image gateway path:
  - `background_generation_batches` now includes nullable `extra_prompt`; startup runtime schema sync also applies `ALTER TABLE background_generation_batches ADD COLUMN IF NOT EXISTS extra_prompt TEXT DEFAULT NULL` for existing databases.
  - `backend/app/services/background_prompt.py` builds the final prompt from batch fields, localized flag, whitespace positions, and guardrails.
  - When `batch.extra_prompt` is present, the prompt inserts an `Additional details:` block before `Restrictions:` so scene-detail guidance is applied before negative constraints.
  - `backend/app/services/background_prompt.py` also supports per-image refine overlays through `append_refinement_instructions()`, inserting `Refinement instructions:` immediately before the shared `Restrictions:` section.
  - `game_feel` is rendered through an atmosphere-first copy map: `weak` stays natural and realistic, `medium` adds subtle game-world lighting/tone without specific props, and `strong` pushes a more epic fantasy world atmosphere.
  - The prompt guardrails explicitly forbid `game props, coins, treasure boxes, or UI elements`, so background generations are steered toward scene mood instead of concrete item placement.
  - `backend/app/services/background_prompt.py` also maps workflow aspect ratios to provider-ready pixel sizes: `1:1 -> 1024x1024`, `4:5 -> 1024x1280`, `16:9 -> 1920x1080`, `9:16 -> 1080x1920`.
  - `GET /api/background/available-models` returns all active models the current user can access, without filtering by `usage_type`, so background sketching can use `draft`, `final`, or `both` models.
  - `GET /api/background/available-models?mode=refine` narrows the list to OpenAI-backed `final` / `both` models for image-edit-style refine flows.
  - `POST /api/background/batches/{id}/generate` requires `model_config_id` plus `count (1-8)`, accepts any active permitted model type, persists `batch.count` from the latest generation request, maps `batch.size_ratio` to pixels before calling the gateway, and now treats normal multi-image generation as `N` sequential `count=1` gateway calls so `gpt-image` models can reliably produce multiple rows.
  - Background batch generation now tolerates partial upstream failures during those sequential calls: successful image URLs are still written into `background_images`, and only the all-failed case returns `502`.
  - Single-image regenerate (`regenerate_image_id`) still uses the original single gateway call path and replaces the existing row in place.
  - `POST /api/background/images/{id}/refine` accepts `model_config_id`, rebuilds the original batch prompt, sends the current `background_image.image_url` into the gateway as a single reference image, and replaces the same row's `image_url` / `thumbnail_url` with the refined result.
  - `POST /api/background/images/{id}/refine` now also accepts optional `refine_prompt`; when provided, that per-image instruction is appended to the refine prompt before the restriction block, so operators can steer individual fixes such as stronger lighting or removing extra elements.
  - Single-image regenerate now replaces the existing `background_images` row instead of appending a duplicate candidate.
  - `POST /api/background/images/{id}/archive` now writes the approved background into `assets`, links matching existing `background` tags through `asset_tag_relations`, updates `background_images.asset_id`, and commits the whole archive operation as a single transaction.
  - Archive completion is now batch-aware: only when every `approved` / `refine` image in the batch has an `asset_id` does the batch move to `status='archived'` and its linked `workflow_sessions.status` move to `completed`; partial archive keeps the session in `draft` at Step 4.
  - Background workflow session payloads now persist `step` inside `state_json`, so background task-list progress can be rendered from the saved workflow state instead of only the top-level `current_step` column.
  - Latest live smoke check succeeded with `POST http://localhost:8000/api/background/images/1/refine` using refine model `id=8`, returning `200` and an updated background image payload.
  - Latest archive-completion smoke check used a real inserted background batch (`batch_id=7`, `session_id=75`): after archiving the first approved image, `SELECT status, current_step, state_json FROM workflow_sessions WHERE id = 75` returned `draft|4|{"batch_id": 7, "reference_asset_ids": [], "step": 4}`; after archiving the second approved image, the same query returned `completed|4|{"batch_id": 7, "reference_asset_ids": [], "step": 4}`.
  - Latest create-batch smoke check used `POST http://localhost:8000/api/background/batches/create` with `extra_prompt='地方集市，摊位密集'`; the API returned batch `id=8`, and `SELECT id, extra_prompt FROM background_generation_batches ORDER BY id DESC LIMIT 1` confirmed `8 | 地方集市，摊位密集`.
  - Latest multi-image generation smoke check used `POST http://localhost:8000/api/background/batches/10/generate` with OpenAI model `id=8` and `count=4`; backend logs showed 4 sequential `generate_image` calls, and `SELECT COUNT(*) FROM background_images WHERE batch_id = 10` confirmed `4`.
- FB活动图工作流 V2 is implemented end-to-end across models, schemas, routers, frontend pages, and runtime database:
  - Running Postgres now includes `activity_template_types`, `activity_templates`, `activity_variable_presets`, `activity_generation_jobs`, and `activity_field_definitions`.
  - `activity_templates` includes business-rule fields for `usage_scenario`, `bg_description`, `forbidden_rules`, `rule_character`, `style_guide`, `style_tag`, `rule_scene`, `rule_visual`, `rule_copy`, `rule_button`, `rule_quality`, and `rule_forbidden`.
  - `backend/app/routers/activity_workflows.py` exposes:
    - `GET /api/activity/template-types`
    - `GET /api/activity/templates`
    - `POST /api/activity/templates/create`
    - `PUT /api/activity/templates/{id}`
    - `POST /api/activity/templates/{id}/fields/reset-defaults`
    - `PATCH /api/activity/templates/{id}/toggle`
    - `DELETE /api/activity/templates/{id}`
    - `GET /api/activity/variable-presets`
    - `GET /api/activity/jobs`
    - `GET /api/activity/jobs/{id}`
    - `POST /api/activity/jobs/create`
    - `POST /api/activity/jobs/{id}/qc`
    - `POST /api/activity/jobs/{id}/archive`
  - `GET /api/activity/templates` returns each template with sorted `fields`.
  - Template create/update accepts a `fields` array and persists activity field definitions.
  - `POST /api/activity/jobs/create` stores operator-filled `variables_json` as `{field_key: value}`, accepts typed `reference_asset_ids` plus `ad_size`, resolves selected assets to reference image URLs, and persists a structured generated prompt from template rules, `style_guide`, visual structure, field content, forbidden rules, and formatted output size requirements.
  - `POST /api/activity/jobs/{id}/archive` now writes activity-source metadata into `final_images`: `source_type='activity'`, `sub_category=activity_template_types.code`, and `style_tag=activity_templates.style_tag`.
  - Running Postgres seed data now includes 5 activity template types and 11 variable presets for the workflow UI.
- `backend/app/utils/response.py` preserves empty lists as `data: []` instead of converting them to `{}`.
- Service modules are implemented in `backend/app/services/` and contain the primary backend business logic.
- AI provider calls are implemented through `httpx` in `ai_gateway.py`; unsupported providers return HTTP 501.
- `backend/app/services/ai_gateway.py` now loads generation credentials from `model_configs` by `model_config_id`; `ImageGenerateRequest.mode` is preserved so draft collage calls can be routed differently from final generation:
  - Uses database `api_key`, optional `base_url`, `provider`, and `model_name`.
  - No longer reads `OPENAI_API_KEY` or `GOOGLE_API_KEY` from settings for generation calls.
  - If `model_configs.base_url` is non-empty, the config is treated as an OpenAI-compatible relay such as aihubmix/laozhang regardless of `provider`.
  - Relay/OpenAI-compatible base URLs are normalized so values that already end in `/v1` do not get `/v1` appended twice.
  - Accepts reference image URLs from `/api/generate/image`, downloads them with `httpx`, converts successful downloads to base64, and silently falls back to text-only generation when downloads fail.
  - Local `/static/...` reference URLs are expanded to `http://localhost:8000/static/...` before download.
  - Reference image downloads are capped at 4 images. Each downloaded image is compressed with Pillow to JPEG, max 1024x1024 and about 500KB, before base64 encoding.
  - Gemini-style OpenAI-compatible relay calls use `/chat/completions`, not `/images/generations` or `/images/edits`.
  - Relay text-only calls send `请生成一张图片：{prompt}` as the user message content.
  - Relay image-reference calls send downloaded reference images as `image_url` data URIs in multimodal message content, followed by `参考以上图片风格，生成：{prompt}` text.
  - Relay responses are parsed from `choices[].message.multi_mod_content`, `choices[].message.images`, and `choices[].message.content`; URL responses are returned directly, and Markdown image data URIs such as `![image](data:image/jpeg;base64,...)`, normal `data:image/...;base64,...`, or raw PNG/JPEG/WebP base64 responses are saved through local storage and returned as `/static/...` URLs.
  - Relay `count` is handled by looping one `/chat/completions` request per requested image for non-draft calls because relays usually return one image per call. Draft-mode relay requests with `count > 1` call the provider once and rely on the prompt to request an N-grid collage; the gateway accepts either a single returned collage or multiple returned images.
  - If an individual relay generation fails, the error is logged and later iterations continue; any successful images are returned.
  - Relay/image-API saved base64 image filenames include a short UUID plus the generation sequence, e.g. `chat-generated-{task_id}-{uuid}-{index}.jpg`, to avoid overwrites across repeated generation calls for the same task.
  - OpenAI-compatible image API models such as `gpt-image-2-all`, `gpt-image-2`, `gpt-image-1`, `chatgpt-image`, and `dall-e` bypass relay chat/completions. With reference images they use `{base_url}/images/edits` as `multipart/form-data` with `image[]` file parts; without references they use `{base_url}/images/generations` JSON with `n=1`.
  - The older `gpt-image-2-all` `/chat/completions` helper remains available in code for fallback/reference, but normal `base_url` routing now treats `gpt-image-2-all` as an image API model.
  - Image API requests send `quality=high` and `output_format=png` for edits, parse pure `b64_json` responses without requiring a `data:image/...` prefix, and save returned base64 images into local static storage.
  - Native Google Gemini calls are used only when `provider=google` and `base_url` is empty; they keep text-only `contents.parts` when no reference image is available and prepend `inline_data` image parts when references download successfully.
  - Provider JSON calls use a 600-second timeout for slow official image models, wait 30 seconds after HTTP 429 before retrying, and use incremental retry backoff of 5 seconds then 10 seconds for other transient HTTP errors.
  - Updates `model_configs.used_today` after provider calls.
- `POST /api/generate/image` requires `model_config_id` and checks current-user permission before provider calls.
- `backend/app/routers/generate.py` resolves `reference_asset_ids` to asset `url` values and `draft_image_id` to `task_images.image_url`, then passes the resulting image URL list into `ai_gateway.generate_image`.
- Admin users bypass generation model permission checks and can use all active model configs.
- `backend/app/main.py` is the active FastAPI entrypoint and registers all routers.
- `backend/app/main.py` mounts the configured local storage directory at `/static`.
- `backend/app/routers/assets.py` accepts multipart file uploads and stores uploaded bytes through `storage_service`.
- `backend/app/services/storage_service.py` returns browser-loadable `/static/...` URLs for saved task images and assets.
- `final_images` now includes source-classification metadata columns:
  - `source_type` defaults to `expression`
  - `sub_category` is optional
  - `style_tag` is optional
- `backend/app/routers/gallery.py` now exposes:
  - `POST /api/gallery/save-final`
  - `GET /api/gallery/categories`
  - `GET /api/gallery/tags`
  - `GET /api/gallery/tags/manage`
  - `POST /api/gallery/tags/create`
  - `PATCH /api/gallery/tags/{tag_id}`
  - `DELETE /api/gallery/tags/{tag_id}`
  - `GET /api/gallery/finals`
  - `GET /api/gallery/{image_id}`
- Gallery category metadata is grouped into 6 top-level source types (`activity`, `share`, `daily`, `trending`, `brand`, `game`); activity sub-categories map `activity_template_types.code` to human-readable labels dynamically from the database.
- `gallery_tags` is an independent management table for成品图标签:
  - columns: `name`, `source_type`, `image_count`, `created_at`
  - unique key: `(source_type, name)`
  - activity archive writes/increments rows automatically when archived final images carry `style_tag`
- `gallery_tags` / `asset_tags` 后端双语字段已就绪：
  - ORM 和 schema 现已包含 `name_en`、`name_zh`
  - `assets.py` 与 `gallery.py` 标签相关接口源码已确认返回/处理双语字段
  - `POST /api/translate/tags` 与 `POST /api/translate/tags/fill-all` 已注册，可用于历史标签英文补全
- `backend/app/models/asset_tag.py` maps reusable category-scoped asset tags and the `asset_tag_relations` join table.
- `asset_tags` now includes nullable `tag_group` for grouped background tags; `backend/app/main.py` runtime schema sync adds the column idempotently and backfills known background tags into `purpose`, `scene`, `mood`, and `color_style`.
- Runtime startup now also seeds 20 initial `background` tags into `asset_tags` with `INSERT ... ON CONFLICT DO NOTHING`.
- Asset tags are available through:
  - `GET /api/assets/tags`
  - `POST /api/assets/upload` with comma-separated `tags`
  - `GET /api/assets?category=&tags=高兴,哭泣` using multi-tag intersection
- `GET /api/assets/tags` now returns object records shaped as `{name, group}`; non-background categories keep compatibility by returning `group: null`.
- Asset category counts are available through `GET /api/assets/stats`, returning `total` plus `by_category` counts for the asset library category filter.
- Asset tag management endpoints are available:
  - `POST /api/assets/tags/create`
  - `POST /api/assets/tags/create-inline`
  - `GET /api/assets/tags/manage?category=xxx`
  - `PATCH /api/assets/tags/{tag_id}`
  - `DELETE /api/assets/tags/{tag_id}`
- 标签管理当前状态：
  - 后端双语字段已就绪，源码已确认
  - 前端标签管理页已完成双语改造，素材标签与成品图标签表单均支持 `name_en` / `name_zh`
  - `frontend/components/common/TagCombobox.tsx` 已支持双字段内联创建，并提交 `{ name_en, name_zh, category, tag_group }`
- `frontend/lib/tag-display.ts` 已提供双语标签显示与缺失英文标签的补全触发封装
  - 历史数据 AI 补全（`fill-all`）待部署后手动触发一次
- 语言切换功能已完整接入：
  - `frontend/lib/i18n.ts` / `frontend/lib/LanguageContext.tsx` / `frontend/components/common/LanguageToggle.tsx` 已补入项目
  - `Topbar` 右上角可切换语言，根布局已包裹 `LanguageProvider`
  - `AppShell` 已将 `Topbar` 置于非登录布局顶部，语言按钮在全站可见
  - `Sidebar` 已接入双语切换，导航文字跟随当前语言变化
  - `i18n.ts` 已补齐导航区词条，`NAV_GROUPS` 所有 label 现均可被字典准确命中
  - `LanguageProvider` 现通过 `frontend/app/providers.tsx` 的客户端边界组件注入，避免 App Router 下的 Context 传递问题
  - 前端路由数保持 31 条
- 工作流/任务页面双语当前状态：
  - 已对 `workflows/*` 与 `tasks/*` 做过多轮接入，并完成一轮针对残留固定中文的批量扫描修复
  - 本轮重点补齐了 `expression`、`activity`、`daily-post` 的共享/遗漏 UI 文案，以及对应 `i18n.ts` 词条
  - `frontend/app/workflows/page.tsx` 所需词条现已在 `frontend/lib/i18n.ts` 补齐，包含草稿列表标题、进度列、任务名列和工作流管理描述
  - `frontend/components/workflow/StepLayout.tsx` 已接入 `useLanguage`，共享的 `上一步 / 下一步` 默认按钮文案现可随语言切换
  - 当前前端构建通过；最新 Docker 构建路由表为 `33` 条 app routes（包含 `/` 与 `/_not-found`），按业务页面统计仍为 31 个 `page.tsx` 页面 / 32 条可见页面路由口径
  - 如果后续仍有零散中文，优先继续从 `frontend/lib/i18n.ts` 缺词条或工作流页面中的固定 UI copy 排查，而不是改动动态数据/Prompt 文本
- Creating background tags now requires `tag_group`; non-background categories ignore it.
- Existing asset tag updates are available through `PATCH /api/assets/{id}/tags`; the endpoint updates `assets.tags` and rebuilds `asset_tag_relations`.
- Upload and existing asset tag updates are category-dynamic across all asset categories:
  - `POST /api/assets/upload` creates and links tag rows under the uploaded asset's submitted `category`.
  - `PATCH /api/assets/{id}/tags` creates and links tag rows under the asset's actual current `category`.
  - Running Postgres has been repaired so comma-separated `assets.tags` are backed by same-category `asset_tags` / `asset_tag_relations` for all categories; verification shows zero mismatched asset/tag category relations, and authenticated `GET /api/assets/tags?category=game_content` returns `["看牌紧张"]`.
- Tags persist independently of assets; deleting an asset removes only tag relations and leaves the tag row available with `image_count: 0`.
- `POST /api/assets/upload` accepts upload metadata from multipart form fields and query parameters; form fields are preferred for `filename`, `category`, and `tags`.
- `GET /` returns backend service status and version.
- `/docs` is available when running uvicorn and shows the registered API routes.
- Docker backend runtime is available through `backend/Dockerfile` and `docker-compose.yml`.
- `backend/app/models/trending.py`：新增 `TrendingNewsTask` ORM 模型。
- `backend/app/schemas/trending.py`：热点借势 Job 的完整 Pydantic schemas。
- `backend/app/schemas/trending_news.py`：新闻推送任务 schemas。
- `backend/app/services/trending_prompt.py`：Prompt 构建服务，包含标准版（`build_draft_prompt`/`build_final_prompt`/`build_refine_prompt`）和富字段版（`build_news_draft_prompt`）。
- `backend/app/services/hotspot_import_service.py`：`HotspotImportService` + `JsonFileHotspotAdapter`，含字段校验、枚举校验、去重、风险等级计算。
- `backend/app/routers/trending_workflows.py`：热点借势完整路由（topic-configs/jobs CRUD/generate-draft/generate-final/refine/archive）。
- `backend/app/routers/hotspot_import.py`：新闻热点导入路由（import/tasks/status）。
- `backend/app/routers/assets.py`：新增 `exclude_category` 参数支持。
- 当前后端测试：131 tests pass。

## Important Constraints

- `users.py`, `gallery.py`, and `audit.py` define small local request/response models where no dedicated schema file exists yet.
- AI gateway paths are implemented; `gpt-image-2-all` via APIYI has been live-tested. OpenAI-compatible Gemini relay Markdown parsing and draft single-call collage routing have unit coverage, but the latest draft routing change was not re-tested against a live paid generation call.
- Database integration tests are not yet present; current tests validate contracts and deterministic service logic.
- `backend/requirements.txt` now includes `uvicorn[standard]` and `python-multipart`.
- The repo directory is not currently detected as a git repository in this workspace.
- Local E2E frontend port is `3010` in `.env` because ports `3000` and `3001` were already occupied by unrelated local services during verification.

## Frontend

- Current frontend routes baseline: 33 routes.
- `frontend/app/workflows/share/page.tsx` is now live as the Share workflow page.
- Sidebar navigation now includes `转发图生产 -> /workflows/share`.
- Share workflow frontend is now organized as 6 steps, with generation config and game-instruction selection in Step 5, and combined generation + QC in Step 6.
- Share workflow Step 5 now loads enabled game instructions from `GET /api/share/game-instructions?game_type={gameType}` and sends selected instruction content through `game_instruction_contents` during generation.
- Share workflow now supports fixed autosave, manual draft save, and `?session_id=` restore on `/workflows/share`.
- `frontend/app/admin/share-instructions/page.tsx` is now live as the Share game-instruction admin page.
- The Share instruction admin page now supports inline game-name editing, and renaming a game updates all associated instruction rows.
- Sidebar navigation now also includes `转发图指令库 -> /admin/share-instructions`.
- Share workflow Step 4 reference selection now supports category switching across all asset categories except `background` and `props`, instead of only loading a fixed `character` category.
- `frontend/app/workflows/share/page.tsx` now implements the full Share workflow frontend:
  - Step 6: looped generation with `/api/share/jobs/create` and `/api/share/jobs/{job_id}/generate`, incremental image append, per-image refine, and generation progress UI
  - Step 7: split pending/archived QC review, per-image archive/send-back/delete/withdraw controls, and a completed-state panel linking to `/gallery`
- Share workflow frontend now autosaves through `/api/workflow-sessions/save` during step changes, generation progress, QC state changes, and completed-batch finalization.
- Latest Share workflow Phase 4-C verification passed with `npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`.
- `frontend/app/workflows/share/page.tsx` now implements real Step 4-5 UI for the Share workflow:
  - Step 4: character reference assets with tag filtering, multi-select grid, 4-image maximum, and selected preview/removal column
  - Step 5: ad-size selection, generate-count selection, and available-model cards filtered to `final / both`
- Share workflow frontend now loads Step 4-5 data from the backend:
  - `GET /api/assets?category=character`
  - `GET /api/assets/tags?category=character`
  - `GET /api/model-configs/available`
- Share workflow step gating now also blocks Step 5 -> 6 until `selectedModel` is chosen; when available models exist, the first model is auto-selected by default.
- Latest Share workflow Phase 4-B verification passed with `npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`.
- `frontend/app/workflows/share/page.tsx` now implements real Step 1-3 UI for the Share workflow:
  - Step 1: 4 share-type cards for `benefit / emotion / identity / information`
  - Step 2: `coreText`, `targetAudience`, and `Tongits / Pusoy` game-type inputs
  - Step 3: image-language cards for `english / taglish / chinese`
  - Step 4-7 remain placeholders for the later Share workflow phases
- Share workflow step gating is partially active on the frontend: Step 1 requires `shareType`, and Step 2 requires non-empty `coreText` before advancing.
- Latest Share workflow Phase 4-A verification passed with `npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`.
- `frontend/app/workflows/share/page.tsx` now provides the Share workflow skeleton page with 7 steps (`选择转发类型` through `审核 QC`), typed local workflow state, placeholder autosave, and bounded step navigation.
- `frontend/lib/constants.ts` now includes `转发图生产 -> /workflows/share` under `任务中心`, so the sidebar can expose the new Share workflow entry.
- Latest Share workflow verification passed with `npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`.
- `frontend/lib/api.ts`, `types.ts`, and `constants.ts` already contain useful implementation.
- `frontend/lib/auth.ts` now provides token storage helpers and lightweight JWT payload decoding.
- The global layout and sidebar are implemented.
- Topbar, common UI components, task table/status badge, image card/grid, and prompt editor are implemented with Tailwind classes.
- `AppShell` handles route-level shell behavior: `/login` renders without Sidebar, while other routes use the standard Sidebar layout.
- Frontend project configuration is now present:
  - Next.js 14 app scripts in `frontend/package.json`
  - TypeScript config with `@/*` path alias
  - Tailwind/PostCSS config for `app/`, `components/`, and `lib/`
  - Global Tailwind stylesheet at `frontend/app/globals.css`
- `npm install` works in `frontend/`; it currently reports 2 npm audit vulnerabilities from installed packages.
- `npm run build` succeeds and generates 26 routes.
- `frontend/components/workflow/` now provides a shared image-workflow component layer:
  - `ModelSelector.tsx`
  - `GenerateButton.tsx`
  - `ImageReviewCard.tsx`
  - `StepLayout.tsx`
  - `WorkflowStepHeader.tsx`
  - `WhitespacePositionPicker.tsx`
- `/workflows/background`, `/workflows/activity`, and `/workflows/expression` now consume shared workflow components instead of duplicating step-shell, model-selection, and generation-button UI logic; the background workflow also reuses the shared review card and extracted whitespace picker.
- The expression workflow keeps its existing 9-step behavior, but now renders its step rail/header plus draft/final/consistency model and generate controls through the shared workflow component layer.
- `frontend/components/workflow/ModelSelector.tsx` now accepts nullable/optional model metadata fields (`price_per_image`, `usage_type`) so it can be reused directly with `/api/model-configs/available` payloads returned by different workflow pages.
- `frontend/app/workflows/daily-post/page.tsx` now drives the 6-step daily post workflow end-to-end with real API loading, task/job creation, generation, QC archive, save-draft, and reset flows; `frontend/lib/constants.ts` still provides the daily post template enums used by the page.
- `frontend/app/workflows/daily-post/page.tsx` now loads bull-action / background / color-mood options from the API in Step 4 and supports inline custom creation before persisting the chosen values in session state.
- `frontend/app/workflows/daily-post/page.tsx` also supports optional role reference images in Step 4, persists `referenceAssetIds` in saved state, and sends them through job creation and generation requests.
- `frontend/app/workflows/daily-post/page.tsx` now also lets operators choose the image-text language in Step 3 (`English`, `Taglish`, `中文`), persists `imageLanguage` in workflow session state, and includes it in the Step 4 daily-post job-create payload.
- `frontend/app/workflows/daily-post/page.tsx` now uses Step 5 for model selection plus batch generation controls (`1-4` count, optional extra prompt, per-image refine) and Step 6 for multi-image QC/archive; Step 4 now only handles scene/config/reference setup before creating the Job.
- `frontend/app/workflows/daily-post/page.tsx` now adds fullscreen Step 5 image preview, Step 4 reference-panel job creation, ad-size selection, draft auto-save on step/image changes, and a final `completed` session write-back after QC archive.
- `frontend/app/workflows/daily-post/page.tsx` now also writes the returned `session_id` back after autosave, so repeated draft saves reuse the same session instead of creating new ones.
- `frontend/app/workflows/daily-post/page.tsx` now treats Step 6 as per-image review instead of whole-job QC: each generated image tracks `pending / archived / refine / deleted`, Step 6 supports per-image archive/refine/delete plus archive withdraw, and the workflow only completes when no `pending/refine` images remain and at least one image is archived.
- `frontend/app/workflows/page.tsx` now recognizes `daily_post` sessions in the task list with green badges, `日常互动图` labels, session-specific links, and no expression-style copy actions.
- `frontend/components/layout/Sidebar.tsx` now exposes `日常互动图` under `任务中心` immediately after `活动图生产`.
- `frontend/lib/workflow-components.test.ts` now includes render-level smoke coverage for the shared component layer by server-rendering `ModelSelector`, `GenerateButton`, `StepLayout`, and `WorkflowStepHeader` from transpiled component sources inside `node --test`.
- `frontend/app/admin/daily-post-templates/page.tsx` provides the daily post template management page with list/create/edit/toggle/delete flows, and `frontend/components/layout/Sidebar.tsx` now links `日常互动图模版` under `模版中心` to `/admin/daily-post-templates`.
- Latest frontend verification passed with `npm run build` and `28` routes, followed by `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/daily-post`.
- Latest workflow-component and daily-post verification passed with `node --test frontend/lib/sidebar-nav.test.ts`, `node --test frontend/lib/workflow-components.test.ts` (`13` passing tests), `node --test frontend/lib/expression-workflow.test.ts`, `node --test frontend/lib/background-workflow.test.ts`, `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_base_layer backend.tests.test_models backend.tests.test_schemas backend.tests.test_routers`, `npm run build` with `27` routes, `docker-compose up -d --build frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows` and `GET http://localhost:3010/workflows/daily-post`.
- `frontend/lib/api.ts` exports GET, POST, PUT, PATCH, DELETE, and upload helpers.
- Login, dashboard, task list, and task creation pages are implemented and use `apiGet` / `apiPost`.
- Task detail, prompt templates, asset library, and review center pages are implemented.
- Task detail loads `/api/model-configs/available`, lets the user choose an available model before draft/final generation, and sends `model_config_id` to `/api/generate/image`.
- If no active model is available to the current user, task detail generation buttons are disabled and display `无可用模型`.
- Task detail renders any task images returned by the API, plus newly generated images from the current session.
- Prompt and asset pages now use the shared PUT/DELETE helpers.
- Asset library supports multi-file image selection, sequential upload progress, and thumbnails loaded from `NEXT_PUBLIC_API_BASE + asset.url`.
- Asset library supports upload-time tags, category-scoped dropdown multi-select controls, custom Enter-created tags, multi-tag filtering, clear filter, and tag chips on each asset card.
- Asset library category buttons display image counts from `/api/assets/stats`; `全部` shows the total count, each concrete category shows its category count, and counts refresh after upload, delete, or batch migration.
- Asset library cards include `编辑标签`; the inline editor preselects the asset's current tags, loads existing tags for that asset category, accepts custom Enter-created tags, and saves through `PATCH /api/assets/{id}/tags`.
- Asset library tag interaction rules:
  - The top category bar remains the primary category switcher.
  - The "全部" view does not render tag filters.
  - Concrete category views load only that category's existing tags into a dropdown multi-select filter.
  - Upload tag options are loaded from the current upload category into a dropdown multi-select and can be extended with custom Enter-created tags.
- `ASSET_CATEGORIES` includes `background` (`背景`) and `props` (`道具`) for activity reference selection and asset-library classification.
- Asset uploads now submit `filename`, `category`, and `tags` through `FormData`.
- Asset tag management page is implemented at `/assets/tags`:
  - Category switcher matches the asset library categories.
  - Rows show tag name, category, group, and current image count.
  - Background tags expose a required `标签分组` selector for create/edit; non-background categories do not.
  - Tags can be created, edited, and deleted.
  - Delete confirmation states the affected image count and clarifies images are not deleted.
- Asset-library and expression-workflow tag consumers now normalize `/api/assets/tags` object payloads by reading `.name`.
- `frontend/components/common/TagCombobox.tsx` now provides shared searchable tag selection with single/multi-select chips and inline `create-inline` creation.
- `frontend/components/common/TagCombobox.tsx` now uses an explicit custom-tag mode:
  - normal state keeps a persistent `+ 自定义` text action on the right side of the input
  - custom mode changes the placeholder to `输入后按回车创建` and shows explicit `确认` / `取消` controls
  - confirming an exact existing tag selects it directly; confirming a new value creates it through `POST /api/assets/tags/create-inline`, refreshes options, and auto-selects it
- 热点借势手动工作流页面 `/workflows/trending` 已完成，支持6步流程、配置驱动约束、参考图模糊匹配、逐图审核归档。
- 热点借势新闻推送工作流页面 `/workflows/trending-news` 已完成，Step 1 从导入列表选热点，复用 trending 生成归档逻辑。
- 热点导入管理页面 `/admin/hotspot-import` 已完成，支持 JSON 文件上传、校验、导入结果展示、已导入列表管理。
- 当前前端路由总数：31条。
- 参考图选择组件已修复：排除 background 分类（`exclude_category=background`）、标签筛选使用 `tags=` 参数、useEffect 监听 refTagFilter 变化触发刷新、标签列表去重。
  - Escape or cancel leaves custom mode without creating a tag
- Activity template admin page now includes a `风格标签` field directly after `风格标准`; the field is persisted in the admin payload and feeds activity final-image archive metadata.
- Sidebar navigation supports the regrouped information architecture:
  - Single-link items: `首页看板`, `素材库`, `审核中心`, `成品图库`, and `统计中心`.
  - `任务中心` contains `任务列表` at `/workflows`, `表情制作` at `/workflows/expression`, and `活动图生产` at `/workflows/activity`.
  - `模版中心` contains `指令库` at `/instructions`, `Prompt 模版` at `/prompts`, and `活动图模版` at `/admin/activity-templates`.
  - `标签管理` contains `素材标签管理` at `/assets/tags` and `成品图标签管理` at `/gallery/tags`.
  - `管理后台` now contains only `用户管理`, `模型配置`, and `系统日志`.
- `/workflows/background` is now implemented as a four-step light-theme background workflow with dynamic background-tag loading, reference uploads, candidate review, refinement replacement upload, and archive-to-assets actions.
- Background workflow Step 1 now groups background tags directly from the API `group` field and no longer infers purpose/scene/mood/color groups from tag-name prefixes.
- Background workflow Step 1 now uses `TagCombobox` for `purpose` / `scene` / `mood` / `color_style`, shows seeded background options on first load, renames the localization toggle to `本地风格化`, stores leave-white selection in `whitespace_positions` multi-select state, and no longer asks for generation count at batch-creation time.
- Background workflow Step 1 now also includes an optional `补充描述` textarea; its value is kept in `formState.extraPrompt`, sent as `extra_prompt` on batch creation, and restored from batch detail/session data when returning to an existing workflow.
- Background workflow Step 1 reference uploads now explain the model constraint directly: after reference images are uploaded, Step 2 generation models are automatically limited to reference-image-capable `gpt-image`-style models, and non-reference-capable options such as Gemini are filtered out.
- Background workflow Step 1 now also renders a visual `WhitespacePositionPicker`:
  - a `160 x 200` SVG canvas shows dashed clickable regions for `top`, `bottom`, `left`, `right`, and `center`
  - region hover uses a lighter translucent fill and selected regions use a darker translucent fill
  - diagram clicks and the leave-white chips share the same `whitespacePositions` state, so both interaction surfaces stay synchronized
- Background workflow Step 2 now loads `/api/background/available-models`, requires explicit model selection, places a `生成数量` selector beside the model selector, and submits the chosen count with each batch-generate request.
- Background workflow Step 2 model loading now follows reference-image state:
  - when `referenceAssets.length > 0`, the page loads `GET /api/background/available-models?mode=refine`, so only image-edit-capable OpenAI models appear
- Background workflow Step 3 now supports per-image refine instructions:
  - each reviewed image card renders a `精修指令（可选）` textarea above the `AI 精修` button
  - the frontend keeps each card's text in `refinePromptByImageId[image.id]`
  - clicking `AI 精修` submits both `model_config_id` and the current image's `refine_prompt`
  - when no reference images are selected, the page falls back to `GET /api/background/available-models` and shows the full allowed model list
  - reference upload/removal triggers a model-list reload, and if the previously selected model is no longer valid, the selector auto-switches to the first available model and shows `已选模型不支持参考图，已自动切换`
- Background workflow Step 2 now re-fetches `GET /api/background/batches/{id}` immediately after each successful generate/regenerate request, so the `pending` candidate list refreshes from the latest persisted `images` data without a manual page reload.
- Background workflow Step 2 now partitions candidate cards into `待筛选` (`pending`) and `已通过` (`approved` + `refine`) sections:
  - pending cards expose `通过 / 废弃 / 重生成 / 精修`
  - approved/refine cards move into the passed section, render as read-only status cards, and can be `撤回` back to `pending`
  - rejected cards disappear from the pending list immediately because the UI renders that section from `review_status === "pending"` only
  - the `下一步：精修标准化` button stays disabled until the passed section contains at least one image
- When `batch.status === "archived"`, Background workflow Step 2 now locks generation controls:
  - the main generate button is disabled and its label changes from `开始生成` to `已入库`
  - a muted helper line appears below the controls: `该批次已入库，如需重新生成请新建任务`
  - each pending-card `重生成` button is also disabled, so archived batches cannot accidentally spawn more candidate images
- Background workflow Step 3 now has a dedicated refine-model selector sourced from `/api/background/available-models?mode=refine`, and the page clarifies that refine uses reference-image mode and only supports `gpt-image`-style OpenAI models.
- Background workflow Step 3 now also exposes an `AI 精修` action on each reviewed card beside `上传替换精修图`; the button uses the selected refine model, shows `精修中...` while running, and refreshes the batch after success so the new card image appears without a page reload.
- Background workflow Step 4 keeps archived images visible after success, disables repeat archive clicks with an `已入库` button state, shows a reuse hint for the activity workflow background selector, and now renders a green completion panel with `所有背景图已入库，本次任务完成` plus a `返回任务列表` button once no approved/refine images remain unarchived.
- `/workflows` now includes background sessions with a purple badge and direct links into `/workflows/background?session_id=...`.
- `/workflows` now renders background workflow progress from real session state: `status='completed'` shows `已完成`, while draft background sessions render `第 N 步` from `state_json.step` with fallback to `current_step`.
- Activity workflow Step 2 now shows a muted helper note above the background selector explaining that background-library assets can be reused directly and that new ones can be created from `/workflows/background`.
- `frontend/app/assets/page.tsx` displays asset `use_count`, with a background-specific badge style for background assets.

## 背景图标签命名约定

背景图（`category=background`）的标签在 `/assets/tags` 管理页创建时，
必须选择所属分组（`tag_group`）。分组定义如下：

| 分组字段 | 中文名 | 示例标签 |
| --- | --- | --- |
| purpose | 用途 | 活动图、日常互动图、热点图、节日图、通用 |
| scene | 场景 | 菲律宾街景、商场、夜市、海岛、室内、游戏大厅 |
| mood | 氛围 | 奖励感、幸运感、回归感、节日感、竞技感、轻松娱乐 |
| color_style | 颜色风格 | 蓝金、红金、紫金、清爽绿色、暖色调 |

**规则：**
1. 新建 `background` 标签时 `tag_group` 为必填，不允许留空
2. 非 `background` 分类的标签不需要填写 `tag_group`
3. 前端 Step 1 表单直接按 `tag_group` 值分组渲染，不做任何前缀推断
4. 如需新增分组类型，需同步更新本文档、前端表单、标签管理页下拉选项
- Workflow child nav items in Sidebar now share one helper-based class strategy, so `任务列表`、`表情制作`、`活动图生产` all render with the same text-style submenu treatment; active child items no longer use a dark filled block.
- `/gallery/tags` is now a full light-theme成品图标签管理页:
  - Top tabs switch across the 6 gallery `source_type` buckets.
  - Inline create uses the current active source type.
  - Rows support inline rename and delete confirmation, and show independent `gallery_tags.image_count`.
- `/admin/activity-templates` now keeps the top header focused on the page-level `新建模板` trigger, while the actual save/cancel controls live at the end of Section 4.
  - The bottom action bar is right-aligned, uses a wider gap between cancel/save, and the cancel button prompts before discarding unsaved edits.
  - The editor test suite now checks for the Section 4 action bar and confirmation copy.
- `/workflows` now lists both expression and activity workflow sessions:
  - Activity sessions are identified by `workflow_type='activity'`, rendered as `活动图生产`, and shown with a blue type badge.
  - Activity session links route to `/workflows/activity?session_id={id}`; expression session links keep the existing `/workflows/expression?session_id={id}` behavior.
  - Completed expression sessions still support copy-to-full/copy-to-retouch; activity completed sessions are opened directly instead of being copied into expression flows.
- Activity workflow refine UI now guards against duplicate clicks:
  - `refiningLoading` blocks repeat submissions while a refine request is in flight.
  - The refine button shows `生成中…`; both `重新生成` and `取消` stay disabled until the request completes or fails, then return to clickable state.
- `/gallery` is now a light-theme三级筛选图库:
  - Left-side directory tree supports `全部成品图`, top-level source types, and expandable sub-categories.
  - Right-side content area loads filtered images from `/api/gallery/finals` and style tags from `/api/gallery/tags`.
  - Tag chips filter by `style_tag`, and activity sub-category labels display the mapped template-type names returned by `/api/gallery/categories`.
- Activity workflow production page is implemented at `/workflows/activity`:
  - The activity image production flow is complete from template configuration to multi-image batch generation, QC/archive, and final-gallery availability.
  - Uses a 4-step light-theme operator flow: `选模板`, `填写内容`, `生成图片`, and `质检归档`.
  - Page state stores the selected template directly in `WorkflowState.selectedTemplate`, uses `activeTypeId: number | null` for type filtering, and keeps operator `fieldValues` as `Record<string, string>`.
  - Page state now uses activity batch fields for production results: `batchId`, `batchImages`, `batchStatus`, `globalExtraPrompt`, and per-image `imageConfigs`.
  - Step rail navigation uses the shared `getActivityStepCardClasses` helper and only allows returning to the current or previously completed steps.
  - Loads `/api/activity/template-types`, active `/api/activity/templates`, `/api/model-configs/available`, `/api/activity/batches/drafts`, and category-filtered `/api/assets` calls for optional reference image selection.
  - Step 1 shows template type tabs and template cards with template number, name, full usage scenario, and selected highlighting.
  - Step 1 shows a draft-resume banner when `/api/activity/batches/drafts` returns unfinished batches; resuming loads `/api/activity/batches/{id}` and enters Step 4.
  - Selecting a template resets workflow generation/QC/archive state, initializes field values from each field's `default_value`, and preserves any already selected model.
  - Step 2 renders operator input controls dynamically from the selected template's `fields`: `text`, `textarea`, `number`, `select`, and `switch`.
  - Step 2 auto-fills field defaults, validates required fields with field-name-specific messages, hides technical variable names, and provides a collapsed read-only output instruction preview marked as reference-only.
  - Step 2 lets operators choose activity ad placement size from `ACTIVITY_AD_SIZES`: `1080x1080` FB square or `1080x1920` TikTok vertical.
  - Step 2 provides three typed single-select reference panels: character references with asset-category tabs, background references fixed to `background`, and prop references fixed to `props`.
  - Step 3 creates a task with the selected `adSize` through `POST /api/tasks/create`, then calls `POST /api/activity/batches/create` with `template_id`, `task_id`, `model_config_id`, `variables_json` as `{field_key: value}`, selected `reference_asset_ids`, `ad_size`, `global_extra_prompt`, and `image_configs`.
  - Step 3 supports 1-4 generated images, a global auxiliary prompt, optional per-image auxiliary prompts, generation progress placeholders, and a small recent-batch thumbnail strip.
  - Step 4 shows three batch-level business QC checkboxes plus a per-image grid. Each non-deleted image can be archived, refined with a short prompt, or deleted.
  - Step 4 archive/refine/delete actions call `/api/activity/batches/{id}/archive-image`, `/api/activity/batches/{id}/refine`, and `/api/activity/batches/{id}/delete-image`; completed batches show `继续生产` and `查看图库`.
  - Step 4 can save the current batch through `/api/activity/batches/{id}/save-draft`.
  - Opening `/workflows/activity?session_id={id}` loads the workflow session, reads `state_json.batch_id`, loads the activity batch, and resumes directly at Step 4.
  - `frontend/lib/activity-production-workflow.ts` normalizes backend batch images from snake_case response fields into frontend camelCase view objects.
  - Latest activity batch frontend verification: `node --test frontend/lib/activity-production-workflow.test.ts` passed 10 tests, `npm run build` succeeded with 25 routes, `docker-compose up -d --build frontend` completed, and `/workflows/activity` returned HTTP 200.
- Instruction library page is implemented at `/instructions`:
  - Loads workflow types from `/api/workflow-types`.
  - Switches current workflow type.
  - Lists instructions from `/api/instructions?workflow_type_id=xxx`.
  - Supports inline create/edit, delete confirmation, and enable/disable toggle.
- Expression workflow page is implemented at `/workflows/expression`:
  - Single-page 9-step wizard with mode selection before Step 1.
  - Uses one `workflowState` object so backtracking preserves user input, with `sessionId` for persisted drafts.
  - Full flow starts at Step 1; direct refine mode jumps to Step 6 and exposes image upload.
  - Top action includes `保存草稿`, backed by `POST /api/workflow-sessions/save`.
  - Step navigation silently autosaves the current session.
  - Loading `/workflows/expression?session_id=xxx` restores `workflowState`, current step, and selected reference asset cache.
  - Step 1 creates a task through `/api/tasks/create`.
  - Step 1 category is a dropdown backed by `ASSET_CATEGORIES`, limited to `表情`, `动作`, `游戏内容`, and `节日形象`; the selected value is stored in `workflowState.category` and defaults to `expression`.
  - Steps 2 and 6 use instruction library selections plus freeform prompts.
  - Step 3 defaults its reference asset category/tag loading from `workflowState.category`, then still supports category dropdown (`全部` plus `ASSET_CATEGORIES`), server-side tag filtering, and multi-select.
  - Step 3 category switching clears selected filter tags but preserves already selected reference assets.
  - Step 4 configures size, background, and an action list. The action list starts with 4 blank rows, supports adding/removing rows, labels rows as `第1张`, `第2张`, etc., and requires at least 1 filled action before advancing.
  - Steps 5, 6, and 7 call `/api/generate/image` with selected available models.
  - Step 5 draft generation uses the action list as the source of output count. It sends one `/api/generate/image` request with `count` equal to the filled action count.
  - Step 5 prompt helpers join selected fixed instructions and freeform prompt, replace `{{action}}` with `见下方编号动作表`, remove arrangement-related sentences containing `排列` or `一排`, and ask the model to produce a numbered collage draft whose cell numbers map to the action list.
  - Step 5 shows the action-number table, a collapsible preview of the exact numbered-collage prompt sent to the backend, and the returned collage draft image(s).
  - Step 5 clears stale draft images before starting generation.
  - Step 6 full-flow mode treats Step 5 output as reference only: it shows the collage draft plus action-number table, defaults all action numbers selected, and does not require selecting draft images.
  - Step 6 full-flow final generation calls `/api/generate/image` once per selected action with `count: 1`, using the high-price model, Step 3 reference assets, the refine prompt, and the selected action. If the refine prompt contains `{{action}}`, the selected action replaces that placeholder; otherwise the prompt appends `动作：{action}`. Each finished image is appended immediately and labeled with the full action description.
  - Step 6 image review UI uses larger previews: collage draft references render at least 200x200, final result images render at least 240x240, action descriptions wrap without truncation, and draft/final images open in a full-screen preview overlay that closes by clicking the overlay or pressing ESC.
  - Model defaults now use deterministic recommendation rules: draft picks the lowest priced usable `draft`/`both` model; final picks the highest priced usable `final`/`both` model; inactive, exhausted, and wrong-purpose models are ignored.
  - Step 5 shows `draft`/`both` model configs; Step 6 and Step 7 show `final`/`both` model configs. Invalid saved selections are synchronized back to the current recommendation.
  - Draft and final generation failures now render inline retry panels and treat empty image responses as failed generation.
  - Direct refine uploads are persisted through `/api/assets/upload` as expression assets tagged `直接精修源图` before final generation, and their persisted asset IDs are included as generation references.
  - Step 7 adds consistency refinement after final generation: multi-select Step 6 finals or uploaded custom images, choose instruction-library prompts plus freeform additions, reuse Step 3 reference assets by default or reopen the asset selector, choose a high-price model and output count, then generate consistency results.
  - Step 7 stores results in `workflowState.consistencyImages`; returning to Step 6 preserves Step 7 source-image selections, prompt selections, freeform prompt, model, count, and reference-asset choices.
  - Step 7 consistency generation uses a 660000 ms frontend request timeout. If generation fails for a source image, the inline error panel offers `跳过此图`; skipping moves that image from `toRefineImages` into `confirmedImages`, removes any related consistency result, and keeps it available for Step 8 review / Step 9 archive.
  - Step 7 review controls now support per-image and batch `精修`, `直接通过`, `跳过`, and `删除` actions. A `全选` checkbox drives batch actions. `直接通过` appends into `confirmedImages`, while `跳过` and `删除` only remove from `toRefineImages`. Step 7 `下一步` no longer blocks on unfinished refine items, and Step 8 still renders only `confirmedImages`.
  - Step 8 supports reference/final comparison and confirmation across both Step 6 final images and Step 7 consistency refinement images.
  - Step 9 archives confirmed final/consistency images into the selected `workflowState.category` asset category through `/api/assets/upload`.
  - Step 9 archive tags default from Step 1 task tags (`workflowState.taskTags`, mirrored from `workflowState.tags`) and are initialized per confirmed image.
  - Step 9 archive initialization fills missing per-image tags from task tags without overwriting image-specific edits when returning to the archive step.
  - Step 9 lets each confirmed image edit its own archive tags before upload: selected tags render as removable chips, existing category tags come from `GET /api/assets/tags?category={workflowState.category}`, and custom tags can be added manually.
  - Step 9 archive uploads submit each image's individual `tags` value in the multipart `POST /api/assets/upload` request.
  - Step 9 archive completion marks the workflow session `completed`.
  - Asset and tag lists refresh after direct-refine upload persistence and final archive completion.
- Workflow task list page is implemented at `/workflows`:
  - Top tabs switch between `草稿` and `已完成`.
  - Subtabs switch between `完整流程` (`mode=full`) and `直接精修` (`mode=retouch`).
  - Draft rows support continuing at `/workflows/expression?session_id=xxx` and deletion.
  - Completed rows support copying into a new full-flow or direct-refine draft with generated result fields cleared.
- Gallery, stats, admin users, admin API keys, and admin audit logs pages are implemented.
- Admin model configuration page is implemented at `/admin/models`.
- Activity template admin page is implemented at `/admin/activity-templates`:
  - Uses a light-theme template list plus a fixed inline editor above the list.
  - The list has `全部` plus template-type tabs and columns for template number, name, type, usage scenario, status, and actions.
  - The editor has four collapsible sections for basic info, visual structure, activity field definitions, and output rules.
  - The basic-info section includes `风格标准` immediately after recommended usage scenario; it is persisted as `style_guide` and automatically included in generation prompts.
  - Admins configure operator-facing fields without editing prompt variables directly; default field keys are preserved for the built-in five fields, and added fields are normalized to `field_N`.
  - Existing templates can reset field definitions through `POST /api/activity/templates/{id}/fields/reset-defaults`.
- Admin model configuration create/edit forms include a `用途` dropdown: `低价探索` (`draft`), `高价定稿` (`final`), and `通用` (`both`).
- Admin users page includes a per-user "模型权限" panel:
  - Lists currently granted models.
  - Loads grantable models from `/api/model-configs`.
  - Grants via `/api/permissions/grant`.
  - Revokes via `DELETE /api/permissions/revoke`.
- Admin API keys page is backed by `/api/api-keys` and `/api/api-keys/create`.
- Admin model configuration page is backed by `/api/model-configs`.
- Stats image performance ranking calls `/api/stats/images`.
- `frontend/app/page.tsx` redirects `/` to `/dashboard`.
- Docker frontend runtime is available through `frontend/Dockerfile`; it builds Next.js and starts `npm run dev`.
- Frontend list consumers are hardened against non-array API payloads:
  - API list setters use `Array.isArray(res.data) ? res.data : []`.
  - Shared list components and page `.map()` render paths use safe arrays.
  - This covers tasks, prompts, assets, gallery, review, stats, admin users, admin API keys, admin logs, task detail images, Sidebar nav, image grid, task table, and prompt variable chips.
- Because the frontend service is image-based rather than bind-mounted, source changes require `docker-compose up -d --build frontend` to reach the running container.

## Docker E2E Environment

- `docker-compose.yml` defines five services:
  - `frontend`
  - `backend`
  - `db` using `postgres:16`
  - `redis`
  - `storage` using MinIO
- Backend command: `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- Frontend command: `npm run dev`.
- Backend waits for healthy `db`, `redis`, and `storage` services through `depends_on`.
- Postgres mounts `backend/migrations/init.sql` to `/docker-entrypoint-initdb.d/init.sql`.
- `.env.example` contains local development defaults; `.env` contains local Docker defaults with `DATABASE_URL` pointing at `db` and `REDIS_URL` pointing at `redis`.
- The running local Postgres database uses `POSTGRES_USER=ai_workbench`; manual psql commands should use `-U ai_workbench`, not `-U postgres`.
- Running Postgres has also been updated manually with `workflow_sessions` via `docker-compose exec db psql -U ai_workbench -d ai_workbench -c "CREATE TABLE IF NOT EXISTS workflow_sessions (...);"`
- Running Postgres has also been updated manually with the activity workflow tables because `init.sql` only applies on first database initialization:
  - `activity_template_types`
  - `activity_templates`
  - `activity_variable_presets`
  - `activity_generation_jobs`
  - `activity_field_definitions`
  - Additional nullable activity template rule fields: `usage_scenario`, `bg_description`, `forbidden_rules`, `rule_character`, `rule_scene`, `rule_visual`, `rule_copy`, `rule_button`, `rule_quality`, and `rule_forbidden`

## Test Coverage

- `backend/tests/test_base_layer.py` verifies settings, response helpers, password hashing, and JWT.
- `backend/tests/test_models.py` verifies core table ORM registration, key constraints, and migration table coverage.
- `backend/tests/test_schemas.py` verifies Pydantic schema imports, defaults, validation, and ORM-style conversion.
- `backend/tests/test_routers.py` verifies router objects, expected HTTP paths, dependency wiring, unified response shape, and multipart asset upload metadata binding.
- `backend/tests/test_services.py` verifies service function signatures, task status transitions, prompt rendering, cost calculation, local storage writes, static asset URLs, audit logging, and unsupported AI provider handling.
- `backend/tests/test_main.py` verifies app creation, root status, docs availability, API route registration, and masked startup config logging.
- `frontend/lib/expression-workflow.test.ts` verifies expression workflow pure logic for model recommendation, generated image normalization, numeric ID merging, and Step 3 reference asset query paths. It is excluded from Next.js app builds and run with `tsc` emit to `/tmp` plus `node --test`.

Latest backend verification: 81 tests pass.

Latest style-tag and final-image metadata verification:

- Running Docker Postgres accepted the idempotent `ALTER TABLE activity_templates ADD COLUMN IF NOT EXISTS style_tag ...` and `ALTER TABLE final_images ADD COLUMN IF NOT EXISTS source_type/sub_category/style_tag ...` migration statements.
- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 72 tests` and `OK`.
- `npm run build 2>&1 | tail -5` in `frontend/` exited successfully; a fresh full `npm run build` still generated 25 app routes and included `/gallery/tags`.
- `docker-compose up -d --build backend frontend` rebuilt and restarted both app containers successfully.
- Smoke checks returned HTTP 200 for:
  - `GET http://localhost:8000/docs`
  - Authenticated `GET http://localhost:8000/api/activity/templates`

Latest gallery three-level filter verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 73 tests` and `OK`.
- `node --test frontend/lib/gallery-browser.test.ts` passed 3 tests covering query-string generation and gallery category/tag normalization.
- `npm run build 2>&1 | tail -5` in `frontend/` exited successfully; fresh local and Docker builds both confirmed `Generating static pages (25/25)`.
- `docker-compose up -d --build backend frontend` rebuilt and restarted both app containers successfully after one transient Docker registry metadata fetch retry.

Latest background workflow verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 88 tests.
- `node --test frontend/lib/background-workflow.test.ts frontend/lib/tag-combobox.test.ts frontend/lib/asset-tags-page.test.ts frontend/lib/assets-page.test.ts` passed.
- `npm run build` in `frontend/` completed successfully and generated 26 routes.
- `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers successfully.
- Smoke checks returned HTTP 200 for `GET http://localhost:3010/workflows/background`.
- Running Postgres now contains 20 `background` rows in `asset_tags`.
- Authenticated `GET http://localhost:8000/api/assets/tags?category=background` returned 20 grouped object records.
- Authenticated `GET http://localhost:8000/api/assets/tags?category=expression` returned object records with `group: null`.
- Authenticated `POST http://localhost:8000/api/assets/tags/create-inline` created and returned a temporary background tag, and deleting it restored the seed count to 20.
- Smoke checks returned HTTP 200 for:
  - Authenticated `GET http://localhost:8000/api/gallery/categories`
  - Authenticated `GET http://localhost:8000/api/gallery/tags`
  - `GET http://localhost:3010/gallery`

Latest gallery tag management verification:

- Running Docker Postgres accepted the idempotent `CREATE TABLE IF NOT EXISTS gallery_tags (...)` statement.
- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 75 tests` and `OK`.
- `node --test frontend/lib/gallery-tag-admin.test.ts` passed 2 tests covering source-type tabs and managed-tag normalization.
- `npm run build 2>&1 | tail -5` in `frontend/` exited successfully; fresh local and Docker builds both confirmed `Generating static pages (25/25)`.
- `docker-compose up -d --build backend frontend` rebuilt and restarted both app containers successfully.
- Smoke checks returned HTTP 200 for:
  - Authenticated `GET http://localhost:8000/api/gallery/tags/manage`
  - `GET http://localhost:3010/gallery/tags`

Latest activity template number validation verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -3` reported `Ran 75 tests` and `OK`.
- Schema regression now accepts template numbers such as `TX1` and still rejects empty strings.
- `docker-compose up -d --build backend` rebuilt and restarted the backend container successfully.
- `GET http://localhost:8000/docs` returned HTTP 200.

Latest activity workflow PRD refactor verification:

- Running Docker Postgres was manually migrated with idempotent activity-template extension SQL; the latest run returned `ALTER TABLE` and `CREATE TABLE` with existing-column/table notices.
- `node --test frontend/lib/activity-template-admin.test.ts frontend/lib/activity-production-workflow.test.ts` passed 8 tests after the final Task 4 operator-page state rewrite.
- `node --test frontend/lib/activity-production-workflow.test.ts frontend/lib/activity-workflow-theme.test.ts frontend/lib/activity-template-admin.test.ts frontend/lib/sidebar-nav.test.ts` passed 13 tests.
- The regression coverage verifies:
  - Activity production dynamic fields initialize from template defaults, validate required fields, build `{field_key: value}` payloads, and produce a business-label prompt preview.
  - Activity production reject-regeneration clears generated job/image/prompt/QC state and returns the workflow to Step 3.
  - Activity template admin payloads normalize field keys, select options, and light-theme class constraints.
  - Activity workflow shared theme helpers avoid forbidden dark page classes.
- `npm run build 2>&1 | tail -5` in `frontend/` exited successfully; a full `npm run build` generated 24 app routes.
- `docker-compose up -d --build backend frontend` rebuilt and restarted both app containers successfully.
- Frontend Docker build generated 24 app routes, including `/workflows/activity` and `/admin/activity-templates`.
- Smoke checks returned HTTP 200 for:
  - `GET http://localhost:3010/workflows/activity`
  - `GET http://localhost:3010/admin/activity-templates`
  - `GET http://localhost:8000/docs`
  - Authenticated `GET http://localhost:8000/api/activity/template-types`
  - Authenticated `GET http://localhost:8000/api/activity/templates`

Latest Sidebar child-nav style verification:

- `node --test frontend/lib/sidebar-nav.test.ts` passed 4 tests.
- The regression coverage verifies:
  - `任务中心` child items define only `href` and `label`, with no special style flags such as `active`.
  - Sidebar child links use one shared class strategy.
  - Active child links do not include `bg-gray-900`, `text-white`, or `font-bold`.
  - `/workflows/activity` path matching is handled by the same helper logic as `/workflows` and `/workflows/expression`.
  - `模版中心` / `标签管理` / `管理后台` match the new grouped route ownership, including `/gallery/tags`.
- `npm run build` in `frontend/` completed successfully and generated 25 app routes.

Latest activity workflow migration and smoke verification:

- `docker-compose exec -T db psql -U ai_workbench -d ai_workbench -c "...activity workflow migration SQL..."` completed without errors and returned:
  - `CREATE TABLE` x4
  - `INSERT 0 5`
  - `INSERT 0 11`
- `docker-compose exec -T db psql -U ai_workbench -d ai_workbench -c "SELECT COUNT(*) ..."` confirmed:
  - `activity_template_types = 5`
  - `activity_variable_presets = 11`
- `docker-compose up -d --build backend frontend` rebuilt and restarted both app containers successfully.
- `docker-compose ps` showed `backend`, `frontend`, `db`, `redis`, and `storage` running, with `db` healthy.
- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 70 tests.
- Frontend Docker build generated 24 app routes, including `/workflows/activity` and `/admin/activity-templates`.
- Smoke checks returned HTTP 200 for:
  - `GET http://localhost:3010/workflows/activity`
  - `GET http://localhost:3010/admin/activity-templates`
  - `GET http://localhost:8000/docs`
  - `POST http://localhost:8000/api/auth/login` with `admin` / `admin123`
  - `GET http://localhost:8000/api/activity/template-types`
  - `GET http://localhost:8000/api/activity/variable-presets`
  - `GET http://localhost:8000/api/activity/templates`

Latest AI gateway `gpt-image-2-all` image-edit verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 54 tests, including long provider timeout, 429 wait, retry-backoff coverage, `gpt-image-2` multipart edits, JSON generations, spaced model-name recognition, `gpt-image-2-all` multipart edits routing, unique generated filenames for repeated same-task saves, and existing asset tag editing.
- `docker-compose up -d --build backend` rebuilt and restarted the backend container successfully.
- After the unique filename fix, `docker-compose up -d --build backend` rebuilt/restarted the backend container again and `GET http://localhost:8000/docs` returned HTTP 200.
- `docker-compose ps` showed backend, frontend, db, redis, and storage running, with db/redis/storage healthy.
- `GET http://localhost:8000/docs` returned HTTP 200.
- Running Postgres model config `8` (`APIYI-image2`) is active with machine model name `gpt-image-2-all`.
- Live Step 6-style generation with model config `8` and reference asset `[26]` routed to `{base_url}/images/edits`, uploaded one `image[]` file, and returned HTTP 200 with model `gpt-image-2-all`, `token_used=1577`, `cost_usd=0.0300`, and local image URL `/static/task/6/draft/chat-generated-6-1.png` which fetched as HTTP 200 `image/png`.

Latest model usage-type verification:

- `node --test frontend/lib/model-config-form.test.ts` passed 3 tests.
- `node --test frontend/lib/expression-workflow.test.ts` passed 11 tests.
- `PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 45 tests.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- `docker-compose exec db psql -U ai_workbench -d ai_workbench -c "ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS usage_type VARCHAR(20) DEFAULT 'both';"` returned `ALTER TABLE`.
- `docker-compose up -d --build backend frontend` rebuilt/restarted backend and frontend.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/admin/models` returned HTTP 200.
- Authenticated `GET http://localhost:8000/api/model-configs` returned rows with `usage_type: "both"` for existing models.

Latest action-list draft generation verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 14 tests, including action-list cleanup, legacy per-action prompt generation, and combined prompt generation for one-call multi-image drafts.
- `node --test frontend/lib/model-config-form.test.ts` passed 3 tests.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- `docker-compose up -d --build frontend` rebuilt/restarted the frontend container successfully.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/workflows` returned HTTP 200.

Latest numbered-collage workflow verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 18 tests, including numbered-collage draft prompt generation, final single-action prompt generation, and stale-draft clearing.
- `node --test frontend/lib/model-config-form.test.ts` passed 3 tests.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- `docker-compose up -d --build frontend` rebuilt/restarted the frontend container successfully.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/workflows` returned HTTP 200.

Latest live OpenAI-compatible relay verification:

- Backend was rebuilt with `docker-compose up -d --build backend`.
- `POST /api/generate/image` with model config `7` (`provider=google`, `base_url=https://aihubmix.com/v1`) and reference asset `18` returned HTTP 200.
- The relay response was parsed from `choices[].message.multi_mod_content`, saved locally, and returned `/static/task/5/draft/chat-generated-5-1.jpg`.
- `GET http://localhost:8000/static/task/5/draft/chat-generated-5-1.jpg` returned HTTP 200 with `image/jpeg`.
- Latest `count=2` relay verification returned two images, `/static/task/5/draft/chat-generated-5-1.jpg` and `/static/task/5/draft/chat-generated-5-2.jpg`; both static URLs returned HTTP 200 with `image/jpeg`.
- Latest reference compression verification selected three reference asset IDs; backend downloaded/sent two compressed images and logged `Request payload size: 674558 bytes, images: 2`, down from the previous 9.1MB single-reference payload.

Latest expression prompt verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 21 tests, including Step 6 `{{action}}` replacement without duplicate action lines, cow-character locking, and enlarged Step 6 image grid classes.
- `npm run build` in `frontend/` completed successfully with 22 routes.
- `docker-compose up -d --build frontend` rebuilt and restarted the frontend container.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.

## Startup Verification

Verified locally with:

```bash
cd backend
../.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Observed:

- `GET http://127.0.0.1:8000/docs` returned HTTP 200.
- `GET http://127.0.0.1:8000/` returned status `ok` and version `1.0.0`.
- App route inspection now shows 53 API method/path pairs and no `/api/api/...` duplicate prefix.

Verified Docker E2E with:

```bash
docker-compose up -d --build
curl --noproxy '*' -s -o /tmp/e2e-login.html -w '%{http_code}' http://localhost:3010/login
curl --noproxy '*' -s -o /tmp/e2e-docs.html -w '%{http_code}' http://localhost:8000/docs
curl --noproxy '*' -s -o /tmp/e2e-root.html -w '%{http_code} %{redirect_url}' http://localhost:3010/
```

Observed:

- All five Docker services are running.
- Postgres is healthy; first initialization executed `backend/migrations/init.sql`.
- Backend logs show `DATABASE_HOST=db`.
- `GET http://localhost:8000/docs` returned HTTP 200.
- `GET http://localhost:3010/login` returned HTTP 200 with login page HTML.
- `GET http://localhost:3010/` returned HTTP 307 redirecting to `/dashboard`.

Latest frontend rebuild verification:

```bash
cd frontend
npm run build
cd ..
docker-compose up -d --build frontend
curl --noproxy '*' -s -o /tmp/aiwb_login.html -w '%{http_code}' http://localhost:3010/login
curl --noproxy '*' -s -o /tmp/aiwb_prompts.html -w '%{http_code}' http://localhost:3010/prompts
curl --noproxy '*' -s -o /tmp/aiwb_expression.html -w '%{http_code}' http://localhost:3010/workflows/expression
curl --noproxy '*' -s -o /tmp/aiwb_docs.html -w '%{http_code}' http://localhost:8000/docs
```

Observed:

- `npm run build` succeeded and generated 22 app routes.
- `docker-compose up -d --build` rebuilt backend and frontend images and restarted services successfully.
- `GET http://localhost:3010/workflows` returned HTTP 200.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/admin/models` returned HTTP 200.
- `GET http://localhost:3010/admin/users` returned HTTP 200.
- `GET http://localhost:8000/api/model-configs` returned `{"code":0,"msg":"success","data":[]}` with admin auth when empty.
- Model config create/toggle/delete smoke check passed; create returned `api_key: "3456"` for `sk-smoke-123456`.
- Permission smoke check passed:
  - Admin available models included all active configs.
  - Operator available models were empty before grant.
  - Granting a model produced one permission row and one available operator model.
  - Revoking removed access and operator available models returned to empty.
- Generation integration smoke check passed without calling external AI providers:
  - Admin `/api/model-configs/available` included a newly created active model config.
  - Operator `/api/generate/image` with that `model_config_id` returned HTTP 403 before grant.
  - Operator `/api/model-configs/available` included the model after grant and excluded it after revoke.
  - `GET http://localhost:3010/tasks/1` returned HTTP 200.
- Asset upload smoke check passed:
  - `POST http://localhost:8000/api/assets/upload` accepted a multipart image upload.
  - The returned asset URL was `/static/assets/aiwb-smoke.svg`.
  - `GET http://localhost:8000/static/assets/aiwb-smoke.svg` returned HTTP 200 with `image/svg+xml`.
  - `GET http://localhost:3010/assets` returned HTTP 200.
- Asset tag smoke check passed:
  - Running Postgres was updated with `asset_tags` and `asset_tag_relations`.
  - `POST http://localhost:8000/api/assets/upload?...&tags=高兴` created a tagged asset.
  - `GET http://localhost:8000/api/assets/tags?category=bull_reference` returned `["高兴"]`.
  - `GET http://localhost:8000/api/assets?category=bull_reference&tags=高兴` returned that asset.
  - `GET http://localhost:8000/static/assets/aiwb-happy.svg` returned HTTP 200 with `image/svg+xml`.
- Asset tag interaction smoke check passed:
  - `POST http://localhost:8000/api/assets/upload?...&category=expression&tags=高兴` created a tagged expression asset.
  - `GET http://localhost:8000/api/assets/tags?category=expression` returned `["高兴"]`.
  - `GET http://localhost:8000/api/assets?category=expression&tags=高兴` returned that asset.
  - `GET http://localhost:3010/assets` returned HTTP 200 after rebuilding the frontend container.
- Asset upload metadata fix smoke check passed:
  - `POST http://localhost:8000/api/assets/upload` with multipart form fields `category=expression` and `tags=高兴,开心` returned an asset with those values.
  - `GET http://localhost:8000/api/assets/tags?category=expression` returned `["开心","高兴"]`.
  - `GET http://localhost:8000/api/assets?category=expression&tags=高兴` returned the uploaded `aiwb-form-tag-fix.png` asset with `tags: "高兴,开心"`.
  - `GET http://localhost:8000/static/assets/aiwb-form-tag-fix.png` returned HTTP 200 with `image/png`.
  - `GET http://localhost:3010/assets` returned HTTP 200 after rebuilding backend and frontend containers.
- Asset tag persistence and management smoke check passed:
  - Running Postgres was updated with `asset_tags.category` and `(category, name)` uniqueness.
  - `POST http://localhost:8000/api/assets/tags/create` created a temporary persistent tag under `expression` with `image_count: 0`.
  - Uploading an image with that tag made `GET http://localhost:8000/api/assets/tags/manage?category=expression` return `image_count: 1`.
  - Deleting the image left the tag in `GET http://localhost:8000/api/assets/tags?category=expression`.
  - `GET http://localhost:8000/api/assets/tags/manage?category=expression` returned the tag with `image_count: 0`.
  - `GET http://localhost:3010/assets/tags` returned HTTP 200.
- Asset tag dropdown redesign smoke check passed:
  - Running Postgres smoke tags matching `持久%` were deleted.
  - `POST http://localhost:8000/api/assets/upload` with multipart form fields `category=expression` and `tags=哭泣` returned an uploaded asset with `tags: "哭泣"`.
  - `GET http://localhost:8000/api/assets/tags?category=expression` included `哭泣`.
  - `GET http://localhost:8000/api/assets?category=expression&tags=哭泣` returned the uploaded asset.
  - `GET http://localhost:3010/assets` and `GET http://localhost:3010/assets/tags` returned HTTP 200 after rebuilding the frontend container.
- Existing asset tag edit smoke check passed:
  - `PATCH /api/assets/{id}/tags` updated a temporary expression asset from `旧标签烟测` to `编辑后标签烟测,手动新增烟测`.
  - The patch response returned the edited `tags` string and `GET http://localhost:8000/api/assets/tags?category=expression` included the edited tags.
  - The smoke asset and smoke tags were deleted afterward.
  - `GET http://localhost:3010/assets` returned HTTP 200 after rebuilding backend and frontend containers.
- Asset library batch migration is implemented:
  - `PATCH /api/assets/batch-move` accepts `asset_ids` and `target_category`, updates selected asset categories, migrates same-name tag relations into the target category, and returns `moved_count`.
  - During migration, any source-category tag relation is replaced with a target-category tag of the same name, creating that target tag if missing. `assets.tags` keeps the same comma-separated names, and original category tags are retained for other assets.
  - `/assets` has a `批量迁移` mode. It shows checkboxes on cards, `已选 X 张`, `按当前标签全选`, target category dropdown, `确认迁移`, and `取消`.
  - `按当前标签全选` selects all currently loaded assets in the active category/tag filter result.
  - Latest pre-rebuild checks: backend tests passed 64 tests, frontend migration/category/workflow tests passed 45 tests, `npm run build` generated 22 routes, `docker-compose up -d --build backend frontend` rebuilt/restarted containers, and `/assets` plus backend `/docs` returned HTTP 200.
- Expression workflow Step 6/7/8 review flow has been redesigned:
  - `workflowState.confirmedImages` is now the canonical待归档 queue.
  - `workflowState.toRefineImages` is now the canonical一致性精修 queue.
  - Step 6 final cards have `直接归档` and `需要精修`; routed images are removed from the Step 6 pending result list.
  - Step 6 next-step routing skips Step 7 when there are no images in `toRefineImages`; otherwise it enters Step 7.
  - Step 7 displays only `toRefineImages`, generates consistency refinements one source image at a time, and each result has `确认归档`.
  - Step 8 displays only `confirmedImages`; each image has `退回精修`, which moves it back into `toRefineImages` and returns to Step 7.
  - Latest checks: `node --test frontend/lib/expression-workflow.test.ts` passed 29 tests, `npm run build` in `frontend/` generated 22 routes, `docker-compose up -d --build frontend` rebuilt/restarted containers, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Completed workflow re-entry is supported:
  - Completed rows on `/workflows` now have `查看/补充归档` next to copy buttons.
  - The button opens `/workflows/expression?session_id=...&step=9`.
  - Expression workflow restore now applies a valid `step=N` URL override after loading the session.
  - Step 9 still shows the archive UI for completed sessions when `confirmedImages` has remaining images, allowing supplemental archive; once archived, those queues are cleared before saving.
  - Latest checks: `node --test frontend/lib/expression-workflow.test.ts` passed 31 tests, `npm run build` in `frontend/` generated 22 routes, `docker-compose up -d --build frontend` rebuilt/restarted containers, and `GET http://localhost:3010/workflows` plus `GET http://localhost:3010/workflows/expression?session_id=1&step=9` returned HTTP 200.
- Step 8 multi-image display and Step 9 task summary are updated:
  - Final and consistency generated images now get workflow-local unique ids before being stored in state, so repeated provider ids no longer cause Step 8 to display only one confirmed image.
  - Step 8 still renders the full `workflowState.confirmedImages` array.
  - Step 9 includes five summary cards: valid action instructions, draft images, Step 6 final generated images, refined images, and archived images.
  - `workflowState.finalGeneratedCount`, `workflowState.refinedImageCount`, and `workflowState.archivedImageCount` track the task summary; archive success increments and persists the archived count.
  - Latest checks: `node --test frontend/lib/expression-workflow.test.ts` passed 33 tests, `npm run build` in `frontend/` generated 22 routes, `docker-compose up -d --build frontend` rebuilt/restarted containers, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Expression workflow generated-state autosave is strengthened:
  - Step 5 draft completion, Step 6 per-image final completion, Step 7 per-image consistency completion, Step 6/7 routing actions, Step 8 return-to-refine, and Step 9 per-image archive success trigger silent autosaves.
  - Autosaves serialize through a frontend queue and save a full `workflowState` snapshot via `stateOverride`, including generated image URLs and review/archive queues.
  - Silent autosave failures are console-only and do not block the user.
  - Step 9 archive progress now persists after every uploaded image by incrementing `archivedImageCount` and removing that image from `confirmedImages`; final completion still saves the session as completed.
  - Latest frontend checks: `npm run build` completed successfully with 22 routes, and `docker-compose up -d --build frontend` rebuilt/restarted containers.
- Step 1 workflow category selection is updated:
  - `ASSET_CATEGORIES` includes `游戏内容`, `节日形象`, and `热点运营`.
  - Step 1 exposes only expression-production categories: `表情`, `动作`, `游戏内容`, and `节日形象`.
  - `workflowState.category` drives Step 3's default reference asset category and Step 9's archive upload category.
  - Latest checks: `node --test frontend/lib/expression-workflow.test.ts` passed 39 tests, `npm run build` in `frontend/` generated 22 routes, `docker-compose up -d --build frontend` rebuilt/restarted containers, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Pucoding image edit compatibility is implemented:
  - `backend/app/services/ai_gateway.py` uses `get_image_field_name(base_url)` for image edit multipart uploads.
  - Base URLs containing `pucoding` send reference images under `image`; all other relays default to `image[]`.
  - apiyi coverage still expects `image[]`; pucoding coverage expects `image`.
  - Verification at that point: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 56 tests, `docker-compose up -d --build backend` rebuilt/restarted backend, and `GET http://localhost:8000/docs` returned HTTP 200. Newer backend verification is 59 tests after the Gemini Markdown parsing and draft collage routing fixes.
- Instruction library smoke check passed:
  - `GET http://localhost:8000/api/workflow-types` returned `expression`.
  - `POST http://localhost:8000/api/instructions/create` created a temporary instruction.
  - `GET http://localhost:8000/api/instructions?workflow_type_id=...` returned that instruction.
  - The temporary smoke instruction was deleted.
  - `GET http://localhost:3010/instructions` returned HTTP 200.
- Expression workflow smoke check passed:
  - `GET http://localhost:3010/workflows/expression` returned HTTP 200.
  - `POST /api/workflow-sessions/save` created a draft at Step 3.
  - `GET /api/workflow-sessions?workflow_type=expression&status=draft&mode=full` returned the saved session.
  - `GET /api/workflow-sessions/{id}` returned `state_json` containing `Smoke 草稿恢复`.
  - `GET http://localhost:3010/workflows/expression?session_id=...` returned HTTP 200.
  - The temporary smoke session was deleted after verification.
  - Docker frontend build generated 22 app routes including `/workflows` and `/workflows/expression`.
- `GET http://localhost:8000/docs` returned HTTP 200.
- Activity workflow Step 2 reference selection is now in the new three-row, three-column layout:
  - `frontend/app/workflows/activity/page.tsx` keeps the rest of the workflow unchanged, but replaces the old shared reference panels with three inline `RefImageSelector` instances for `character`, `background`, and `props`.
  - Each selector manages its own category, tag, asset list, loading state, and selected preview; category switching is enabled only for the character row.
  - The selector implementation matches the live asset API shape by reading tags from `/api/assets/tags?category=...`, filtering assets with the `tags` query parameter, and tolerating either string or object tag payloads.
  - `frontend/lib/activity-production-workflow.ts` contains the pure Step 2 helper logic for activity reference asset query-path generation and reference-tag normalization, covered by `node --test frontend/lib/activity-production-workflow.test.ts` with 9 passing tests.
  - Latest checks: `npm run build` in `frontend/` succeeded, the Docker frontend build generated 25 routes, `docker-compose up -d --build frontend` rebuilt/restarted the container, and `GET http://localhost:3010/workflows/activity` returned HTTP 200.
- Activity workflow Step 2 selector UX is further tightened:
  - Each `RefImageSelector` now paginates assets at 9 per page and resets to page 1 when the active category or tag changes.
  - The character selector's left column now behaves like a directory tree, expanding only the active category's tags inline; background and props keep a compact tag-only rail with the same light-theme styling.
  - The Step 2 prompt preview now sits in a fixed-height `max-h-48` scrollable `<pre>`, preventing long prompts from pushing the rest of the page downward.
  - Latest checks: `npm run build` in `frontend/` succeeded, the Docker frontend build still generated 25 routes, `docker-compose up -d --build frontend` rebuilt/restarted the container, and `GET http://localhost:3010/workflows/activity` returned HTTP 200.
- Activity batch backend APIs are available:
  - `activity_generation_batches` stores activity production batch metadata: template/task/operator, variables, global auxiliary prompt, model, ad size, lifecycle status, and max image cap.
  - `activity_batch_images` stores each generated or refined image in a batch, including per-image auxiliary prompt, refine prompt, parent image id, rendered prompt, status, cost, token usage, and sort order.
  - `backend/app/routers/activity_batches.py` is registered at `/api/activity/batches` and exposes create/list/detail/drafts/refine/archive-image/delete-image/save-draft endpoints.
  - Batch creation generates one image per `image_configs` entry, combines template prompt plus global and per-image helper prompts, records linked `activity_generation_jobs`, and returns the full batch with images for review.
  - Refine creates a new child image while enforcing `max_images`; archive writes to `final_images` as `source_type=activity`, carries template type/style tag metadata, upserts `gallery_tags`, and marks the batch completed when every image is archived or deleted.
  - Latest checks: backend unit discovery passed 77 tests, Docker Postgres has both new batch tables, `docker-compose up -d --build backend` rebuilt/restarted the backend, `/docs` returned HTTP 200, and authenticated `GET /api/activity/batches/drafts` returned HTTP 200.
- Activity batch sessions are linked into the workflow session list:
  - `activity_generation_batches.session_id` references `workflow_sessions.id`.
  - Batch create now creates a matching `workflow_sessions` record with `workflow_type='activity'`, `mode='full'`, `status='draft'`, and `state_json` containing the batch id.
  - Saving a batch draft updates the linked workflow session back to Step 4 draft state, and finishing the batch through archive/delete marks the session completed.
  - `/workflows` now lists both expression and activity sessions, with activity rows linking to `/workflows/activity?session_id={id}`.
  - `/workflows/activity` restores an activity batch from `workflow_sessions/{id}` by reading `state_json.batch_id` and resuming at Step 4.

- First frontend i18n batch is complete:
  - `frontend/app/dashboard/page.tsx` and `frontend/app/login/page.tsx` now use `useLanguage` and `t()`
  - `frontend/lib/i18n.ts` includes the first batch page strings
  - `npm run build` still passes and the frontend route count remains `31`
  - Next batch: `assets` / `gallery` / `review` / `stats` / `prompts` / `instructions`

- Second frontend i18n batch is complete:
  - `frontend/app/assets/page.tsx`, `frontend/app/gallery/page.tsx`, `frontend/app/review/page.tsx`, `frontend/app/stats/page.tsx`, `frontend/app/prompts/page.tsx`, and `frontend/app/instructions/page.tsx` now use `useLanguage` and `t()`
  - `frontend/lib/i18n.ts` includes the second batch page strings
  - `npm run build` still passes and the current frontend route count is `33`
  - Next batch: `admin/*`

- Third frontend i18n batch is complete:
  - `frontend/app/admin/users/page.tsx`, `api-keys/page.tsx`, `models/page.tsx`, `logs/page.tsx`, `activity-templates/page.tsx`, `daily-post-templates/page.tsx`, `hotspot-import/page.tsx`, and `share-instructions/page.tsx` now use `useLanguage` and `t()`
  - `frontend/lib/i18n.ts` now covers the third-batch admin strings and has been deduplicated so build-time type checking passes
  - `cd frontend && npm run build` passes, and the current frontend route count is `32` including `/_not-found`
  - `docker-compose up -d --build frontend` completed successfully after the admin i18n pass
  - Current remaining i18n scope: `workflows/*`
  - `fill-all` historical tag translation backfill still needs one manual trigger after deployment

- Current residual-i18n status after batch UI cleanup:
  - `frontend/app/assets/tags/page.tsx` and `frontend/app/gallery/tags/page.tsx` are now fully wired to `useLanguage`; tag-management pages no longer rely on Chinese-only fixed copy
  - Activity template type tabs, share workflow type cards, trending topic categories, and gallery left-nav category labels now all have matching `i18n.ts` keys for EN mode
  - Daily-post reference-area fixed strings (`+ 自定义`, `全部`, `暂无参考图`, `无预览`, `× 移除`) have been normalized to `t()`
  - Latest verification: `cd frontend && npm run build` passes, and `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully
  - Route status: build table shows 33 entries including `/` and `/_not-found`; by current project counting, app pages remain 32 including `/_not-found`
  - Remaining follow-up stays the same: trigger `POST /api/translate/tags/fill-all` once after deployment for historical English tag backfill

- Current tag-display state after asset/gallery chip fix:
  - Asset cards now resolve visible chip labels through loaded tag option objects plus `getTagLabel(..., lang)`, so existing `name_en` values show correctly in EN mode
  - Gallery style-tag filters now keep lightweight tag objects instead of plain strings, and both the filter chips and the selected-tag summary render through `getTagLabel(..., lang)`
  - Latest verification: `cd frontend && npm run build` passes, and `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully

- Current activity-template bilingual state:
  - `activity_templates` now has backend support for `name_en` and `scenario_en`
  - Admin activity-template create/edit flow now captures English template title and optional English scenario text
  - Activity workflow cards, selected-template summary, and scenario copy now switch between `name / usage_scenario` and `name_en / scenario_en` based on UI language
  - Latest verification:
    - Live DB schema shows `name_en` and `scenario_en`
    - Backend tests pass: `Ran 135 tests ... OK`
    - Frontend build passes and containers have been rebuilt

- Current asset-selection badge state:
  - The asset-card `已选` badge in `frontend/app/assets/page.tsx` is already routed through `t("已选")`
  - `frontend/lib/i18n.ts` already contains the matching `已选 -> Selected` entry
  - Latest verification: frontend build passes and the frontend container has been rebuilt

- Current language rollout state:
  - Language switching is fully live: default is Chinese, and the top-right toggle switches the UI to English
  - All fixed UI copy is now bilingual across navigation, forms, buttons, status text, admin pages, task pages, assets/gallery, and workflow pages
  - Dynamic content such as user-created template names, instruction names, and other freeform records continues to display in its original authored language
  - New tag creation now requires an English name, and historical tags have already been backfilled through the AI translation flow

- Fourth frontend i18n batch upper half is complete:
  - `frontend/app/workflows/page.tsx`, `frontend/app/tasks/page.tsx`, `frontend/app/tasks/create/page.tsx`, and `frontend/app/tasks/[id]/page.tsx` now use `useLanguage` and `t()`
  - `frontend/app/workflows/expression/page.tsx` and `frontend/app/workflows/activity/page.tsx` now translate fixed workflow UI text, including step titles, buttons, labels, empty states, and core status/error messaging
  - `frontend/lib/i18n.ts` now covers all `t("...")` keys used by those six pages
  - Latest check: `cd frontend && npm run build` passes; there are `31` regular app routes plus `/_not-found`, for `32` total
  - `docker-compose up -d --build frontend` has been run, so the container is serving the updated upper-half workflow i18n changes
  - Current remaining i18n scope: `frontend/app/workflows/background/page.tsx`, `daily-post/page.tsx`, `share/page.tsx`, `trending/page.tsx`, and `trending-news/page.tsx`
  - `fill-all` historical tag translation backfill still needs one manual trigger after deployment

- Fourth frontend i18n batch lower half is complete:
  - `frontend/app/workflows/background/page.tsx`, `daily-post/page.tsx`, `share/page.tsx`, `trending/page.tsx`, and `trending-news/page.tsx` now use `useLanguage` for all fixed workflow UI copy
  - `frontend/lib/i18n.ts` now covers all `t("...")` keys used across the remaining 5 workflow pages; key verification result is `NO_MISSING_KEYS`
  - Latest check: `cd frontend && npm run build` passes; the build route table contains 33 entries including `/`, which remains `32` by the existing app-page counting rule including `/_not-found`
  - `docker-compose up -d --build frontend` has been run, so the container is serving the completed lower-half workflow i18n changes
  - Current frontend language state: navigation, login/dashboard, assets/gallery/review/stats/prompts/instructions, admin pages, tasks/workflows pages, and all workflow pages are now bilingual
  - Remaining follow-up: `POST /api/translate/tags/fill-all` should still be triggered once manually after deployment to backfill historical tag English names

- Shared i18n cleanup after rollout is complete:
  - `WhitespacePositionPicker` now translates both chip labels and SVG overlay labels through `useLanguage`
  - `TagCombobox` now translates placeholder / action text and uses the current `lang` when rendering tag labels and hints
  - `assets/page.tsx` now keeps full tag option objects for filter / upload / edit lists and renders labels through `getTagLabel(tag, lang)` instead of raw `tag.name`
  - Latest checks: `cd frontend && npm run build` passes, and `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully
  - Current UI state: language toggle now covers shared tag-picking components and assets tag chips, so the bilingual experience is consistent across both pages and reusable controls

- Assets page category and size translation is now fully wired:
  - `frontend/app/assets/page.tsx` no longer returns raw Chinese from the category helper; category labels now flow through `t()` inside the page component
  - Upload tag section category label, migration target category dropdown, and asset card category summary now follow the active language
  - `frontend/lib/i18n.ts` now includes the missing asset category keys (`牛标准图`, `游戏内容`, `节日形象`, `热点运营`) and size keys (`小`, `中`, `大`)
  - Latest checks: `cd frontend && npm run build` passes, route table still shows 33 entries including `/` and `/_not-found`, which remains 32 by the current counting rule for app pages

- Expression workflow step navigation is now fully translated:
  - `frontend/app/workflows/expression/page.tsx` now builds step items inside the component as `workflowSteps`, so step labels pass through `t(label)` at render time
  - The step header still renders `title={t(STEP_TITLES[currentStep - 1])}`, so the active step title and the navigation pills stay in sync
  - `frontend/lib/i18n.ts` now includes the missing step-name keys: `任务基础信息`, `提示词配置`, `参考素材选择`, `规格设置`, `草稿生成`, `精修成品`
  - Latest checks: `cd frontend && npm run build` passes, and the route table remains 33 entries including `/` and `/_not-found`, which is still 32 by the current app-page counting rule

- Workflow category and tag labels now follow the active language more consistently:
  - `frontend/app/workflows/expression/page.tsx` now translates all static category dropdown labels with `t(category.label)` and preserves tag option objects so `getTagLabel(..., lang)` can use `name_en / name_zh`
  - `frontend/app/workflows/activity/page.tsx` now translates category labels in the reference selector and preserves fetched tag objects for bilingual tag rendering
  - `frontend/app/workflows/daily-post/page.tsx`, `share/page.tsx`, `trending/page.tsx`, `trending-news/page.tsx`, and `background/page.tsx` now route their visible tag chips/buttons through `getTagLabel(..., lang)`
  - `frontend/lib/i18n.ts` now includes the missing share-workflow step keys: `选择转发类型`, `输入传播内容`, `图片语言`, `生成配置`, `生成图片 + 审核 QC`
  - Latest checks: `cd frontend && npm run build` passes, and the route table remains 33 entries including `/` and `/_not-found`, which is still 32 by the current app-page counting rule

- Expression Step 4 fixed strings are now fully translated:
  - `frontend/app/workflows/expression/page.tsx` now routes Step 4 labels and summary copy through `t()`, including `尺寸`, `背景`, `白底PNG`, `透明背景`, `增加动作`, `第 N 张`, and the valid-action summary line
  - The Step 5 spec summary now also translates the background mode instead of showing raw Chinese
  - `frontend/lib/i18n.ts` now includes the missing Step 4 copy keys: `透明背景`, `增加动作`, `白底PNG`, `当前有效动作`, `个，将生成`, `张草稿。`
  - Latest checks: `cd frontend && npm run build` passes, and the route table remains 33 entries including `/` and `/_not-found`, which is still 32 by the current app-page counting rule

- Workflow/task pages have now gone through a repo-scoped bulk i18n pass:
  - `frontend/app/workflows/page.tsx` now translates workflow list tabs, workflow-type labels, step-progress labels, and copy defaults through `t()`
  - `frontend/app/workflows/activity/page.tsx`, `background/page.tsx`, `share/page.tsx`, `trending/page.tsx`, and `trending-news/page.tsx` now translate another batch of visible fixed strings including task-status text, reference-area labels, category names, and selected-state helper copy
  - `frontend/lib/i18n.ts` now includes the additional workflow keys introduced by this bulk pass, such as `步`, `已选：`, `背景用途`, `场景类型`, `氛围`, `颜色风格`, and several share/reference helper phrases
  - Latest checks: `cd frontend && npm run build` passes, and `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully
  - Note: the requested non-ASCII line count remains high because that grep counts all Chinese source text, including business constants, step labels, and tag dictionaries, not just untranslated rendered UI strings
