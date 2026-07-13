# Progress

## Completed

## 视频工作流（2026-05-07 完成）

### 后端
- video_jobs, video_drafts, video_motion_data 表
- video_generate_service.py — 302.ai Kling 异步生成（base64 图片）
- video_draft router — 草稿生成、列表、选择、draft_type 区分
- video_motion router — 动作结构保存
- video_jobs router — 状态更新、代理下载、FFmpeg compose
- model_configs — 新增 purpose 字段（video_draft/video_final）
- 供应商新增：Kling Video、Google Veo、Runway

### 前端
- /videos 视频任务列表页
- /workflows/video 7步工作流
- Step 1 FirstFramePicker — 三源选帧
- Step 2 DraftExplorer — 草稿探索（真实 Kling API）
- Step 3 MotionExtractor — 时间轴动作标记
- Step 4 MotionFXConfig — 程序动效预设
- Step 5 FinalGenerator — 精品生成（O3 Pro）
- Step 6 PostProcessor — 后处理配置（字幕/CTA/Logo）
- Step 7 ExportArchiver — 导出归档（代理下载）

### 已验证
- Kling v2.6-std 草稿生成（$0.21/条）
- Kling O3-pro 精品生成（$0.56/条，带音效）
- base64 图片传输（不需要公网）
- 任务状态持久化和恢复

### 待处理
- Logo FFmpeg 叠加（端点已写，前端未接入）
- 字幕叠加
- aspectRatio 持久化修复
- 音频素材库
- 程序动效实际执行

## 视频工作流优化与 Bug 修复（2026-05-09）

### Bug 修复
- compose-all 500 报错：`video_url` 为空的 draft 被传入导致 FFmpeg 无输入，前端加 `video_url` 非空校验，后端加文件大小验证（< 1024 字节返回 422）
- FFmpeg filter 表达式兼容性：`crop` 不支持 `min()/max()`，`scale` 不支持 `PI`，统一改为 `if(gt(...))` 和 `6.2832`
- CTA overlay y 坐标使用了 Python `//` 运算符，FFmpeg 不识别，改为 Python 预计算值
- logo input index 从硬编码 `[1:v]` 改为动态计算，避免滤镜顺序调整后错位

### 效果优化
- 滤镜顺序调整为 `camera → global → logo → subtitle → cta`，解决 logo/CTA 随镜头漂移问题
- CTA 改用 Pillow 生成圆角按钮 PNG，overlay 叠加，支持真实圆角
- CTA 呼吸脉冲：使用主视频流时间轴驱动透明度变化
- 字幕淡入：`drawtext alpha='min(1,t/0.4)'`
- camera/global 动效参数调大（cam_slow_push: 0.003→0.008，global_flash: 0.05→0.15 等）
- 情绪/动作标签英文描述改为自然语言短句，更精准控制 Kling 生成效果
- Prompt 格式从 `Emotion: xxx` 改为 `The character feels xxx`，避免文字渲染到画面
- 新增 `negative_prompt`：`text, watermark, subtitle, caption, words, letters, typography, writing`

### 新功能
- Step 6 内嵌简化版 `MotionFXConfig`（compact 模式），可直接在后处理页选择动效预设
- Step 7 "下一步"改为"完成归档"，点击后跳转 `/gallery/video`
- 新增视频成品库页面 `/gallery/video`：封面图 + 任务名称 + 日期，支持预览和跳转编辑
- 视频工作台 `/videos` 改为草稿/已完成两个 Tab
- 情绪预设从 6 类扩充至 15 类，动作标签从 8 类扩充至 13 类
- 归档时保存 `export_url` 到 `video_jobs` 表，视频成品库预览直接播放合成版本
- 终稿选择记忆：`handleSelectFinal` 同时更新 `originalFinalId` 并立即 autosave

### 待处理
- 音频素材库
- aspectRatio 持久化一致性

- Share game-type rename support is complete:
  - `backend/app/routers/share_workflows.py` now exposes `PUT /api/share/game-types/rename`
  - `frontend/app/admin/share-instructions/page.tsx` now supports inline editing of existing game names
  - renaming a game type now synchronizes the `game_type` value across all related share instruction rows
- Share workflow instruction #3 is complete:
  - `frontend/app/workflows/share/page.tsx` now fixes Share autosave, adds a manual `保存草稿` action, and supports `?session_id=` draft restore
  - Share step navigation now saves draft state after `上一步 / 下一步`, and QC completion now persists the workflow as `completed`
  - Share draft restore now parses saved `state_json`, restores `sessionId`, and shows a temporary `草稿恢复中…` loading state
  - verification passed with frontend build output showing `33` routes, live HTTP `200` for `GET http://localhost:3010/workflows/share`, and successful session persistence returning `session_id: 113`
- Share workflow instruction #2 is complete:
  - `frontend/app/workflows/share/page.tsx` now restructures the Share workflow from 7 steps to 6 steps, merging generation and QC into the new Step 6
  - Step 5 now includes game-instruction loading and multi-select cards from `GET /api/share/game-instructions?game_type={gameType}`
  - selected game-instruction contents are now joined and sent in the Share generate payload as `game_instruction_contents`
  - `backend/app/routers/share_workflows.py` now accepts `game_instruction_contents` in the generate request and appends it to the Share prompt as `GAME VISUAL REQUIREMENTS`
  - verification passed with `131` backend tests, frontend build output showing `33` routes, and live HTTP `200` for both `GET http://localhost:8000/docs` and `GET http://localhost:3010/workflows/share`
- Share game instruction template library is complete:
  - `backend/migrations/init.sql` now adds `share_game_instructions` and seeds 3 default instructions each for `Tongits` and `Pusoy`
  - `backend/app/models/share.py`, `backend/app/schemas/share.py`, and `backend/app/services/_model_imports.py` now register the `ShareGameInstruction` table and API schemas
  - `backend/app/routers/share_workflows.py` now exposes share game-instruction management APIs for list/create/update/toggle/delete
  - `frontend/app/admin/share-instructions/page.tsx` now provides the admin management page, and `frontend/lib/constants.ts` now exposes `转发图指令库 -> /admin/share-instructions`
  - verification passed with `131` backend tests, frontend build output showing `33` routes, live HTTP `200` for `GET http://localhost:8000/docs` and `GET http://localhost:3010/admin/share-instructions`, and `GET /api/share/game-instructions?game_type=Tongits` returning 3 enabled seeded items
- Share workflow Step 4 reference-category fix is complete:
  - `frontend/app/workflows/share/page.tsx` no longer hardcodes Step 4 reference assets to `category=character`
  - Step 4 now derives reference categories from `ASSET_CATEGORIES`, excludes `background` and `props`, and supports category tab switching
  - changing the selected reference category now reloads `/api/assets?category={selectedRefCategory}` and `/api/assets/tags?category={selectedRefCategory}`, while clearing the active tag filter
  - verification passed with `cd frontend && npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`
- Share workflow (`share`) development is complete:
  - Phase 1: Share database models + schemas are in place for `share_jobs`, `share_bull_actions`, `share_backgrounds`, and `share_color_moods`
  - Phase 2: Share backend routes are implemented and all 7 APIs are registered; archive flow is wired to `FinalImage` and `GalleryTag` with `source_type="share"`
  - Phase 3: Share frontend skeleton is complete and `/workflows/share` is accessible
  - Phase 4: Share frontend is fully implemented across Step 1-7, including reference-image selection, generation, QC, refine, and autoSave
  - Phase 5: Release verification passed with `131` backend tests, `32` frontend routes, and all 7 Share routes registered
  - Pending business-test items: `source_type=share` archive verification, session write verification, and Gemini compatibility verification
- Share workflow Phase 4-C is complete:
  - `frontend/app/workflows/share/page.tsx` now implements real Step 6 generation flow with looped `jobs/create` + `jobs/{id}/generate`, per-image incremental display, progress text, and `前往审核 / 返回审核` actions
  - Step 6 now supports per-image refine through `POST /api/share/jobs/{job_id}/refine`, replacing the image URL in place and resetting review status to `pending`
  - `frontend/app/workflows/share/page.tsx` now implements real Step 7 QC with per-image archive / send-back / delete / withdraw actions, split pending-vs-archived sections, and completed-state panel with `/gallery` link plus reset action
  - Share workflow autosave now persists through `POST /api/workflow-sessions/save` on step changes, per-image generation completion, refine/QC operations, and final completion state
  - verification passed with `cd frontend && npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`
- Share workflow Phase 4-B is complete:
  - `frontend/app/workflows/share/page.tsx` now implements Step 4 reference-image selection with tag filtering, selectable asset grid, 4-image cap, and selected-preview removal
  - Step 4 now loads character assets from `/api/assets?category=character` and tag filters from `/api/assets/tags?category=character`
  - `frontend/app/workflows/share/page.tsx` now implements Step 5 generation config for ad size, generate count, and model selection
  - Step 5 now loads models from `/api/model-configs/available`, filters to `usage_type === "final" || "both"`, auto-selects the first available model, and blocks Step 5 -> 6 if no model is selected
  - Step 6-7 remain placeholders, and no generate/QC business logic was added in this phase
  - verification passed with `cd frontend && npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`
- Share workflow Phase 4-A is complete:
  - `frontend/app/workflows/share/page.tsx` now implements real Step 1-3 UI for share type selection, content input, and image language selection
  - Step 1 uses 4 selectable share-type cards with blue active state and blocks Step 1 -> 2 until a type is selected
  - Step 2 now includes `coreText`, `targetAudience`, and `gameType` controls, and blocks Step 2 -> 3 until `coreText` is non-empty
  - Step 3 now uses 3 selectable language cards for `English / Taglish / 中文`
  - Step 4-7 remain placeholders, and no API logic was added in this phase
  - verification passed with `cd frontend && npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`
- Share workflow Phase 3 is complete:
  - `frontend/app/workflows/share/page.tsx` now provides the 7-step Share workflow skeleton with typed `ShareWorkflowState`, placeholder `autoSave()`, bounded previous/next step navigation, and per-step placeholder content
  - `frontend/lib/constants.ts` now exposes `转发图生产 -> /workflows/share` under `任务中心`
  - verification passed with `cd frontend && npm run build` (`32` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/share`
- Share workflow Phase 1 is complete:
  - `backend/migrations/init.sql` now includes `share_bull_actions`, `share_backgrounds`, `share_color_moods`, and `share_jobs`
  - `backend/app/models/share.py` now defines the Share workflow ORM models for the option tables and job table
  - `backend/app/schemas/share.py` now defines the Share workflow create/response/QC/refine Pydantic schemas
  - `backend/app/services/_model_imports.py` now registers the Share models for metadata loading
  - verification passed with `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` (`131` tests)
- `docs/WORKFLOW_DEVELOPMENT_CHECKLIST.md` now captures the full reusable new-workflow development checklist, covering backend reference-image wiring, gallery archive rules, timeout/session pitfalls, frontend multi-image/QC/session patterns, and pre-launch verification steps
- `frontend/app/workflows/daily-post/page.tsx` now uses per-image Step 6 review actions instead of whole-job QC:
  - each generated image tracks `pending / archived / refine / deleted`
  - Step 6 now supports per-image `归档 / 发回精修 / 删除`, plus `撤回` for archived items
  - Step 5 now highlights `待精修` images and adds a `返回审核` shortcut back to Step 6
  - workflow completion now depends on having no `pending/refine` images and at least one `archived` image, after which the session is saved as `completed`
  - verification passed with `cd frontend && npm run build` (`28` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/daily-post`
- `backend/app/models/daily_post.py`, `backend/app/schemas/daily_post.py`, and `backend/app/routers/daily_post_workflows.py` now support daily-post `bull_action` / `background` / `color_mood` option tables plus `GET`/`POST` option APIs for custom additions
  - `frontend/app/workflows/daily-post/page.tsx` now loads those option lists from the API in Step 4 and supports inline custom creation / selection for bull actions, backgrounds, and colors
  - verification passed with `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_routers` (`47` tests) and `cd frontend && npm run build` (`28` routes)
- `backend/app/routers/daily_post_workflows.py` now writes archived daily-post images into `FinalImage` and bumps `GalleryTag` counts for the成品图库 path
  - verification passed with `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_routers` (`47` tests) and backend container restart logs showing `Uvicorn running on http://0.0.0.0:8000`
- `frontend/app/workflows/daily-post/page.tsx` now writes back `session_id` after autosave so draft saves no longer create a new session each time, and Step 6 archive now saves the session as `completed`
  - verification passed with `npm run build` (`28` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/daily-post`
- `frontend/app/workflows/daily-post/page.tsx` now covers the remaining UX fixes:
  - Step 5 supports click-to-preview fullscreen overlays with ESC/background close
  - Step 4 moves the create-job action into the reference-image panel header
  - Step 4 adds ad size selection, and Step 5 generation/refine requests now forward the chosen size
  - step transitions and image generation/refine completions now auto-save the draft state
  - Step 6 now writes the workflow session back as `completed` after successful archive
  - verification passed with `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_routers` (`47` tests), `npm run build` (`28` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d --build backend frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/daily-post`
- `frontend/app/workflows/daily-post/page.tsx` now drives Step 4/5/6 as a batch-generation workflow:
  - Step 4 no longer selects a model and only handles scene/config/reference setup plus job creation
  - Step 5 now selects the model, chooses 1-4 output count, accepts an optional extra prompt, generates images one by one, and supports per-image refine
  - Step 6 now reviews all generated images in a 2-column grid and archives using the first generated image URL
  - verification passed with `npm run build` (`28` routes), `docker-compose build --no-cache frontend`, `docker-compose up -d frontend`, and live HTTP `200` for `GET http://localhost:3010/workflows/daily-post`
- Daily post workflow Step 3 now supports on-image text language selection, and the selected value flows into job persistence and generation prompts
  - backend updates: `backend/app/models/daily_post.py`, `backend/app/schemas/daily_post.py`, and `backend/app/routers/daily_post_workflows.py` now carry `image_language`, default old/null jobs to `english` at serialization time, and append explicit language constraints to the generation prompt
  - frontend update: `frontend/app/workflows/daily-post/page.tsx` now exposes `English / Taglish / 中文` selection in Step 3, persists it in session state, and includes it in the Step 4 job-create payload
  - verification passed with `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_routers` (`47` tests) and `npm run build` (`28` routes)
- `backend/app/routers/daily_post_workflows.py` now accepts `reference_asset_ids` in the daily-post generate route body and forwards them into `ImageGenerateRequest`
  - verification passed with `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_routers` (`47` tests)
  - backend restart logs show the service is up and serving requests, including `POST /api/daily-post/jobs/2/generate 200 OK`
- `frontend/app/admin/daily-post-templates/page.tsx` now adds a light-theme daily post template admin page for list/create/edit/toggle/delete flows, and `frontend/components/layout/Sidebar.tsx` now exposes `日常互动图模版 -> /admin/daily-post-templates` under `模版中心`
  - verification passed with `npm run build` (`28` routes) and live HTTP `200` for `GET http://localhost:3010/admin/daily-post-templates`
- `backend/tests/test_routers.py` now includes 10 `daily_post` route tests covering template type/list/create/toggle/delete and job create/list/get flows
  - verification passed with `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_routers` (`47` tests)
- `/workflows` task list now recognizes `daily_post` sessions:
  - daily post rows show green `日常互动图` badges, route to `/workflows/daily-post?session_id=...`, and omit expression-only copy actions
  - verification passed with `npm run build` (`27` routes) and live HTTP `200` for `GET http://localhost:3010/workflows`
- Daily post workflow is now fully wired on the frontend:
  - `frontend/app/workflows/daily-post/page.tsx` now loads template types/templates/models from the API, creates tasks/jobs, supports image generation and QC archive, and exposes save-draft/reset flows
  - verification passed with `npm run build` (`27` routes) and live HTTP `200` for `GET http://localhost:3010/workflows/daily-post`
- Daily post workflow is now scaffolded across backend, frontend, and navigation:
  - new backend module and route handler: `backend/app/routers/daily_post_workflows.py`
  - new backend ORM/schema modules for the workflow: `backend/app/models/daily_post.py` and `backend/app/schemas/daily_post.py`
  - new frontend workflow page: `frontend/app/workflows/daily-post/page.tsx`
  - new daily post constants added in `frontend/lib/constants.ts`
  - sidebar task-center navigation now includes `日常互动图 -> /workflows/daily-post`
  - verification currently passes with `node --test frontend/lib/sidebar-nav.test.ts`, `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_base_layer backend.tests.test_models backend.tests.test_schemas backend.tests.test_routers`, and `npm run build` with `27` routes
- Image workflow shared UI components are now extracted into `frontend/components/workflow/` and adopted by the background, activity, and expression workflow pages without changing business behavior:
  - new shared components: `ModelSelector.tsx`, `GenerateButton.tsx`, `ImageReviewCard.tsx`, `StepLayout.tsx`, `WorkflowStepHeader.tsx`, and extracted `WhitespacePositionPicker.tsx`
  - `frontend/app/workflows/background/page.tsx` now uses the shared step shell, headers, model selectors, generate button, review cards, and externalized whitespace-position picker
  - `frontend/app/workflows/activity/page.tsx` now uses the shared step shell, headers, model selector, and generate button
  - `frontend/app/workflows/expression/page.tsx` now uses the shared step shell, step header, model selector, and generate button while preserving its existing 9-step workflow logic
  - `frontend/lib/workflow-components.test.ts` now also includes 6 render-level smoke regressions covering nullable/empty `ModelSelector` inputs, `GenerateButton` loading/disabled states, `StepLayout` child rendering, and `WorkflowStepHeader` title-only rendering
  - `docker-compose up -d --build frontend` succeeded, and live HTTP smoke returned `200` for `GET http://localhost:3010/workflows/expression`
  - verification passed with `node --test frontend/lib/workflow-components.test.ts` (`13` tests), `node --test frontend/lib/expression-workflow.test.ts`, `node --test frontend/lib/background-workflow.test.ts`, `104` backend unit tests, and `npm run build` with `26` routes
- Background workflow Step 3 now supports per-image `refine_prompt` instructions for AI refine:
  - `frontend/app/workflows/background/page.tsx` adds a per-card `精修指令（可选）` textarea above the `AI 精修` button and keeps independent `refinePromptByImageId` state for each reviewed image
  - `POST /api/background/images/{id}/refine` now submits `refine_prompt` together with `model_config_id`
  - `backend/app/schemas/background.py` adds `BackgroundImageRefineRequest.refine_prompt`
  - `backend/app/services/background_prompt.py` now exposes `append_refinement_instructions()` so `Refinement instructions:` can be inserted before `Restrictions:`
  - `backend/app/routers/background.py` now appends the per-image refine instructions to the original batch prompt during AI refine generation
  - verification passed with `104` backend unit tests, `npm run build` with `26` routes, and `docker-compose up -d --build backend frontend`
- Background batch generation now loops single-image `gpt-image` calls for multi-image requests:
  - `backend/app/routers/background.py` no longer sends `count=N` once for normal background batch generation
  - non-regenerate Step 2 generation now calls `ai_gateway.generate_image(...)` `N` times with `count=1`, merges returned URLs, and writes all successful images into `background_images`
  - partial failures no longer fail the whole batch; only the all-failed case returns `502`
  - single-image regenerate keeps the original one-request path unchanged
  - verification passed with `104` backend unit tests, `docker-compose up -d --build backend`, and a live smoke check where batch `id=10` generated with `count=4` and `SELECT COUNT(*) FROM background_images WHERE batch_id = 10` returned `4`
- Background workflow Step 1 now supports an optional `补充描述` / `extra_prompt` field end-to-end:
  - `frontend/app/workflows/background/page.tsx` adds a 3-row textarea below leave-white controls and sends `extra_prompt` during batch creation
  - `backend/migrations/init.sql`, `backend/app/models/background.py`, `backend/app/schemas/background.py`, and `backend/app/main.py` now define and runtime-sync `background_generation_batches.extra_prompt`
  - `backend/app/routers/background.py` persists `extra_prompt` on `POST /api/background/batches/create`
  - `backend/app/services/background_prompt.py` injects `Additional details:` plus the saved `extra_prompt` before `Restrictions:`
  - verification passed with `104` backend unit tests, `npm run build` with `26` routes, `docker-compose up -d --build backend frontend`, and a live smoke check where batch `id=8` stored `extra_prompt='地方集市，摊位密集'`
- Project structure from `docs/PROJECT_STRUCTURE.md` has been scaffolded.
- Backend foundation layer is implemented:
  - `backend/app/config.py`
  - `backend/app/database.py`
  - `backend/app/dependencies.py`
  - `backend/app/utils/response.py`
  - `backend/app/utils/security.py`
- PostgreSQL migration SQL is implemented in `backend/migrations/init.sql`.
- SQLAlchemy 2.0 ORM models are implemented for all core tables.
- Pydantic v2 schemas are implemented for auth, tasks, prompts, assets, generation, review, and stats.
- FastAPI router modules are implemented under `backend/app/routers/` for auth, users, tasks, prompts, assets, generation, review, gallery, stats, and audit logs.
- Business services are implemented under `backend/app/services/`:
  - login/JWT generation
  - task CRUD and status-machine validation
  - prompt template variable replacement
  - OpenAI/Google AI gateway routing with key rotation and retry
  - token cost calculation and generation cost logging
  - local file storage
  - audit log writing
- Routers now delegate to services or thin database operations instead of returning static mock objects.
- `backend/app/main.py` now creates the FastAPI app, configures CORS, registers all router modules, exposes `GET /`, and logs startup config with database URL masking.
- `backend/app/main.py` mounts local storage under `/static` so uploaded files can be loaded by browsers.
- `httpx` has been added for outbound AI provider calls.
- Frontend foundation components are implemented:
  - `frontend/lib/auth.ts`
  - `frontend/components/layout/Topbar.tsx`
  - common components: `PageHeader`, `StatCard`, `ConfirmDialog`
  - task components: `TaskStatusBadge`, `TaskTable`
  - image components: `ImageCard`, `ImageGrid`
  - prompt component: `PromptEditor`
- Frontend project configuration is implemented:
  - `frontend/package.json`
  - `frontend/tsconfig.json`
  - `frontend/next.config.js`
  - `frontend/tailwind.config.js`
  - `frontend/postcss.config.js`
  - `frontend/app/globals.css`
- Frontend dependencies install successfully and the Next.js production build completes.
- Frontend first-page batch is implemented:
  - `frontend/app/login/page.tsx`
  - `frontend/app/dashboard/page.tsx`
  - `frontend/app/tasks/page.tsx`
  - `frontend/app/tasks/create/page.tsx`
- Frontend second-page batch is implemented:
  - `frontend/app/tasks/[id]/page.tsx`
  - `frontend/app/prompts/page.tsx`
  - `frontend/app/assets/page.tsx`
  - `frontend/app/review/page.tsx`
- Frontend final-page batch is implemented:
  - `frontend/app/gallery/page.tsx`
  - `frontend/app/stats/page.tsx`
  - `frontend/app/admin/users/page.tsx`
  - `frontend/app/admin/api-keys/page.tsx`
  - `frontend/app/admin/logs/page.tsx`
- `frontend/lib/api.ts` now includes `apiPut`, `apiPatch`, and `apiDelete` helpers.
- `frontend/components/layout/AppShell.tsx` now hides the Sidebar for `/login` while preserving the normal app shell for other routes.
- Backend frontend-support patch is implemented:
  - `POST /api/api-keys/create`
  - `GET /api/api-keys`
  - `GET /api/stats/images`
- Background generation module is implemented end-to-end:

## 视频工作流第二阶段（2026-05-08 完成）

### 已完成
- Step 6 后处理重构为蒙版叠加系统
  - Logo 可拖拽定位，大小可调
  - 字幕层（位置/字体大小）
  - CTA 层（位置/样式）
  - BGM 占位
  - 实时预览（自定义播放控制栏）
  - 放大预览弹窗
- compose-all 多层 FFmpeg 合成
  - Logo（透明通道 RGBA）
  - 字幕（drawtext，支持 txt_pop/txt_fade）
  - CTA（drawtext，支持 cta_pulse 呼吸感）
  - 程序动效（cam_slow_push/cam_micro_shake/global_flash 等）
- 版本管理修复
  - originalFinalId / composedFinalId 固定
  - finalVideos（原始）/ composedVideos（合成）分离
  - Step 6 固定显示原始，Step 7 固定显示合成
- 删除确认弹窗 + 显示已归档切换
- 视频列表缩略图显示
- 任务恢复修复（motionData、finalVideos、composedVideos）
- FFmpeg 安装到 Docker 容器
- storage volume 持久化挂载

### 待处理
- 程序动效实际验证（第 51 条已实现，未测试）
- 字幕合成中文字体支持
- 音频素材库
- 公网部署（PUBLIC_BACKEND_URL）
  - backend tables, ORM, schemas, and `/api/background/*` routes are in place
  - `/workflows/background` now provides the four-step background workflow
  - task center, sidebar, and assets `use_count` display are connected to the new workflow
- Background AI generation is now wired to the real gateway:
  - prompt assembly lives in `backend/app/services/background_prompt.py`
  - `GET /api/background/available-models` filters to active final/both configs
  - `POST /api/background/batches/{id}/generate` requires an explicit `model_config_id`, writes generated images back into the batch, and returns the full refreshed batch
  - `/workflows/background` Step 2 now loads models, submits the selected model, and supports approve / reject / regenerate / refine actions
  - smoke check reached the gateway path and correctly surfaced a 502 when the upstream model rejected the request
- Background size-ratio mapping is fixed for AI generation:
  - `backend/app/services/background_prompt.py` now exposes `map_size_ratio_to_pixels()` for `1:1` / `4:5` / `16:9` / `9:16`
  - `backend/app/routers/background.py` now sends mapped pixel sizes to `ai_gateway` instead of raw ratio strings
  - backend smoke check for a `16:9` background batch now returns `200` and no longer triggers the upstream `不合法的size` 400 error
- Background tag grouping support is implemented end-to-end:
  - `asset_tags` now stores nullable `tag_group`, and runtime schema sync backfills known background tags into `purpose` / `scene` / `mood` / `color_style`

## Workflow / Tasks i18n Bulk Cleanup

- Ran a targeted batch scan across the workflow/task pages and `frontend/lib/i18n.ts` for remaining hardcoded Chinese UI strings.
- Fixed additional visible strings in:
  - `frontend/app/workflows/expression/page.tsx`
  - `frontend/app/workflows/activity/page.tsx`
  - `frontend/app/workflows/daily-post/page.tsx`
  - `frontend/lib/i18n.ts`
- `expression` now translates more fixed UI copy for:
  - selected-asset summary, empty states, action placeholders, model recommendation text
  - prompt/spec cards, action-number maps, draft/final generation button labels
  - Step 7 delete/skip confirmations and Step 6/7 section labels
  - several user-facing error/success messages
- `activity` now translates the remaining fixed field/select validation copy and page intro text.
- `daily-post` removed the last hardcoded Chinese fallback asset label by switching the fallback to `#id`.
- Added the missing i18n keys required by this pass, including expression workflow review/generation labels and activity form helper text.
- Verification:
  - `cd frontend && npm run build` passed
  - Docker rebuild passed with Next.js route table showing `33` app routes (`/` + `/_not-found` + 31 page routes)
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully

## workflows/page i18n Dictionary Fix

- Added the missing `workflows/page.tsx` translation keys in `frontend/lib/i18n.ts`
- Explicitly added:
  - `草稿`
  - `工作流任务`
  - `任务名`
  - `进度`
  - `管理表情制作、活动图生产、背景图生成草稿和已完成工作流`
- Also filled the other `t()` keys referenced by `frontend/app/workflows/page.tsx` but previously absent from the dictionary, including copy/list action text and loading/error text
- Verification:
  - `grep` confirmed the expected keys exist in `frontend/lib/i18n.ts`
  - `cd frontend && npm run build` passed
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully

## StepLayout i18n Fix

- `frontend/components/workflow/StepLayout.tsx` now imports `useLanguage` and translates the shared navigation buttons through `t()`
- `nextLabel` no longer hardcodes `"下一步"` in props defaults; it now resolves inside the component as `nextLabel ?? t("下一步")`
- The back button label now uses `t("上一步")`
- Verification:
  - `cd frontend && npm run build` passed
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully
  - `GET /api/assets/tags` now returns `{name, group}` objects, with non-background categories staying compatible via `group: null`
  - `/assets/tags` now supports background tag grouping UI, and `/workflows/background` Step 1 now groups from `tag.group` directly instead of inferring from tag names
  - asset-library and expression-workflow tag consumers now read tag names from object payloads
- Background tag seed data and combobox interaction are implemented:
  - startup/runtime schema sync now seeds 20 background tags into `asset_tags`
  - `POST /api/assets/tags/create-inline` supports inline create-or-return for combobox creation flows
  - `frontend/components/common/TagCombobox.tsx` now provides searchable single/multi-select chips with inline creation
  - `/workflows/background` Step 1 now uses `TagCombobox` for purpose / scene / mood / color groups, renames `是否本地化` to `本地风格化`, and upgrades leave-white selection to `whitespace_positions` multi-select
- Background archive now syncs into the reusable asset library:
  - `POST /api/background/images/{id}/archive` now creates an `assets` row for the archived background image and links existing `background` tags through `asset_tag_relations` in the same transaction
  - missing background tag rows are skipped safely during relation linking instead of being auto-created in the archive path
  - `/workflows/background` Step 4 keeps archived cards visible, disables repeat archive clicks with an `已入库` state, and shows the follow-up helper text about using the asset in the activity workflow
  - `/workflows/activity` Step 2 now shows a helper line above the background selector explaining that archived background assets can be reused directly
- TagCombobox custom-tag interaction is simplified:
  - `frontend/components/common/TagCombobox.tsx` now keeps a persistent `+ 自定义` action at the right side of the input instead of showing an inline `+ 创建` option in the dropdown
  - custom mode switches the input placeholder to `输入后按回车创建` and exposes explicit `确认` / `取消` controls with loading protection
  - pressing Enter or clicking confirm now selects an existing exact-match tag directly, or creates it through `POST /api/assets/tags/create-inline` and auto-selects it after refresh
  - Escape or cancel exits custom mode without creating any tag
- Background whitespace selection now has a visual diagram:
  - `/workflows/background` Step 1 now renders a `WhitespacePositionPicker` SVG diagram alongside the leave-white chips
  - the diagram uses 5 clickable dashed regions for `顶部 / 底部 / 左侧 / 右侧 / 中心` on a `160 x 200` canvas
  - hover adds a light preview overlay and selected regions show a darker translucent mask
  - SVG region clicks and chip-button clicks are fully synchronized through shared `whitespacePositions` state
- Background model selection is now open to draft-grade image models:
  - `GET /api/background/available-models` no longer filters to `usage_type in ('final', 'both')`; it now returns all active models the current user can access
  - background generation now accepts active permitted `draft` models as well, so operators can use low-cost composition models for the first-pass background sketch stage
  - `frontend/app/workflows/background/page.tsx` now keeps the full model list as `allModels` and no longer re-filters the API response to `final` / `both` on the client
  - `frontend/lib/background-workflow.test.ts` asserts that the old `usage_type === "final" || model.usage_type === "both"` filter is absent from the page source
  - latest backend verification baseline is now 100 passing tests
- Background workflow Step 3 now supports in-place AI refine:
  - `frontend/app/workflows/background/page.tsx` adds an `AI 精修` button beside `上传替换精修图`, uses the selected refine model, shows `精修中...`, and refreshes the batch after success so the updated card image appears immediately
  - `backend/app/routers/background.py` now exposes `POST /api/background/images/{id}/refine`, reuses the batch prompt, sends the current `background_image.image_url` as the reference image, and writes the returned image URL back to the same row
  - `backend/app/schemas/background.py` now includes `BackgroundImageRefineRequest(model_config_id)`
  - verification passed with `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests`, `npm run build` with 26 frontend routes, `docker-compose up -d --build backend frontend`, and a live smoke check where `POST /api/background/images/1/refine` returned `200`
- Backend model configuration management is implemented:
  - `backend/migrations/init.sql` includes `model_configs`.
  - `backend/app/models/model_config.py` maps the new table.
  - `backend/app/schemas/model_config.py` defines create/update/response schemas and response masking.
  - `backend/app/routers/model_configs.py` exposes create/list/update/delete/toggle endpoints.
  - `backend/app/main.py` registers the model config router.
  - `backend/app/utils/response.py` now preserves empty lists as `data: []`.
  - `model_configs.usage_type` is available in SQL, ORM, create/update/response schemas, and running Postgres; supported values are `draft`, `final`, and `both`.
- Backend user-to-model permission management is implemented:
  - `backend/migrations/init.sql` includes `user_model_permissions`.
  - `backend/app/models/user_model_permission.py` maps the association table and unique constraint.
  - `backend/app/schemas/user_model_permission.py` defines grant/response schemas.
  - `backend/app/routers/permissions.py` exposes grant/revoke/user-list endpoints and `GET /api/model-configs/available`.
  - Admin users bypass permission filtering and receive all active model configs from `/api/model-configs/available`.
- Backend generation now uses `model_configs` for runtime credentials:
  - `ImageGenerateRequest` includes `model_config_id` and optional `mode` (`draft` / `final`) so the gateway can distinguish draft collage generation from final-image generation.
  - `POST /api/generate/image` checks user permission for the requested model config; admin bypasses permission filtering.
  - `ai_gateway.py` reads `api_key`, optional `base_url`, `provider`, and `model_name` from `model_configs` instead of env API keys.
  - Any model config with non-empty `base_url` is treated as an OpenAI-compatible relay regardless of `provider`; `/v1` suffixes are normalized to avoid duplicate path segments.
  - `backend/app/routers/generate.py` now resolves `reference_asset_ids` and `draft_image_id` into image URLs before gateway calls.
  - `ai_gateway.py` accepts reference image URLs, expands local `/static/...` URLs to `http://localhost:8000/static/...`, base64-encodes successful downloads, and falls back to text-only generation if downloads fail.
  - Reference images are now capped at 4 images and compressed with Pillow to JPEG, max 1024x1024 and about 500KB per image, before base64 encoding to avoid oversized relay request bodies.
  - Gemini-style OpenAI-compatible relay generation uses `/chat/completions` instead of `/images/generations` or `/images/edits`, matching aihubmix/laozhang-style multimodal relay behavior.
  - Relay requests send text-only prompts as `messages[].content` strings, and send downloaded reference images as `image_url` data URIs plus text in multimodal `messages[].content` arrays.
  - Relay responses are parsed from `choices[].message.multi_mod_content`, `choices[].message.images`, and `choices[].message.content`; HTTP URLs, Markdown image data URIs such as `![image](data:image/jpeg;base64,...)`, `data:image/...;base64,...` images, and raw PNG/JPEG/WebP base64 payloads are extracted, with base64 images saved back to local `/static/...` storage.
  - OpenAI-compatible relay `count` is handled by looping one `/chat/completions` request per requested image for non-draft calls, because common relays return only one image per call; partial failures are logged and successful images are still returned. Draft-mode relay calls with `count > 1` intentionally call the provider once and let the prompt describe the N-grid collage, accepting either one collage image or multiple returned images.
  - Relay/image-API saved base64 image filenames include a short UUID plus the generation sequence, e.g. `chat-generated-{task_id}-{uuid}-{index}.jpg`, to avoid overwriting files across repeated calls for the same task.
  - OpenAI-compatible image API models such as `gpt-image-2-all`, `gpt-image-2`, `gpt-image-1`, `chatgpt-image`, and `dall-e` now bypass relay chat/completions. With reference images they use `{base_url}/images/edits` as `multipart/form-data` with `image[]` file parts; without references they use `{base_url}/images/generations` JSON with `n=1`.
  - The older `gpt-image-2-all` `/chat/completions` helper remains in code for fallback/reference but is no longer selected by the normal `base_url` routing path.
  - Image API requests send `quality=high` and `output_format=png` for edits, parse pure `b64_json` responses without requiring a `data:image/...` prefix, and save returned base64 images into local static storage.
  - Native Google Gemini generation is used only when `base_url` is empty and sends downloaded references as `inline_data` parts before the text prompt.
  - Provider JSON calls now use a 600-second timeout for slow image models, wait 30 seconds before retrying after HTTP 429, and use incremental retry backoff of 5 seconds then 10 seconds for other transient HTTP errors.
  - `model_configs.used_today` is updated after provider calls.
- Frontend stats image performance table now calls `GET /api/stats/images`.
- Frontend model configuration admin page is implemented at `frontend/app/admin/models/page.tsx`.
- Frontend model configuration admin page now supports a `用途` dropdown in create/edit forms and shows usage labels in the model table.
- Sidebar navigation includes `/admin/models`.
- Frontend user management now includes a per-user "模型权限" panel for granting and revoking model access.
- Frontend task detail generation now loads `/api/model-configs/available`, shows a model selector, and sends `model_config_id` to `/api/generate/image`.
- Asset upload and thumbnail serving are implemented:
  - `backend/app/routers/assets.py` accepts multipart file uploads and stores the uploaded bytes.
  - `backend/app/services/storage_service.py` returns `/static/...` URLs for task images and assets.
  - `backend/requirements.txt` includes `python-multipart`.
  - `frontend/app/assets/page.tsx` supports multi-file selection, sequential upload progress, and full backend image URLs for thumbnails.
- Asset tag management is implemented:
  - `backend/migrations/init.sql` includes `asset_tags` and `asset_tag_relations`.
  - `backend/app/models/asset_tag.py` maps reusable asset tags with category and the asset/tag relation table.
  - Running Postgres has `asset_tags.category`, no global tag-name uniqueness, and a `(category, name)` unique index.
  - `GET /api/assets/tags` returns persistent tags directly from `asset_tags`, optionally scoped by category.
  - `POST /api/assets/upload` accepts comma-separated `tags`, auto-creates missing tags, and links them to the uploaded asset.
  - `GET /api/assets?category=&tags=高兴,哭泣` filters by multi-tag intersection.
  - `GET /api/assets/tags/manage?category=xxx` returns tags with `image_count`.
  - `POST /api/assets/tags/create`, `PATCH /api/assets/tags/{tag_id}`, and `DELETE /api/assets/tags/{tag_id}` support tag management APIs.
  - `PATCH /api/assets/{id}/tags` updates an existing asset's comma-separated `tags` field and rebuilds its tag relations.
  - `frontend/app/assets/page.tsx` supports upload tags through a category-scoped dropdown multi-select with custom Enter-created tags.
  - `frontend/app/assets/page.tsx` supports editing existing asset card tags with category-scoped existing-tag choices, custom Enter-created tags, and save/cancel controls.
  - `frontend/app/assets/page.tsx` supports category-scoped dropdown multi-select filtering, clear filter, and tag chips on asset cards.
  - `frontend/app/assets/tags/page.tsx` provides category-scoped tag management with rename, image counts, and delete confirmation.
  - Asset page filtering now hides tag filters in the "全部" view and shows category-scoped tag filters only inside a concrete category.
  - Upload tag choices are loaded from the current upload category, selected inside the dropdown, and can still be extended by typing a custom tag and pressing Enter.
  - Asset upload metadata is now read from multipart form fields as well as query parameters; FormData `filename`, `category`, and `tags` are preserved during upload.
- Instruction library foundation is implemented:
  - `backend/migrations/init.sql` includes `workflow_types` and `instructions`, plus a default `expression` workflow type.
  - `backend/app/models/instruction.py` maps `WorkflowType` and `Instruction`.
  - `backend/app/schemas/instruction.py` defines workflow type and instruction create/update/response schemas.
  - `backend/app/routers/instructions.py` exposes workflow type list/create and instruction list/create/update/delete/toggle endpoints.
  - `backend/app/main.py` registers the instruction router.
  - Running Postgres has `workflow_types` and `instructions`, with default `表情制作` / `expression`.
  - `frontend/lib/constants.ts` now supports Sidebar groups and places `表情制作` under `任务中心`.

## 热点借势工作流（完整交付）

### 手动热点工作流 `/workflows/trending`
- 6步工作流：热点输入 → 约束预览 → 借势参数 → 规格设置 → 生成图片 → 审核归档
- topic_type 配置驱动，支持5种分类，风险等级/游戏元素/借势角度/图片类型/牛动作全部由配置控制
- Step 4 参考图选择：排除 background 分类，按动作名模糊匹配标签（含 ACTION_TAG_HINTS 映射表），标签点击正确筛选，已选预览区支持单张取消和清空全部
- Step 5 直接出正式图，每张图支持通过/精修/删除独立操作，精修支持 Enter 键提交
- Step 6 确认归档写入成品图库 `source_type=trending`
- Session 草稿自动保存，支持 `?session_id=` URL 恢复
- 归档完成后在 `/workflows` 列表显示橙色「热点借势图」badge

### 新闻推送工作流 `/workflows/trending-news`
- 6步工作流：选热点 → 约束预览 → 借势参数 → 规格设置 → 生成图片 → 审核归档
- Step 1 从导入列表选热点，展示标题/摘要/分类/风险等级/来源/主要实体
- 复用 trending 工作流的生成/精修/归档逻辑，Prompt 使用富字段（event_summary/main_entities/event_action/event_result）
- 归档时同步更新新闻任务状态为 ARCHIVED

### 热点新闻导入
- `POST /api/hotspot/import`：上传 JSON 文件，校验 schema_version/topic_type/risk_tags/task_id 唯一性
- `GET /api/hotspot/tasks`：获取已导入热点列表，支持按状态/分类筛选
- `/admin/hotspot-import`：可视化导入管理页面，支持拖拽上传、导入结果展示、已导入列表管理
- 去重规则：task_id 优先，跳过重复项
- risk_tags 含高风险标签时自动强制升级为 HIGH，禁止游戏元素

### 新闻工作台对接
- 新闻主程序每日运行后自动导出到 `/Volumes/AIWork/projects/shared/news_hotspots/YYYY-MM-DD/hotspot_tasks.json`
- 导出模块独立封装（`src/export/hotspot_task_exporter.py`），不影响已有抓取分析逻辑
- 完整链路：新闻主程序 → JSON 导出 → `/admin/hotspot-import` 上传 → `/workflows/trending-news` 生产

### 数据库
- `trending_jobs`：热点借势任务表
- `trending_topic_type_config`：12种 topic_type 配置（原5种 + 新增7种）
- `trending_news_tasks`：新闻推送热点任务表，含完整富字段和状态追踪

### 线上升级预备
- 完整设计见 `docs/HOTSPOT_NEWS_INTEGRATION.md`
- 升级时只需新增 `ApiHotspotAdapter`，不改 Prompt 生成和风控逻辑
  - `frontend/components/layout/Sidebar.tsx` supports expandable child navigation.
  - `frontend/app/instructions/page.tsx` provides workflow switching, instruction list, inline create/edit form, toggle, and delete confirmation.
- Expression workflow page is implemented:
  - `frontend/app/workflows/expression/page.tsx` provides a single-page 9-step wizard with backtracking and preserved `workflowState`.
  - The wizard supports full flow mode from Step 1 and direct refine mode starting at Step 6 with image upload.
  - Step 1 creates a backend task through `POST /api/tasks/create` and stores `taskId`.
  - Steps 2 and 6 load reusable instructions from the instruction library and merge selected instruction content with freeform prompts.
  - Step 3 loads expression assets, supports tag filtering, and multi-select reference assets.
  - Step 4 configures size, background, and an action list. The old output-count dropdown has been removed; each non-empty action row now represents one draft image to generate.
  - Step 5 calls `POST /api/generate/image` for draft generation using an available model.
  - Step 5 model selection only uses active, quota-available `draft`/`both` model configs and recommends the lowest-priced matching model.
  - Step 5 draft prompt assembly now sends a single `/api/generate/image` request with `count` equal to the filled action count. The prompt asks for one numbered collage draft, with each cell labeled `1`, `2`, `3`, etc. and mapped to the action list.
  - Step 5 summary now shows the action-number table and a collapsible preview of the exact numbered-collage prompt that will be sent.
  - Step 5 clears stale draft images before generation and displays the returned collage draft image(s) as reference material.
  - Step 6 full-flow final generation no longer requires selecting draft images. It shows the Step 5 collage draft and action-number table as reference, defaults all action numbers selected, and lets the user choose which numbered actions should become final images.
  - Step 6 full-flow final generation calls `POST /api/generate/image` once per selected action with `count: 1`, using the high-price model, Step 3 reference assets, the refine prompt, and that action description. If the refine prompt contains `{{action}}`, the selected action replaces that placeholder; otherwise `动作：{action}` is appended. Each finished final image is appended immediately and labeled with the full action description.
  - Step 6 UI now uses a larger preview layout: the collage draft reference image is at least 200x200, final result images are at least 240x240, action descriptions wrap without truncation, and draft/final images can be opened in a full-screen preview overlay with click-outside or ESC close.
  - Step 6 direct-refine mode still calls `POST /api/generate/image` for final generation from selected drafts or uploaded refine images.
  - Step 6 and Step 7 model selection only use active, quota-available `final`/`both` model configs and recommend the highest-priced matching model; invalid restored/default selections are automatically replaced.
  - Step 7 is the new consistency-refinement step: it displays Step 6 finals for multi-select, accepts custom uploads, loads instruction-library prompts plus freeform additions, reuses Step 3 references by default, can reopen the category/tag-filtered asset picker, chooses a high-price model/count, and stores generated results in `workflowState.consistencyImages`.
  - Step 7 consistency-refinement failures no longer block the workflow: failed source images can be skipped from `toRefineImages` into `confirmedImages`, so skipped images remain available in Step 8 review and Step 9 archive.
  - Step 7 consistency generation requests use a 660000 ms frontend timeout.
  - Step 8 supports review comparison, regenerate/refine actions, per-image confirmation, and confirm-all across both Step 6 final images and Step 7 consistency images.
  - Step 9 archives confirmed final/consistency images back to the expression asset library through `POST /api/assets/upload`.
- Workflow session persistence is implemented:
  - `backend/migrations/init.sql` includes `workflow_sessions`.
  - `backend/app/models/workflow_session.py` maps persisted workflow sessions.
  - `backend/app/routers/workflow_sessions.py` exposes save/list/detail/delete APIs.
  - Running Postgres has been updated with `workflow_sessions`.
  - `frontend/app/workflows/expression/page.tsx` can save drafts, autosave on step changes, restore from `?session_id=xxx`, and mark archived sessions completed.
  - `frontend/app/workflows/page.tsx` lists draft/completed sessions by full/direct-refine mode, supports continue/delete, and can copy completed sessions into a fresh draft.
  - `frontend/lib/constants.ts` adds `任务列表` under the `任务中心` sidebar group.
- Backend unit tests cover base layer, ORM metadata, migration table coverage, schema contracts, router registration/dependency wiring, service business rules, and app integration.
- FB活动图工作流 V1.1 is completed:
  - Running Postgres has been manually migrated with `activity_template_types`, `activity_templates`, `activity_variable_presets`, and `activity_generation_jobs`.
  - Backend routes now include `/api/activity/template-types`, `/api/activity/templates`, `/api/activity/variable-presets`, and `/api/activity/jobs/*`.
  - Frontend now includes `/workflows/activity` and `/admin/activity-templates`.
  - Sidebar `任务中心` now includes `活动图生产`.
  - Latest backend verification passed 67 tests.
  - Latest frontend Docker build generated 24 app routes.
- Sidebar workflow child-item style inconsistency is fixed:
  - `frontend/components/layout/Sidebar.tsx` now uses shared helper logic for child-item active matching and class generation.
  - `任务列表`、`表情制作`、`活动图生产` now share the same submenu text-style rendering rules.
  - Active child items no longer render as dark filled blocks.
  - `frontend/lib/sidebar-nav.test.ts` adds regression coverage for child-item config shape, active-path matching, and class output.
- Activity workflow page visual style is aligned with the rest of the workflow area:
  - `frontend/app/workflows/activity/page.tsx` now uses shared gray-theme class helpers instead of ad-hoc near-black shell/card styles.
  - The page shell, step rail, content cards, and template-type tabs now use consistent deep-gray backgrounds, gray borders, and matching spacing/radius.
  - The change is style-only and does not alter activity workflow business logic.
  - `frontend/lib/activity-workflow-theme.ts` and `frontend/lib/activity-workflow-theme.test.ts` add regression coverage for shell, step card, and tab styling rules.
- End-to-end Docker startup environment is implemented:
  - `docker-compose.yml` defines `frontend`, `backend`, `db` (`postgres:16`), `redis`, and `storage` (`minio/minio`) services.
  - `backend/Dockerfile` uses `python:3.11-slim` and starts `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
  - `frontend/Dockerfile` uses `node:20-alpine`, installs dependencies, builds Next.js, and starts `npm run dev`.
  - `.env.example` and local `.env` contain local development defaults for Postgres, Redis, storage, and API base URLs.
  - `backend/migrations/init.sql` is mounted into Postgres at `/docker-entrypoint-initdb.d/init.sql`.
- Docker E2E fixes are implemented:
  - `backend/app/routers/audit.py` and `backend/app/routers/gallery.py` import `datetime` explicitly for Python 3.11 container runtime.
  - `frontend/app/page.tsx` redirects `/` to `/dashboard`.
- Frontend API list rendering is hardened against wrapped or malformed response data:
  - API list setters now use `Array.isArray(res.data) ? res.data : []`.
  - Page/component `.map()` call sites now render from safe arrays instead of raw API/prop values.
  - Covered tasks, prompts, assets, gallery, review, stats, admin users, admin API keys, admin logs, task detail, and shared components.
- Sidebar regroup and template-center entry refactor are implemented:
  - `frontend/lib/constants.ts` now exports `NAV_GROUPS` with the new IA: `首页看板`, `任务中心`, `模版中心`, `素材库`, `标签管理`, `审核中心`, `成品图库`, `统计中心`, and `管理后台`.
  - `指令库`, `Prompt 模版`, and `活动图模版` were moved under `模版中心`.
  - `管理后台` now keeps only `用户管理`, `模型配置`, and `系统日志`.
  - `标签管理` now contains both `素材标签管理` and the new `成品图标签管理` sidebar entry.
  - `frontend/app/gallery/tags/page.tsx` now provides a placeholder page so `/gallery/tags` builds cleanly before the full feature lands.
- Activity template style-tag and final-image source metadata upgrade are implemented:
  - Running Docker Postgres and `backend/migrations/init.sql` now both include `activity_templates.style_tag` plus `final_images.source_type`, `final_images.sub_category`, and `final_images.style_tag`.
  - `backend/app/models/activity_template.py` and `backend/app/models/image.py` now map those new columns in ORM.
  - `backend/app/schemas/activity_template.py` now exposes `style_tag` in activity template create/update/response payloads.
  - `backend/app/routers/activity_workflows.py` archive logic now looks up the related template and template type, then writes `source_type='activity'`, `sub_category=template_type.code`, and `style_tag=template.style_tag` into `final_images`.
  - `backend/app/routers/gallery.py` local final-image request/response models now support the new metadata fields for consistency with the expanded table.
  - `frontend/app/admin/activity-templates/page.tsx` and `frontend/lib/activity-template-admin.ts` now support a `风格标签` form field that persists through the admin template payload and is intended for automatic archive tagging.
  - Regression coverage now checks activity template `style_tag`, activity job request fields, final-image ORM metadata columns, archive metadata write-through, and frontend template payload normalization.
- Gallery three-level filter upgrade is implemented:
  - `backend/app/routers/gallery.py` now exposes `GET /api/gallery/categories`, `GET /api/gallery/tags`, and `GET /api/gallery/finals`.
  - Gallery categories are grouped by 6 hard-coded top-level `source_type` buckets, while activity sub-categories dynamically map `activity_template_types.code -> name`.
  - Gallery final-image listing now supports optional `source_type`, `sub_category`, and `style_tag` filters.
  - `frontend/app/gallery/page.tsx` was rewritten into a light-theme browser with a left-side directory tree, top-level tag chips, and a right-side image grid.
  - `frontend/lib/gallery-browser.ts` adds query-string and normalization helpers used by the new gallery page.
  - Regression coverage now checks gallery route registration, `finals` filter params, and frontend gallery helper behavior.
- Gallery tag management is implemented:
  - `backend/migrations/init.sql` and the running Docker Postgres database now include the independent `gallery_tags` table with unique `(source_type, name)`.
  - `backend/app/models/gallery_tag.py` and `backend/app/schemas/gallery_tag.py` now define the GalleryTag ORM + create/update/response schemas.
  - `backend/app/routers/gallery.py` now exposes `GET /api/gallery/tags/manage`, `POST /api/gallery/tags/create`, `PATCH /api/gallery/tags/{tag_id}`, and `DELETE /api/gallery/tags/{tag_id}`.
  - Gallery tag rename now synchronizes matching `final_images.style_tag` values within the same `source_type`.
  - Activity archive now upserts `gallery_tags` and increments `image_count` when an archived final image carries a `style_tag`.
  - `frontend/app/gallery/tags/page.tsx` was rewritten from placeholder to a full light-theme management page with source-type tabs, inline create/rename, and delete confirmation.
  - `frontend/lib/gallery-tag-admin.ts` adds source-type metadata plus normalized managed-tag parsing for the new page.
- Activity template schema now allows flexible template numbers:
  - `backend/app/schemas/activity_template.py` changed `template_no` validation from the old `T01`-`T25` regex to a generic non-empty string constraint with `min_length=1` and `max_length=20`.
  - Schema coverage now verifies that values such as `TX1` are accepted while empty strings are still rejected.

## Latest Verification

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest \
  backend.tests.test_base_layer \
  backend.tests.test_models \
  backend.tests.test_schemas \
  backend.tests.test_routers \
  backend.tests.test_services \
  backend.tests.test_main
```

Observed latest result: 67 tests pass.

Latest activity workflow visual-style verification:

- `node --test frontend/lib/activity-workflow-theme.test.ts` passed 4 tests.
- `node --test frontend/lib/sidebar-nav.test.ts` still passed 3 tests after the activity workflow page styling changes.
- `npm run build` in `frontend/` completed successfully and generated 24 app routes.
- `docker-compose up -d --build frontend` rebuilt/restarted the frontend container successfully.
- `GET http://localhost:3010/workflows/activity` returned HTTP 200 after rebuild.

Latest background workflow verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 88 tests.
- `node --test frontend/lib/background-workflow.test.ts frontend/lib/tag-combobox.test.ts frontend/lib/asset-tags-page.test.ts frontend/lib/assets-page.test.ts` passed.
- `npm run build` completed successfully with 26 app routes, including `/workflows/background`.
- `docker-compose up -d --build backend frontend` rebuilt and restarted both services successfully.
- Smoke checks returned HTTP 200 for `GET http://localhost:3010/workflows/background`.
- Running Postgres now contains 20 `background` tag rows in `asset_tags`.
- Authenticated `GET http://localhost:8000/api/assets/tags?category=background` returned 20 grouped object records.
- Authenticated `GET http://localhost:8000/api/assets/tags?category=expression` returned object records with `group: null`.
- Authenticated `POST http://localhost:8000/api/assets/tags/create-inline` created and returned a temporary background tag; deleting it restored the seed set back to 20 rows.

Latest Sidebar child-nav style verification:

- `node --test frontend/lib/sidebar-nav.test.ts` passed 4 tests.
- The regression verifies that `任务中心` child items use only `href` / `label` definitions, `模版中心` contains `/instructions`, `/prompts`, and `/admin/activity-templates`, `标签管理` contains `/assets/tags` plus `/gallery/tags`, and `管理后台` excludes `活动图模版`.
- `npm run build` in `frontend/` completed successfully and generated 25 app routes, including the new `/gallery/tags` placeholder page.

Latest style-tag and final-image metadata verification:

- `docker-compose exec db psql -U ai_workbench -d ai_workbench -c "...style_tag/final_images ALTER..."` returned `ALTER TABLE` for both statements in the running container database.
- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 72 tests` and `OK`.
- `cd frontend && npm run build 2>&1 | tail -5` completed successfully; a fresh full `npm run build` confirmed `Generating static pages (25/25)` and still included `/gallery/tags`.
- `docker-compose up -d --build backend frontend` rebuilt both images and restarted both application containers successfully.
- Smoke checks returned HTTP 200 for:
  - `GET http://localhost:8000/docs`
  - Authenticated `GET http://localhost:8000/api/activity/templates`

Latest gallery three-level filter verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 73 tests` and `OK`.
- `cd frontend && npm run build 2>&1 | tail -5` completed successfully; fresh local and Docker builds both confirmed `Generating static pages (25/25)`.
- `docker-compose up -d --build backend frontend` rebuilt and restarted both app containers successfully after a transient registry metadata fetch retry.
- Smoke checks returned HTTP 200 for:
  - Authenticated `GET http://localhost:8000/api/gallery/categories`
  - Authenticated `GET http://localhost:8000/api/gallery/tags`
  - `GET http://localhost:3010/gallery`

Latest gallery tag management verification:

- `docker-compose exec db psql -U ai_workbench -d ai_workbench -c "...CREATE TABLE IF NOT EXISTS gallery_tags..."` returned `CREATE TABLE` in the running container database.
- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 75 tests` and `OK`.
- `cd frontend && npm run build 2>&1 | tail -5` completed successfully; fresh local and Docker builds both confirmed `Generating static pages (25/25)`, including `/gallery/tags`.
- `docker-compose up -d --build backend frontend` rebuilt and restarted both app containers successfully.
- Smoke checks returned HTTP 200 for:
  - Authenticated `GET http://localhost:8000/api/gallery/tags/manage`
  - `GET http://localhost:3010/gallery/tags`

Latest activity template number validation verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -3` reported `Ran 75 tests` and `OK`.
- `docker-compose up -d --build backend` rebuilt and restarted the backend container successfully.
- `curl --noproxy '*' -s -o /dev/null -w '%{http_code}' http://localhost:8000/docs` returned HTTP 200.

Latest activity workflow migration and smoke verification:

- `docker-compose exec -T db psql -U ai_workbench -d ai_workbench -c "...activity workflow migration SQL..."` created the 4 activity workflow tables in the already-running Postgres database and inserted the initial 5 template types plus 11 variable presets without any SQL error.
- Post-migration counts confirmed `activity_template_types = 5` and `activity_variable_presets = 11`.
- `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers successfully.
- `docker-compose ps` showed `backend`, `frontend`, `db`, `redis`, and `storage` running, with `db` healthy.
- `PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 67 tests.
- Frontend Docker build generated 24 app routes, including `/workflows/activity` and `/admin/activity-templates`.
- Smoke verification returned HTTP 200 for:
  - `GET http://localhost:3010/workflows/activity`
  - `GET http://localhost:3010/admin/activity-templates`
  - `GET http://localhost:8000/docs`
  - `POST http://localhost:8000/api/auth/login`
  - `GET http://localhost:8000/api/activity/template-types`
  - `GET http://localhost:8000/api/activity/variable-presets`
  - `GET http://localhost:8000/api/activity/templates`

Latest AI gateway `gpt-image-2-all` image-edit verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 54 tests, including long provider timeout, 429 wait, retry-backoff coverage, `gpt-image-2` multipart edits, JSON generations, spaced model-name recognition, `gpt-image-2-all` multipart edits routing, unique generated filenames for repeated same-task saves, and existing asset tag editing.
- `docker-compose up -d --build backend` rebuilt and restarted the backend container successfully.
- After the unique filename fix, `docker-compose up -d --build backend` rebuilt/restarted the backend container again and `GET http://localhost:8000/docs` returned HTTP 200.
- `docker-compose ps` showed backend, frontend, db, redis, and storage running, with db/redis/storage healthy.
- `GET http://localhost:8000/docs` returned HTTP 200.
- Running Postgres model config `8` (`APIYI-image2`) was updated to machine model name `gpt-image-2-all` and remains active.
- Live Step 6-style generation with active model config `8` and reference asset `[26]` routed to `{base_url}/images/edits`, uploaded one `image[]` file, and returned HTTP 200 with model `gpt-image-2-all`, `token_used=1577`, `cost_usd=0.0300`, and local image URL `/static/task/6/draft/chat-generated-6-1.png` which fetched as HTTP 200 `image/png`.

Latest model usage-type verification:

- `node --test frontend/lib/model-config-form.test.ts` passed 3 tests.
- `node --test frontend/lib/expression-workflow.test.ts` passed 11 tests.
- `PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 45 tests.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- Running Postgres was updated with `ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS usage_type VARCHAR(20) DEFAULT 'both';`.
- `docker-compose up -d --build backend frontend` rebuilt and restarted backend/frontend containers successfully.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/admin/models` returned HTTP 200.
- Authenticated `GET http://localhost:8000/api/model-configs` returned model rows including `usage_type`.

Latest action-list draft generation verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 14 tests, including action-list cleanup, legacy per-action prompt generation, and combined prompt generation for one-call multi-image drafts.
- `node --test frontend/lib/model-config-form.test.ts` passed 3 tests.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- `docker-compose up -d --build frontend` rebuilt/restarted the frontend container successfully.

Latest Step 7 skip-failure verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 36 tests, including skipping a failed Step 7 source image by moving it into confirmed images.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- `docker-compose up -d --build frontend` rebuilt/restarted the frontend container successfully; Compose also rebuilt/recreated the backend via dependency handling.
- `docker-compose ps` showed frontend, backend, db, redis, and storage running, with db/redis/storage healthy.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/workflows` returned HTTP 200.

Latest numbered-collage workflow verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 18 tests, including numbered-collage draft prompt generation, final single-action prompt generation, and stale-draft clearing.
- `node --test frontend/lib/model-config-form.test.ts` passed 3 tests.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- `docker-compose up -d --build frontend` rebuilt/restarted the frontend container successfully.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/workflows` returned HTTP 200.

Latest live relay verification:

- Rebuilt backend with `docker-compose up -d --build backend`.
- Called `POST /api/generate/image` using model config `7` (`provider=google`, `base_url=https://aihubmix.com/v1`) and reference asset `18`.
- Response returned HTTP 200 with one generated image: `/static/task/5/draft/chat-generated-5-1.jpg`.
- Static image check returned HTTP 200 with `image/jpeg`.
- Latest `count=2` verification returned two generated images:
  - `/static/task/5/draft/chat-generated-5-1.jpg`
  - `/static/task/5/draft/chat-generated-5-2.jpg`
- Both static image URLs returned HTTP 200 with `image/jpeg`.
- Latest reference compression verification used three selected reference asset IDs and sent only two compressed images; backend log showed `Request payload size: 674558 bytes, images: 2`, down from the previous 9.1MB single-reference payload, and generation returned HTTP 200 with one image.

```bash
cd frontend
npm install
npm run build
```

Observed result: dependency installation completed, then `next build` compiled successfully and generated 17 app routes.

Latest frontend page build result: `npm run build` completed successfully with 17 app routes generated after wiring the image performance stats endpoint.

Latest expression prompt verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 21 tests, including Step 6 `{{action}}` replacement without duplicate action lines, cow-character locking, and enlarged Step 6 image grid classes.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- `docker-compose up -d --build frontend` rebuilt and restarted the frontend container.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.

Latest frontend hardening build result: `npm run build` completed successfully with 17 app routes generated after adding array-shape guards for API list data and component map boundaries.

Latest model config build result: `npm run build` completed successfully with 18 app routes generated, including `/admin/models`.

Latest generation model-config build result: `npm run build` completed successfully with 18 app routes generated after adding task-detail model selection.

Latest asset upload build result: `npm run build` completed successfully with 18 app routes generated after adding batch upload and static thumbnail URLs.

Latest asset tag build result: `npm run build` completed successfully with 18 app routes generated after adding upload tags, autocomplete, filter tags, and card tag chips.

Latest asset tag interaction build result: `npm run build` completed successfully with 18 app routes generated after separating category filters from upload tag choices.

Latest asset upload metadata fix build result: `npm run build` completed successfully with 18 app routes generated after moving frontend upload metadata to FormData-only submission.

Latest asset tag management build result: `npm run build` completed successfully with 19 app routes generated, including `/assets/tags`.

Latest asset tag dropdown redesign build result: `npm run build` completed successfully with 19 app routes generated after replacing upload/filter tag chips with dropdown multi-select controls and simplifying `/assets/tags` to rename/delete management.

Latest asset existing-tag edit verification:

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 54 tests, including `PATCH /api/assets/{id}/tags` route registration and relation rebuild behavior.
- `npm run build` in `frontend/` completed successfully and generated 22 routes.
- `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers.
- Smoke uploaded a temporary expression asset, patched its tags through `PATCH /api/assets/{id}/tags`, confirmed the response returned the edited tags and `GET /api/assets/tags?category=expression` included them, then deleted the smoke asset and smoke tags.
- `GET http://localhost:3010/assets` returned HTTP 200.

Latest instruction library build result: `npm run build` completed successfully with 20 app routes generated, including `/instructions`.

Latest workflow session build result: `npm run build` completed successfully with 22 app routes generated, including `/workflows` and `/workflows/expression`.

The running Postgres database has also been updated with:

```bash
docker-compose exec db psql -U ai_workbench -d ai_workbench -c "CREATE TABLE IF NOT EXISTS model_configs (...);"
docker-compose exec db psql -U ai_workbench -d ai_workbench -c "CREATE TABLE IF NOT EXISTS user_model_permissions (...);"
docker-compose exec db psql -U ai_workbench -d ai_workbench -c "CREATE TABLE IF NOT EXISTS workflow_types (...); CREATE TABLE IF NOT EXISTS instructions (...); INSERT INTO workflow_types ...;"
docker-compose exec db psql -U ai_workbench -d ai_workbench -c "CREATE TABLE IF NOT EXISTS workflow_sessions (...);"
```

Note: the local Docker database user is `ai_workbench`, not `postgres`.

```bash
docker-compose up -d --build backend frontend
curl --noproxy '*' -s -o /tmp/aiwb_login.html -w '%{http_code}' http://localhost:3010/login
curl --noproxy '*' -s -o /tmp/aiwb_prompts.html -w '%{http_code}' http://localhost:3010/prompts
curl --noproxy '*' -s -o /tmp/aiwb_docs.html -w '%{http_code}' http://localhost:8000/docs
```

Observed latest Docker frontend rebuild result:

- Frontend image rebuilt successfully; Docker build also generated 18 app routes after adding `/admin/models`.
- `docker-compose ps` shows `db`, `redis`, `storage`, `backend`, and `frontend` running.
- Frontend is published on `http://localhost:3010`.
- `http://localhost:3010/admin/models` returns HTTP 200.
- `http://localhost:3010/admin/users` returns HTTP 200 and includes the user management page.
- `GET /api/model-configs` returns `data: []` when empty.
- Creating a smoke model returns only the last 4 API key characters.
- Toggle and delete smoke checks pass; the smoke model was removed.
- Permission smoke check passed:
  - Admin `/api/model-configs/available` includes all active models.
  - A normal operator sees 0 available models before grant.
  - After `POST /api/permissions/grant`, the operator sees the granted active model.
  - After `DELETE /api/permissions/revoke`, the operator sees 0 available models again.
- Generation integration smoke check passed without calling external AI providers:
  - Admin `/api/model-configs/available` includes a newly created active model config.
  - Operator `/api/generate/image` with that `model_config_id` returns HTTP 403 before grant.
  - Operator `/api/model-configs/available` includes the model after grant and excludes it after revoke.
  - `http://localhost:3010/tasks/1` returns HTTP 200.
- Asset upload smoke check passed:
  - `POST /api/assets/upload` accepted a multipart image upload and returned `/static/assets/aiwb-smoke.svg`.
  - `GET http://localhost:8000/static/assets/aiwb-smoke.svg` returned HTTP 200 with `image/svg+xml`.
  - `GET http://localhost:3010/assets` returned HTTP 200.
- Asset tag smoke check passed:
  - Running Postgres was updated with `asset_tags` and `asset_tag_relations`.
  - `POST /api/assets/upload?...&tags=高兴` created an asset with `tags: "高兴"`.
  - `GET /api/assets/tags?category=bull_reference` returned `["高兴"]`.
  - `GET /api/assets?category=bull_reference&tags=高兴` returned the uploaded asset.
  - `GET http://localhost:8000/static/assets/aiwb-happy.svg` returned HTTP 200 with `image/svg+xml`.
- Asset tag interaction smoke check passed:
  - `POST /api/assets/upload?...&category=expression&tags=高兴` created a tagged expression asset.
  - `GET /api/assets/tags?category=expression` returned `["高兴"]`.
  - `GET /api/assets?category=expression&tags=高兴` returned the uploaded expression asset.
  - `GET http://localhost:3010/assets` returned HTTP 200 after rebuilding the frontend container.
- Asset upload metadata fix smoke check passed:
  - `POST /api/assets/upload` with multipart form fields `category=expression` and `tags=高兴,开心` returned an asset with `category: "expression"` and `tags: "高兴,开心"`.
  - `GET /api/assets/tags?category=expression` returned both `开心` and `高兴`.
  - `GET /api/assets?category=expression&tags=高兴` returned the uploaded `aiwb-form-tag-fix.png` asset with its tags.
  - `GET http://localhost:8000/static/assets/aiwb-form-tag-fix.png` returned HTTP 200 with `image/png`.
  - `GET http://localhost:3010/assets` returned HTTP 200 after rebuilding backend and frontend containers.
- Asset tag persistence and management smoke check passed:
  - Running Postgres was updated with `asset_tags.category` and `(category, name)` uniqueness.
  - `POST /api/assets/tags/create` created a temporary persistent tag under `expression` with `image_count: 0`.
  - Uploading an image with that tag changed `GET /api/assets/tags/manage?category=expression` to `image_count: 1`.
  - Deleting the image left the tag in `GET /api/assets/tags?category=expression`.
  - `GET /api/assets/tags/manage?category=expression` returned the tag with `image_count: 0`.
  - `GET http://localhost:3010/assets/tags` returned HTTP 200.
- Asset tag dropdown redesign smoke check passed:
  - Smoke tags matching `持久%` were deleted from running Postgres.
  - `POST /api/assets/upload` with multipart form fields `category=expression` and `tags=哭泣` returned an uploaded asset with `tags: "哭泣"`.
  - `GET /api/assets/tags?category=expression` included `哭泣`.
  - `GET /api/assets?category=expression&tags=哭泣` returned the uploaded asset.
  - `GET http://localhost:3010/assets` and `GET http://localhost:3010/assets/tags` returned HTTP 200 after rebuilding the frontend container.
- Instruction library smoke check passed:
  - `GET /api/workflow-types` returned the default `expression` workflow type.
  - `POST /api/instructions/create` created a temporary instruction.
  - `GET /api/instructions?workflow_type_id=...` returned the created instruction.
  - The temporary smoke instruction was deleted.
  - `GET http://localhost:3010/instructions` returned HTTP 200 after rebuilding backend and frontend containers.
  - API route inspection now shows 53 API method/path pairs.
- Expression workflow smoke check passed:
  - `GET http://localhost:3010/workflows/expression` returned HTTP 200 after rebuilding the frontend container.
  - `GET http://localhost:3010/instructions` still returned HTTP 200.
- Workflow session smoke check passed:
  - `GET http://localhost:3010/workflows` returned HTTP 200.
  - `POST /api/workflow-sessions/save` created a Step 3 full-flow draft.
  - `GET /api/workflow-sessions?workflow_type=expression&status=draft&mode=full` returned the saved session.
  - `GET /api/workflow-sessions/{id}` returned the saved `state_json`.
  - `GET http://localhost:3010/workflows/expression?session_id=...` returned HTTP 200.
  - The temporary smoke session was deleted after verification.
- Expression workflow archive tag fix completed:
  - Step 1 now stores selected task tags in both `workflowState.tags` and `workflowState.taskTags`.
  - Entering the archive step initializes per-image archive tags from the Step 1 task tags.
  - Re-entering the archive step now fills missing image tag defaults without replacing image-specific tag edits.
  - Step 9 archive cards let each confirmed image choose existing `expression` tags, add custom tags with Enter, and remove selected tag chips independently.
  - `POST /api/assets/upload` now submits each image's own `tags` form field during archive.
  - Backend upload smoke check confirmed multipart `tags` are returned on upload and appear in `GET /api/assets/tags?category=expression`; the smoke asset was deleted afterward.
  - `node --test frontend/lib/expression-workflow.test.ts` passed 27 tests.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Expression workflow Step 6/7/8 review flow redesign completed:
  - Step 6 final result cards now require per-image routing: `直接归档` moves an image into `workflowState.confirmedImages`, and `需要精修` moves it into `workflowState.toRefineImages`; routed images disappear from the Step 6 pending list.
  - Step 6 `下一步` is disabled until every generated final image has been routed. If no image needs refinement, the next step skips directly to Step 8; otherwise it enters Step 7.
  - Step 7 now uses `workflowState.toRefineImages` as the refinement queue, shows a 2-column grid with 200px+ images and collapsible action descriptions, and adds confirmed refinement results back into `workflowState.confirmedImages`.
  - Step 8 now reviews only `workflowState.confirmedImages`, with reference素材 on the left and a 2-column confirmed-image grid on the right. Each image can be sent back with `退回精修`, which moves it into `toRefineImages` and returns to Step 7.
  - Added workflow helper tests for moving Step 6 images into confirmed/refine buckets and returning review images to refinement.
  - `node --test frontend/lib/expression-workflow.test.ts` passed 29 tests.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Completed workflow re-entry for archive supplementation completed:
  - `frontend/app/workflows/page.tsx` completed-session rows now include `查看/补充归档`, linking to `/workflows/expression?session_id=...&step=9`.
  - `frontend/app/workflows/expression/page.tsx` now honors a valid `step=N` URL parameter after session restore, so completed tasks can reopen directly at Step 9.
  - Step 9 no longer blocks all completed sessions behind the completion screen when confirmed images are still present; it shows the archive UI with a completed-task notice so remaining confirmed images can be archived.
  - Successful Step 9 archive now clears `confirmedImages` / legacy `confirmedFinalImageIds` before saving the completed state to avoid repeated uploads.
  - `node --test frontend/lib/expression-workflow.test.ts` passed 31 tests.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/workflows` and `GET http://localhost:3010/workflows/expression?session_id=1&step=9` both returned HTTP 200.
- Expression workflow Step 8 multi-image review and Step 9 task stats completed:
  - Generated final/consistency images now receive workflow-local unique ids via `assignWorkflowImageIds`, preventing repeated provider `image_id` values from collapsing multiple confirmed images into one Step 8 card.
  - Step 6 direct archive and Step 7 confirm archive continue to append to the full `workflowState.confirmedImages` queue, and Step 8 renders that full queue.
  - Step 9 now shows five task summary cards: action instruction count, draft count, final generated count, refined image count, and archived image count.
  - Workflow state now tracks `finalGeneratedCount`, `refinedImageCount`, and `archivedImageCount`; archive success increments the archived count in real time.
  - `node --test frontend/lib/expression-workflow.test.ts` passed 33 tests.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build frontend` rebuilt/restarted containers, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Pucoding image edit multipart field compatibility completed:
  - `backend/app/services/ai_gateway.py` now chooses the image multipart field name from `base_url`: `pucoding` uses `image`, while apiyi/default relays keep `image[]`.
  - `_call_image_edit` passes the selected field name into multipart file construction, so existing apiyi behavior remains unchanged.
  - Added backend tests for `get_image_field_name` and a pucoding `gpt-image-2` image edit call.
  - Verification at that point: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 56 tests. Newer backend verification is 59 tests after the Gemini Markdown parsing and draft collage routing fixes.
  - `docker-compose up -d --build backend` rebuilt/restarted the backend container, and `GET http://localhost:8000/docs` returned HTTP 200.
- Gemini relay Markdown image parsing completed:
  - `backend/app/services/ai_gateway.py` now extracts base64 images embedded in Markdown syntax such as `![image](data:image/jpeg;base64,...)` from OpenAI-compatible chat relay responses.
  - Chat relay parsing now checks `multi_mod_content` first, then `images`, then string `content`, so apiyi Gemini responses that inline images as Markdown are saved to local `/static/...` storage instead of being treated as empty text.
  - Added backend tests for the Markdown extractor and full OpenAI-compatible chat completion parsing path.
  - Verification at that point: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 58 tests. Newer backend verification is 59 tests after the draft collage routing fix.
  - `docker-compose up -d --build backend` rebuilt/restarted the backend container, and `GET http://localhost:8000/docs` returned HTTP 200.
- Draft collage relay call stabilization completed:
  - `backend/app/schemas/generate.py` now preserves the frontend `mode` field on `/api/generate/image` requests.
  - `backend/app/services/ai_gateway.py` now treats OpenAI-compatible relay requests with `mode == "draft"` and `count > 1` as a single provider call, relying on the prompt to request an N-grid draft collage.
  - If that single draft call returns multiple base64 images or URLs, all parsed images are saved/returned; if it returns one collage image, that one image is saved/returned.
  - Non-draft relay generation still loops per requested `count`, preserving final/consistency generation behavior.
  - Added backend regression coverage for draft relay `count > 1` making exactly one provider call while accepting multiple returned images.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 59 tests.
- Expression workflow category selection completed:
  - `frontend/lib/constants.ts` adds asset categories `game_content` / `游戏内容`, `holiday` / `节日形象`, and `hot_topic` / `热点运营`.
  - Step 1 now has a clickable category dropdown backed by `ASSET_CATEGORIES`, limited to `表情`, `动作`, `游戏内容`, and `节日形象`, defaulting to `表情`.
  - The selected category is stored in `workflowState.category`, drives Step 3's default reference asset category/tag loading, and is submitted as the Step 9 archive category.
  - Added frontend regression tests for the new categories, allowed Step 1 category filter, and category fallback behavior.
  - `node --test frontend/lib/expression-workflow.test.ts` passed 39 tests.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Asset library batch migration completed:
  - `backend/app/routers/assets.py` exposes `PATCH /api/assets/batch-move`, accepting `asset_ids` and `target_category`, updating selected `assets.category`, migrating same-name tag relations into the target category, and returning `moved_count`.
  - Batch migration creates missing target-category `asset_tags` rows as needed, rewrites `asset_tag_relations` to those target-category tags, preserves `assets.tags` names, and keeps old category tags in place for other assets.
  - `frontend/app/assets/page.tsx` adds a `批量迁移` mode with per-card checkboxes, selected count, current-filter select-all, target category dropdown, confirm, and cancel controls.
  - Migration uses the currently loaded/filtered asset list for `按当前标签全选`.
  - Added backend route coverage for batch migration, including tag-relation migration, and frontend helper coverage for migration selection/select-all behavior.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 64 tests.
  - `node --test frontend/lib/asset-grid.test.ts frontend/lib/asset-categories.test.ts frontend/lib/expression-workflow.test.ts` passed 45 tests.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers; `GET http://localhost:3010/assets` and `GET http://localhost:8000/docs` returned HTTP 200.
- Universal asset tag relation repair completed:
  - Running Postgres was repaired across all asset categories by reading each asset's comma-separated `assets.tags`, creating missing same-name `asset_tags` under that asset's actual `category`, and inserting missing `asset_tag_relations`.
  - Verification confirmed no remaining asset/tag category mismatches in `asset_tag_relations`.
  - `game_content` now has its category-scoped tag rows, including `看牌紧张`, so game-content images can display/filter their tags normally.
  - Upload and existing-tag-edit code paths were rechecked: `POST /api/assets/upload` uses the submitted asset category, and `PATCH /api/assets/{id}/tags` uses the asset's current category when creating/linking tags.
  - Backend regression tests now cover upload and tag edit under `game_content`; `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 64 tests.
  - `docker-compose up -d --build backend` rebuilt/restarted the backend container; `GET http://localhost:8000/docs` returned HTTP 200, and authenticated `GET /api/assets/tags?category=game_content` returned `["看牌紧张"]`.
- Asset category count display completed:
  - `backend/app/routers/assets.py` exposes `GET /api/assets/stats`, returning `{ total, by_category }` counts grouped by asset category.
  - `frontend/app/assets/page.tsx` loads `/api/assets/stats` and shows counts on category filter buttons, e.g. `全部 (168)`, with smaller/lighter count text and existing selected-category highlighting.
  - Counts refresh after upload, delete, and batch migration operations.
  - Added backend route/response tests and frontend label-helper coverage.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 65 tests.
  - `node --test frontend/lib/asset-grid.test.ts frontend/lib/asset-categories.test.ts frontend/lib/expression-workflow.test.ts` passed 46 tests.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers; `GET http://localhost:3010/assets` and `GET http://localhost:8000/docs` returned HTTP 200, and authenticated `GET /api/assets/stats` returned total/category counts.
- Expression workflow Step 7 review controls expanded:
  - Step 7 now supports per-image and batch `精修`, `直接通过`, `跳过`, and `删除` actions.
  - Step 7 has a `全选` checkbox plus selected-count batch controls.
  - `直接通过` appends the image to `confirmedImages` without replacing existing confirmed images.
  - `跳过` and `删除` only remove the image from `toRefineImages`; they no longer promote it into `confirmedImages`.
  - Step 7 `下一步` no longer blocks on unfinished refine items; it can advance to Step 8 while leftover `toRefineImages` remain.
  - Step 8 continues to render only `confirmedImages`, so existing confirmed images are preserved.
  - Added backend-free frontend regression coverage for the new direct-pass / skip semantics and batch-selection flow; `node --test frontend/lib/asset-grid.test.ts frontend/lib/asset-categories.test.ts frontend/lib/expression-workflow.test.ts` passed 48 tests.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Expression workflow generated-state autosave strengthened:
  - `frontend/app/workflows/expression/page.tsx` now queues silent autosaves after Step 5 draft generation, each Step 6 final image, each Step 7 consistency image, Step 6/7 routing actions, Step 8 return-to-refine, and every successful Step 9 archive upload.
  - Autosaves use the complete `workflowState` snapshot via `stateOverride`, including generated image URLs and review/archive queues, instead of waiting for a step change.
  - Silent autosave failures no longer interrupt the workflow; they are recorded in the browser console.
  - The autosave queue serializes writes and reuses the latest session id to reduce stale-state/session duplication risk during rapid image actions.
  - Step 9 now persists progress after each archived image by incrementing `archivedImageCount` and removing that image from the pending `confirmedImages` queue before continuing.
  - `npm run build` in `frontend/` completed successfully and generated 22 routes.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container.
- `http://localhost:8000/docs` returns HTTP 200.
- Activity workflow PRD refactor and runtime verification completed:
  - `backend/migrations/init.sql` now includes idempotent activity template extensions for `usage_scenario`, `bg_description`, `forbidden_rules`, `rule_character`, `rule_scene`, `rule_visual`, `rule_copy`, `rule_button`, `rule_quality`, and `rule_forbidden`, plus `activity_field_definitions`.
  - Running Docker Postgres was manually migrated with the same `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS activity_field_definitions` SQL; the latest run returned `ALTER TABLE` and `CREATE TABLE` with existing-column/table notices.
  - Backend activity template APIs now return template `fields`, create/update template field definitions, expose `POST /api/activity/templates/{id}/fields/reset-defaults`, and build structured prompts from template rules plus user-filled `{field_key: value}` dictionaries.
  - `/admin/activity-templates` was rewritten as a light-theme business template configurator with template tabs/list and a fixed inline editor above the table. The editor has four collapsible sections: basic info, visual structure, activity fields, and output rules.
  - `/workflows/activity` was rewritten as a light-theme 4-step operator workflow: `选模板`, `填写内容`, `生成图片`, and `质检归档`. It renders form controls dynamically from `template.fields`, creates a task before generation, sends `variables_json` as `{field_key: value}`, and combines QC plus archive in the final step.
  - Frontend helper coverage was added for admin payload/key normalization and operator dynamic-field defaults, validation, `variables_json`, and prompt preview.
  - `node --test frontend/lib/activity-production-workflow.test.ts frontend/lib/activity-workflow-theme.test.ts frontend/lib/activity-template-admin.test.ts frontend/lib/sidebar-nav.test.ts` passed 13 tests.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 70 tests.
  - `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers. The frontend Docker build generated 24 app routes, including `/workflows/activity` and `/admin/activity-templates`.
  - Smoke checks returned HTTP 200 for `/workflows/activity`, `/admin/activity-templates`, `/docs`, authenticated `/api/activity/template-types`, and authenticated `/api/activity/templates`.
- Activity workflow operator page was tightened to the final Task 4 state contract:
  - `frontend/app/workflows/activity/page.tsx` now stores the selected template directly in `WorkflowState.selectedTemplate`, uses `activeTypeId: number | null` where `null` means 全部, and keeps `fieldValues` as `Record<string, string>`.
  - Step navigation now only allows returning to the current or completed steps; users cannot jump forward through the step rail.
  - Step 1 preserves the selected model while resetting all other workflow state when a template card is selected.
  - Step 2 validates required fields with field-name-specific errors, renders switch fields as checkbox toggles, and keeps the collapsed instruction preview as a reference-only view.
  - Step 3 creates an activity task when needed, calls `/api/activity/jobs/create`, supports the backend's wrapped `{job, generation}` response, displays cost/token usage, and provides click-to-fullscreen image preview.
  - Step 4's `废图重出` transition clears job/image/prompt/QC state and returns to Step 3; `确认归档` submits QC and archives only after all three checks are selected.
  - `frontend/lib/activity-production-workflow.ts` now exposes string-only field default initialization, required-field validation, `variables_json` normalization, prompt preview construction, and a pure reject-regeneration transition helper.
  - `node --test frontend/lib/activity-template-admin.test.ts frontend/lib/activity-production-workflow.test.ts` passed 8 tests.
  - `npm run build` in `frontend/` completed successfully and generated 24 app routes.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/workflows/activity` returned HTTP 200.
- Activity workflow production enhancements completed:
  - `activity_templates.style_guide` was added to `backend/migrations/init.sql`, SQLAlchemy, Pydantic create/update/response schemas, admin payloads, and the running Docker Postgres database.
  - Activity structured prompt generation now inserts `[STYLE GUIDE]` after `[CHARACTER]`, and uses the selected task size in `[OUTPUT]` instead of a hardcoded size.
  - Activity generation jobs now accept `reference_asset_ids`, resolve selected assets to URLs in selected order, cap activity-side references at 4, and pass them through to `ai_gateway.generate_image`.
  - `backend/app/services/ai_gateway.py` caps reference image downloads at 4 and keeps per-image compression before base64 encoding.
  - `/admin/activity-templates` now exposes a business-language `风格标准` field in Section 4 and persists it through create/update.
  - `/workflows/activity` Step 3 now supports production-time size selection and optional reference image selection from the asset library, capped at 4 selected images. It creates tasks with the selected size and sends selected reference asset IDs to `/api/activity/jobs/create`.
  - Frontend helper coverage was expanded for `style_guide` payloads, prompt previews with style guide and selected output size, and capped reference image selection.
  - `node --test frontend/lib/activity-template-admin.test.ts frontend/lib/activity-production-workflow.test.ts` passed 9 tests.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 71 tests.
  - `cd frontend && npm run build` completed successfully and generated 24 app routes.
  - Docker Postgres manual migration returned `ALTER TABLE` with an existing-column notice; `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers.
  - Smoke checks returned HTTP 200 for `/workflows/activity`, `/admin/activity-templates`, `/docs`, authenticated `/api/activity/template-types`, authenticated `/api/activity/templates`, and authenticated `/api/assets`.
- Activity workflow ad-size and typed reference selectors completed:
  - `frontend/lib/constants.ts` now exports `ACTIVITY_AD_SIZES` for `1080x1080` FB square and `1080x1920` TikTok vertical placements.
  - Asset categories now use `props` for 道具 alongside `background`; related TypeScript category coverage was updated.
  - `/admin/activity-templates` now places `风格标准` in Section 1 directly after `推荐使用场景`, with helper copy explaining it is automatically added to the generation prompt.
  - `/workflows/activity` now stores production placement as `adSize` and typed reference slots as `referenceImages.character/background/props`.
  - Activity Step 2 now contains placement-size selection plus three single-select reference panels: character references with category tabs, background references fixed to `background`, and prop references fixed to `props`.
  - Activity generation now creates tasks with the selected `adSize`, sends `ad_size`, and sends non-empty reference asset IDs in character/background/props order.
  - Backend `ActivityGenerationJobCreate` accepts `ad_size`, and activity prompt output now formats sizes as `1080 x 1080` / `1080 x 1920`.
  - `node --test frontend/lib/asset-categories.test.ts frontend/lib/activity-production-workflow.test.ts frontend/lib/activity-template-admin.test.ts frontend/lib/expression-workflow.test.ts` passed 53 tests.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 71 tests.
  - `cd frontend && npm run build` completed successfully and generated 24 app routes.
  - `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers; smoke checks returned HTTP 200 for `/workflows/activity`, `/admin/activity-templates`, `/docs`, authenticated activity template APIs, and authenticated `/api/assets?category=props`.
- Task 6 verification completed:
  - Running Docker Postgres migration command returned `ALTER TABLE` with notice that `activity_templates.style_guide` already exists.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 71 tests` and `OK`.
  - `cd frontend && npm run build 2>&1 | tail -5` completed successfully. A follow-up build output check confirmed `Generating static pages (24/24)`.
  - `docker-compose up -d --build backend frontend` rebuilt/restarted both application containers.
  - Smoke checks returned HTTP 200 for `http://localhost:3010/workflows/activity`, `http://localhost:3010/admin/activity-templates`, and `http://localhost:8000/docs`.
- Activity workflow Step 2 reference-image selector was restructured into three independent 3-column rows:
  - `frontend/app/workflows/activity/page.tsx` now uses an inline `RefImageSelector` component for `character`, `background`, and `props`, with left-side category/tag filters, middle 3-column asset grids, and right-side selected-image previews.
  - The character selector can switch across `ASSET_CATEGORIES`; background and props stay pinned to `background` / `props` while still loading category-specific tags.
  - Step 2 now uses the real asset API contract for filtering: `/api/assets/tags?category=...` for tags and `/api/assets?category=...&limit=30&tags=...` for asset filtering.
  - `frontend/lib/activity-production-workflow.ts` now exposes pure helpers for activity reference asset query-path building and mixed payload tag-name normalization.
  - `node --test frontend/lib/activity-production-workflow.test.ts` passed 9 tests after adding coverage for the new Step 2 query/tag helpers.
  - `cd frontend && npm run build 2>&1 | tail -5` completed successfully; the Docker frontend build confirmed 25 app routes including `/workflows/activity` and `/gallery/tags`.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container, and `GET http://localhost:3010/workflows/activity` returned HTTP 200.
- Activity workflow Step 2 reference selector received three UX refinements:
  - `frontend/app/workflows/activity/page.tsx` now paginates each selector's asset grid at 9 images per page, with `上一页/下一页` controls below the middle column and automatic page reset when category or tag changes.
  - The character selector's left rail is now a tree-style directory list that expands the active category's tags inline; background and props keep the same single-column layout but now render tag-only lists in the same visual language.
  - The Step 2 prompt-preview `<pre>` now uses a fixed `max-h-48` scrollable container so long generated instructions no longer stretch the page vertically.
  - `cd frontend && npm run build 2>&1 | tail -5` completed successfully after the selector refinements.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; the Docker build still generated 25 app routes.
  - `GET http://localhost:3010/workflows/activity` returned HTTP 200 after the pagination/tree/preview updates.
- Activity batch backend foundation completed:
  - `backend/migrations/init.sql` now creates `activity_generation_batches` and `activity_batch_images` for multi-image activity production batches, draft/review/completed lifecycle state, per-image extra prompts, refine prompts, parent image lineage, costs, token usage, and sort order.
  - `backend/app/models/activity_batch.py` adds `ActivityGenerationBatch` and `ActivityBatchImage` ORM models, and `backend/app/services/_model_imports.py` imports them so metadata scanning includes both tables.
  - `backend/app/schemas/activity_batch.py` adds create/response/refine/archive request schemas for batch and per-image operations.
  - `backend/app/routers/activity_batches.py` adds `/api/activity/batches` endpoints for create, list, detail, drafts, refine, archive-image, delete-image, and save-draft; `backend/app/main.py` registers the router at `/api/activity/batches`.
  - Batch create reuses activity prompt construction, adds global and per-image auxiliary prompts, calls `ai_gateway.generate_image` once per requested image, stores linked `activity_generation_jobs`, and returns the full batch with images.
  - Batch archive writes `final_images` with `source_type=activity`, activity template sub-category/style tag metadata, and gallery tag upsert behavior aligned with the existing single-job archive flow.
  - Backend tests were expanded for route registration, app route exposure, ORM table metadata, migration SQL coverage, and activity batch schemas.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 77 tests` and `OK`.
  - Running Docker Postgres migration command returned `CREATE TABLE` for both new batch tables.
  - `docker-compose up -d --build backend` rebuilt/restarted the backend container; `GET http://localhost:8000/docs` returned HTTP 200 and authenticated `GET http://localhost:8000/api/activity/batches/drafts` returned HTTP 200.
- Activity workflow Step 3 and Step 4 now use multi-image batches:
  - `frontend/app/workflows/activity/page.tsx` replaced the old single-job generation state with batch state: `batchId`, `batchImages`, `batchStatus`, `globalExtraPrompt`, and per-image `imageConfigs`.
  - Step 3 now lets operators choose 1-4 images, enter a global auxiliary prompt, optionally enter per-image auxiliary prompts, and call `POST /api/activity/batches/create` after creating the activity task if needed.
  - Step 4 now shows batch-level QC plus a per-image grid where each image can be archived, refined into a new batch image, deleted, or left for later draft saving.
  - Step 1 now loads `/api/activity/batches/drafts` and shows a draft-resume banner when unfinished activity batches exist.
  - `frontend/lib/activity-production-workflow.ts` now normalizes batch image response fields from backend snake_case into frontend camelCase, with regression coverage in `frontend/lib/activity-production-workflow.test.ts`.
  - `node --test frontend/lib/activity-production-workflow.test.ts` passed 10 tests.
  - `cd frontend && npm run build 2>&1 | tail -5` completed successfully; a follow-up filtered build output check confirmed `Generating static pages (25/25)` with `/workflows/activity` and `/gallery/tags` present.
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/workflows/activity` returned HTTP 200.
- Activity template editor save controls were moved to Section 4:
  - `frontend/app/admin/activity-templates/page.tsx` no longer shows the save/cancel button group in the editor header.
  - Section 4 now ends with a right-aligned bottom action bar that contains `取消` and `保存`.
  - `取消` now asks for confirmation before discarding unsaved edits.
  - `frontend/lib/activity-template-admin.test.ts` adds a source-level regression check for the new Section 4 action bar and cancel confirmation text.
  - `node --test frontend/lib/activity-template-admin.test.ts` passed 4 tests.
  - `cd frontend && npm run build 2>&1 | tail -5` completed successfully; `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/admin/activity-templates` returned HTTP 200.
- Activity batch workflow-session integration is implemented:
  - `backend/migrations/init.sql` and running Docker Postgres now add `activity_generation_batches.session_id` referencing `workflow_sessions(id)`.
  - `backend/app/models/activity_batch.py` maps `ActivityGenerationBatch.session_id`.
  - `backend/app/routers/activity_batches.py` now creates a `workflow_sessions` row with `workflow_type='activity'`, `mode='full'`, `status='draft'`, and `state_json={"batch_id": ...}` after batch generation succeeds, then stores the session id back on the batch.
  - Saving an activity batch draft updates the linked workflow session to `draft` / Step 4; completing a batch through archive/delete updates the linked workflow session to `completed` / Step 4.
  - `frontend/app/workflows/page.tsx` now lists both expression and activity workflow sessions, displays activity sessions with a blue type badge, and routes activity sessions to `/workflows/activity?session_id=...`.
  - `frontend/app/workflows/activity/page.tsx` now reads `session_id`, loads `/api/workflow-sessions/{id}`, extracts `batch_id`, loads the batch detail, and resumes directly at Step 4.
  - Regression coverage was added for ORM/migration/session-sync contracts and workflow-list/session-resume frontend behavior.
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests 2>&1 | tail -5` reported `Ran 78 tests` and `OK`.
  - `cd frontend && npm run build 2>&1 | tail -5` completed successfully, and the Docker frontend build confirmed `Generating static pages (25/25)`.
  - `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers; authenticated `GET /api/activity/batches/drafts` and `GET http://localhost:3010/workflows` returned HTTP 200.
- Activity batch refine now has a client-side loading lock:
  - `frontend/app/workflows/activity/page.tsx` adds `refiningLoading` to prevent duplicate refine submissions.
  - While refine is in flight, `重新生成` changes to `生成中…`, the button is disabled, and `取消` is also disabled to prevent interrupting the in-flight request.
  - After refine generation completes or fails, `refiningLoading` resets and the controls become clickable again.
  - Regression coverage in `frontend/lib/workflow-sessions-page.test.ts` now checks the loading guard and disabled states.
  - `node --test frontend/lib/workflow-sessions-page.test.ts` passed 3 tests.
  - `cd frontend && npm run build 2>&1 | tail -5` completed successfully; `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/workflows/activity` returned HTTP 200.
- Current system status after the latest activity workflow updates:
  - Backend test discovery currently reports `Ran 78 tests` and `OK`.
  - Frontend production build currently generates 25 app routes.
  - Activity image production is now a complete loop: template configuration -> multi-image batch generation -> QC/archive -> final gallery.
  - The workflow task list supports both `表情制作` and `活动图生产` workflow types.
- Background workflow model availability regression is verified:
  - `node --test frontend/lib/background-workflow.test.ts` passed 5 tests, including the guard that forbids client-side `usage_type` filtering in `/workflows/background`
  - `cd frontend && npm run build` completed successfully and generated 26 app routes
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container
  - `GET http://localhost:3010/workflows/background` returned HTTP 200 after the rebuild
- Background game-feel prompt wording is now atmosphere-first instead of prop-first:
  - `backend/app/services/background_prompt.py` now maps `game_feel` through explicit `strong` / `medium` / `weak` atmosphere descriptions, so `medium` emphasizes slight magical lighting and tone instead of concrete gameplay props
  - the old composition hint encouraging `mascot, coins, reward boxes, UI buttons` was removed
  - `Restrictions` now adds `No game props, coins, treasure boxes, or UI elements in the scene.` to stop the model from inventing itemized game props in the background
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest backend.tests.test_background_prompt` passed 4 tests after adding regression coverage for the new game-feel copy
  - `docker-compose up -d --build backend` rebuilt/restarted the backend container
  - `GET http://localhost:8000/docs` returned HTTP 200 after the rebuild
- Background workflow Step 2 display, count handoff, and refine-model filtering are completed:
  - Step 1 no longer shows `生成数量`; the create request now leaves `count` to the backend default instead of fixing it at batch-creation time
  - `backend/app/schemas/background.py` now treats `BackgroundBatchCreate.count` as optional with default 4, and `BackgroundBatchGenerateRequest.count` is now required with range `1-8`
  - `backend/app/routers/background.py` now writes `batch.count` from `POST /api/background/batches/{id}/generate`, so each new generation run can choose `1 / 2 / 4 / 6 / 8` without recreating the batch
  - Step 2 now places a `生成数量` selector beside the model selector and submits `count` together with `model_config_id`
  - Step 2 candidate cards are now split into `待筛选` (`pending`) and `已通过` (`approved` + `refine`) sections; rejected cards disappear from the pending list immediately, approved/refine cards move to the passed list, and passed cards can be `撤回` to `pending`
  - Step 2 now exposes a `下一步：精修标准化` button that unlocks only when at least one card remains in the passed section
  - Step 3 now loads `/api/background/available-models?mode=refine`, filters to `provider="openai"` plus `usage_type in ("final", "both")`, and shows the helper note `精修使用参考图模式，仅支持 gpt-image 系列模型`
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 99 tests
  - `node --test frontend/lib/background-workflow.test.ts` passed 6 tests
  - `cd frontend && npm run build` completed successfully and generated 26 app routes
  - `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers
  - Smoke evidence:
    - `GET http://localhost:3010/workflows/background` returned HTTP 200, and the Step 1 SSR HTML contained 0 matches for `生成数量`
    - source-level smoke checks confirmed `待筛选` / `已通过` / `撤回` rendering plus `count: regenerateImageId ? 1 : generationCount` in `frontend/app/workflows/background/page.tsx`
    - authenticated `GET http://localhost:8000/api/background/available-models?mode=refine` returned only `provider: "openai"` rows in the live container
- Background workflow candidate list now refreshes immediately after generate succeeds:
  - `frontend/app/workflows/background/page.tsx` now calls `await refreshBatch(batchId)` after `POST /api/background/batches/{id}/generate` succeeds, instead of trusting the mutation response payload alone
  - this refresh pulls the latest `background_images` list and updates local step-2 state without requiring a full page reload
  - `frontend/lib/background-workflow.test.ts` now includes a regression check that the generate success branch re-fetches batch details before re-entering Step 2
  - `node --test frontend/lib/background-workflow.test.ts` passed 7 tests
  - `cd frontend && npm run build` completed successfully and still generated 26 app routes
  - `docker-compose up -d --build frontend` completed successfully and restarted the frontend container
- Background workflow Step 2 now locks generation controls for archived batches:
  - `frontend/app/workflows/background/page.tsx` derives `isArchivedBatch` from `batch.status === "archived"` and uses it to disable the Step 2 `开始生成` button and each pending-card `重生成` button
  - the top generate button now changes its label to `已入库` for archived batches
  - a muted helper line now appears below the Step 2 generate controls: `该批次已入库，如需重新生成请新建任务`
  - `frontend/lib/background-workflow.test.ts` now includes regression coverage for the archived-batch disabled state
  - `node --test frontend/lib/background-workflow.test.ts` passed 9 tests
  - `cd frontend && npm run build` completed successfully and still generated 26 app routes
- Background workflow completion state is now wired end-to-end:
  - `backend/app/routers/background.py` now stores `step` inside background `workflow_sessions.state_json`, and `POST /api/background/images/{id}/archive` now marks the linked session `completed` only after every `approved` / `refine` image in that batch has been archived
  - partial archive now keeps the batch/session in Step 4 draft instead of prematurely closing the workflow
  - `frontend/app/workflows/page.tsx` now renders background workflow progress as `已完成` for completed sessions and `第 N 步` from `state_json.step` for draft sessions
  - `frontend/app/workflows/background/page.tsx` Step 4 now shows a green completion panel with `所有背景图已入库，本次任务完成` and a `返回任务列表` button after all reviewed images are archived
  - `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 102 tests
  - `node --test frontend/lib/workflow-sessions-page.test.ts frontend/lib/background-workflow.test.ts` passed 14 tests
  - `cd frontend && npm run build` completed successfully and still generated 26 app routes
  - `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers successfully
  - live smoke used an inserted background session `75` / batch `7`: after archiving image `18`, `workflow_sessions.status` remained `draft`; after archiving image `19`, `SELECT status FROM workflow_sessions WHERE id = 75` returned `completed`, and authenticated `GET /api/workflow-sessions?status=completed&mode=full` returned the completed background session with `state_json.step = 4`
- Background workflow reference uploads now drive Step 2 model filtering:
  - `frontend/app/workflows/background/page.tsx` updates the Step 1 helper copy to explain that uploading reference images limits generation models to reference-image-capable `gpt-image` models and filters out unsupported options such as Gemini
  - Step 2 now switches its model source dynamically: with reference images it requests `/api/background/available-models?mode=refine`, otherwise it requests `/api/background/available-models`
  - when reference upload/removal changes the model list and the current model is no longer valid, the page auto-selects the first remaining model and shows `已选模型不支持参考图，已自动切换`
  - `node --test frontend/lib/background-workflow.test.ts` passed 11 tests
  - `cd frontend && npm run build` completed successfully and still generated 26 app routes
  - `docker-compose up -d --build frontend` rebuilt/restarted the frontend container successfully
  - live API smoke confirmed `GET /api/background/available-models?mode=refine` returned only `provider: "openai"` rows; combined with the new `referenceAssets.length > 0 -> mode=refine` front-end branch, Step 2 reference-driven model filtering is active in the rebuilt UI

Previous Docker E2E command set:

```bash
docker-compose up -d --build
curl --noproxy '*' -s -o /tmp/e2e-login.html -w '%{http_code}' http://localhost:3010/login
curl --noproxy '*' -s -o /tmp/e2e-docs.html -w '%{http_code}' http://localhost:8000/docs
curl --noproxy '*' -s -o /tmp/e2e-root.html -w '%{http_code} %{redirect_url}' http://localhost:3010/
```

Observed Docker E2E result:

- `db`, `redis`, `storage`, `backend`, and `frontend` containers are running.
- Postgres is healthy and `backend/migrations/init.sql` ran successfully on first database initialization.
- Backend startup logs show `DATABASE_HOST=db` and Uvicorn listening on `0.0.0.0:8000`.
- `http://localhost:8000/docs` returns HTTP 200.
- `http://localhost:3010/login` returns HTTP 200 and contains the login page HTML.
- `http://localhost:3010/` returns HTTP 307 redirecting to `http://localhost:3010/dashboard`.

Note: local ports `3000` and `3001` were already occupied by other local services (`open-webui` and `AnythingL`), so the local `.env` uses `FRONTEND_PORT=3010` for the E2E run.

## Next Recommended Work

- Add integration tests against a real test database.
- Add provider-specific contract tests for OpenAI/Google response parsing.
- Add an automated E2E smoke script for Docker startup and HTTP checks.
- `docs/HOTSPOT_NEWS_INTEGRATION.md` 新建，记录热点新闻对接设计（本地 JSON MVP + 线上升级路径），包含两个并行工作流方案（手动热点 `/workflows/trending` + 新闻推送 `/workflows/trending-news`）、完整 topic_type/risk_tags 枚举、Prompt 富字段使用规范、线上升级时需改动的文件清单。

## 标签双语（i18n）改造 — 后端完成

- `asset_tags` / `gallery_tags` ORM 增加 `name_en`、`name_zh` 字段
- 新增 `backend/app/schemas/asset_tag.py`；`gallery_tag.py` schema 同步更新
- `assets.py` 5 个标签接口、`gallery.py` 3 个标签接口携带双语字段（源码 grep 确认）
- 新增 `POST /api/translate/tags` 和 `POST /api/translate/tags/fill-all` 路由
- `main.py` 注册 translate router，`ensure_runtime_schema()` 追加 i18n migration SQL
- 数据库已迁移：asset_tags 回填 86 条 name_zh，gallery_tags 回填 3 条
- 全量测试：Ran 135 tests — OK
- 前端部分（tag-display.ts / TagCombobox / 标签管理页）待下一条指令完成

## 标签双语（i18n）改造 — 前端完成

- 新增 `frontend/lib/tag-display.ts`，统一双语标签显示与缺失翻译触发逻辑
- `frontend/components/common/TagCombobox.tsx` 已支持双字段创建表单：`name_en` 必填、`name_zh` 可选
- `frontend/app/assets/tags/page.tsx` 已改为素材标签双语管理表单与列表
- `frontend/app/gallery/tags/page.tsx` 已改为成品图标签双语管理表单与列表
- 前端构建验证通过：`npm run build`
- 当前前端路由数量确认：31 条

## 第一批页面双语接入完成

- `frontend/app/dashboard/page.tsx` 已接入 `useLanguage`，页面标题、统计卡片和图表占位文案全部改为 `t()`
- `frontend/app/login/page.tsx` 已接入 `useLanguage`，登录标题、表单文案、按钮与错误提示全部改为 `t()`
- `frontend/lib/i18n.ts` 已补齐第一批页面所需词条
- 验证：`cd frontend && npm run build` 通过，当前前端路由数量为 31 条
- 下一批：`assets` / `gallery` / `review` / `stats` / `prompts` / `instructions`

## 第二批页面双语接入完成

- `frontend/app/assets/page.tsx` 已接入 `useLanguage`，素材上传 / 迁移 / 删除 / 标签管理文案全部改为 `t()`
- `frontend/app/gallery/page.tsx` 已接入 `useLanguage`，成品图库筛选与空状态文案全部改为 `t()`
- `frontend/app/review/page.tsx` 已接入 `useLanguage`，审核操作与结果提示文案全部改为 `t()`
- `frontend/app/stats/page.tsx` 已接入 `useLanguage`，统计卡片、表格表头和图表占位文案全部改为 `t()`
- `frontend/app/prompts/page.tsx` 已接入 `useLanguage`，Prompt 模板管理文案全部改为 `t()`
- `frontend/app/instructions/page.tsx` 已接入 `useLanguage`，指令库与工作流切换文案全部改为 `t()`
- `frontend/lib/i18n.ts` 已补齐第二批页面所需词条
- 验证：`cd frontend && npm run build` 通过，当前前端路由数量为 33 条
- 下一批：`admin/*`
- `fill-all` 历史标签英文补全接口仍需部署后手动触发一次

## 语言切换接入完成

- 新增 `frontend/lib/i18n.ts`
- 新增 `frontend/lib/LanguageContext.tsx`
- 新增 `frontend/components/common/LanguageToggle.tsx`
- `frontend/components/layout/Topbar.tsx` 已接入右上角语言切换按钮
- `frontend/app/layout.tsx` 已用 `LanguageProvider` 包裹根布局
- `frontend/components/layout/AppShell.tsx` 已在非登录布局中接入 `Topbar`
- `frontend/components/layout/Sidebar.tsx` 已接入 `useLanguage`，导航文案跟随语言切换
- `frontend/lib/i18n.ts` 已补齐 `NAV_GROUPS` 缺失/不匹配词条，Sidebar 导航 key 全量命中
- `frontend/app/providers.tsx` 已加入 `'use client'` 边界，`layout.tsx` 改为通过 `Providers` 包装 `LanguageProvider`
- 前端构建验证通过：`npm run build`
- 当前前端路由数量确认：31 条

## 第三批页面双语接入完成

- `frontend/app/admin/users/page.tsx`、`api-keys/page.tsx`、`models/page.tsx`、`logs/page.tsx` 已接入 `useLanguage`
- `frontend/app/admin/activity-templates/page.tsx`、`daily-post-templates/page.tsx`、`hotspot-import/page.tsx`、`share-instructions/page.tsx` 已接入 `useLanguage`
- `frontend/lib/i18n.ts` 已补齐第三批后台页面所需词条，并清理重复 key
- 验证：`cd frontend && npm run build` 通过，当前前端路由数量为 32 条（含 `/_not-found`，`/admin/share-instructions` 为既有路由）
- 已执行 `docker-compose up -d --build frontend`，前端容器重建完成
- 下一批：`workflows/*`
- `fill-all` 历史标签英文补全接口仍需部署后手动触发一次

## 第四批页面双语接入完成（上半）

- `frontend/app/workflows/page.tsx`、`frontend/app/tasks/page.tsx`、`frontend/app/tasks/create/page.tsx`、`frontend/app/tasks/[id]/page.tsx` 已接入 `useLanguage`
- `frontend/app/workflows/expression/page.tsx`、`frontend/app/workflows/activity/page.tsx` 的固定 UI 文案已接入 `t()`，步骤标题、主要按钮、表单标签、空状态和关键错误提示均已覆盖
- `frontend/lib/i18n.ts` 已补齐第四批上半页面所需词条，当前这 6 个页面的 `t("...")` key 已全部命中字典
- 验证：`cd frontend && npm run build` 通过；普通页面路由 31 条，含 `/_not-found` 共 32 条
- 已执行 `docker-compose up -d --build frontend`，前端容器重建完成
- 下一批：`frontend/app/workflows/background/page.tsx`、`daily-post/page.tsx`、`share/page.tsx`、`trending/page.tsx`、`trending-news/page.tsx`
- `fill-all` 历史标签英文补全接口仍需部署后手动触发一次

## 第四批页面双语接入完成（下半）

- `frontend/app/workflows/background/page.tsx`、`daily-post/page.tsx`、`share/page.tsx`、`trending/page.tsx`、`trending-news/page.tsx` 已全部接入 `useLanguage`
- 第四批下半仅替换固定 UI 文案：步骤标题、按钮、状态标签、表单 label / placeholder、空状态与关键错误提示；动态 API 数据保持原样
- `frontend/lib/i18n.ts` 已补齐这 5 个工作流页面当前使用到的全部 `t("...")` key，校验结果为 `NO_MISSING_KEYS`
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有口径普通页面 31 条，含 `/_not-found` 共 32 条
- 已执行 `docker-compose up -d --build frontend`，前端容器重建完成
- 结果：31 个业务页面 + 导航 / Topbar / Sidebar / 标签双语已全部接入，整体前端双语改造完成
- 遗留：`POST /api/translate/tags/fill-all` 历史标签英文补全接口仍需部署后手动触发一次

## 共享组件与 assets 标签显示修复完成

- `frontend/components/workflow/WhitespacePositionPicker.tsx` 已接入 `useLanguage`，留白位置 chip 和示意图文字改为通过 `t()` 渲染
- `frontend/components/common/TagCombobox.tsx` 已接入 `useLanguage`，placeholder、创建 / 确认 / 取消、名称字段和已选标签显示均支持双语
- `frontend/app/assets/page.tsx` 标签筛选 / 上传 / 编辑的可选项已保留完整 tag 对象，显示统一走 `getTagLabel(tag, lang)`
- `frontend/lib/i18n.ts` 已补齐共享组件修复所需词条
- 验证：`cd frontend && npm run build` 通过；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成
- 路由口径保持不变：构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条

## assets 分类与尺寸按钮翻译修复完成

- `frontend/app/assets/page.tsx` 的分类文案 helper 已改为组件内通过 `t()` 返回，上传区分类标题、卡片分类摘要和迁移目标分类下拉框现在都会随语言切换
- 资产分类按钮继续使用 `t(item.label)`，`牛标准图`、`游戏内容`、`节日形象`、`热点运营` 等分类词条已在 `frontend/lib/i18n.ts` 补齐
- 尺寸切换按钮 `小 / 中 / 大` 已补齐字典词条，构建验证通过
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条
- 已执行 `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend`，前端容器重建完成

## expression 工作流步骤标题翻译修复完成

- `frontend/app/workflows/expression/page.tsx` 已移除模块级 `WORKFLOW_STEPS`，步骤导航改为使用组件内 `workflowSteps`，在生成步骤 label 时通过 `t(label)` 翻译
- `WorkflowStepHeader` 当前仍通过 `title={t(STEP_TITLES[currentStep - 1])}` 渲染，页面内步骤标题与步骤导航保持一致
- `frontend/lib/i18n.ts` 已补齐 `任务基础信息`、`提示词配置`、`参考素材选择`、`规格设置`、`草稿生成`、`精修成品` 六个 expression 步骤名词条
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条
- 已执行 `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend`，前端容器重建完成

## 工作流页面 Category / Tags 显示修复完成

- `frontend/app/workflows/expression/page.tsx` 的 3 处分类下拉选项已改为 `t(category.label)`；标签选择与归档标签显示已统一走 `getTagLabel(..., lang)`，并保留后端返回的 tag 对象以使用 `name_en / name_zh`
- `frontend/app/workflows/activity/page.tsx` 的参考图分类侧栏已改为 `t(category.label)`；参考标签列表改为保留 tag 对象并通过 `getTagLabel(..., lang)` 显示
- `frontend/app/workflows/daily-post/page.tsx`、`share/page.tsx` 的参考标签按钮已改为 `getTagLabel(tag, lang)`；`trending/page.tsx`、`trending-news/page.tsx`、`background/page.tsx` 的相关 tag 显示也已统一接入 `getTagLabel`
- `frontend/lib/i18n.ts` 已补齐转发工作流步骤词条：`选择转发类型`、`输入传播内容`、`图片语言`、`生成配置`、`生成图片 + 审核 QC`
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条
- 已执行 `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend`，前端容器重建完成

## expression Step 4 残留中文修复完成

- `frontend/app/workflows/expression/page.tsx` 的 Step 4 固定中文已补齐 `t()`：`尺寸`、`背景`、`白底PNG`、`透明背景`、`增加动作`、`第 N 张`、`当前有效动作 ... 个，将生成 ... 张草稿。`
- Step 5 规格摘要中的背景文案也已改为 `t("白底PNG") / t("透明背景")`，避免英文态下残留中文
- `上一步 / 下一步` 这页没有直接写死在 `expression/page.tsx`，当前由 `StepLayout` 负责渲染，因此本次无需改动
- `frontend/lib/i18n.ts` 已补入：`透明背景`、`增加动作`、`白底PNG`、`当前有效动作`、`个，将生成`、`张草稿。`
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条
- 已执行 `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend`，前端容器重建完成

## 工作流页面中文全量扫描与批量修复完成（第一轮）

- 已按指定范围扫描 11 个工作流 / 任务页面，集中定位未走 `t()` 的硬编码中文
- 本轮已批量修复的重点包括：
  - `frontend/app/workflows/page.tsx` 的状态标签、模式标签、工作流名称、进度文案、复制默认标题
  - `frontend/app/workflows/activity/page.tsx` 的错误提示、任务创建标题、模板选择状态、图片 alt、参考图分类 / 标签显示
  - `frontend/app/workflows/background/page.tsx` 的错误提示、模型切换提醒、TagCombobox 标签文案
  - `frontend/app/workflows/share/page.tsx` 的占位符、参考图分类显示、步骤底部导航文字
  - `frontend/app/workflows/trending/page.tsx` 与 `trending-news/page.tsx` 的参考图区固定文案与动作匹配提示
  - 之前已修复的 `expression / activity / background / daily-post / share / trending / trending-news` 分类 / 标签 / 步骤标题链路继续保持有效
- `frontend/lib/i18n.ts` 本轮新增了一批工作流词条，用于支撑工作流列表、参考图区、活动图 / 背景图 / 转发图页的新增 `t()` 调用
- 验证：`cd frontend && npm run build` 通过；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成
- 说明：按 `grep '[^\\x00-\\x7F]'` 统计的非 ASCII 行数仍然较高，因为该指标会把步骤常量、业务标签、热点分类、动作映射、提示词 key 等一并计入，不等同于“仍有多少未走 t() 的可见中文”

## 多页面残留固定中文批量修复完成

- 修复了 `activity` 模板分类按钮英文态仍显示中文的问题；分类名称现通过 `t(type.name)` 渲染
- 修复了 `daily-post` 参考图区残留固定文案：`+ 自定义`、`全部`、`暂无参考图`、`无预览`、`× 移除`
- `assets/tags` 与 `gallery/tags` 两页现已正式接入 `useLanguage`，页面标题、表头、按钮、placeholder、确认文案都可随语言切换
- `admin/activity-templates` 的模板类型下拉 / 分类 tab / 类型列已统一走 `t()`；`admin/share-instructions`、`gallery`、`share`、`trending`、`trending-news` 本轮主要通过补齐 `i18n.ts` 缺失 key 修复显示
- `frontend/lib/i18n.ts` 本轮补入标签管理、活动模板分类、转发类型、热点分类、成品图库目录等缺失词条，并清理了重复 key
- 验证：`cd frontend && npm run build` 通过；构建路由表共 33 条，包含 `/` 与 `/_not-found`，按当前项目口径 app 页面数仍为 32
- 已执行 `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend`，前端容器重建完成

## 素材卡片与成品图库标签英文显示修复完成

- `frontend/app/assets/page.tsx` 的素材卡片 tag chip 现会基于当前已加载的 tag option 对象查找 `name_en / name_zh`，并通过 `getTagLabel(..., lang)` 显示；查不到时回退原始 tag name
- `frontend/app/gallery/page.tsx` 的 style tag 筛选区不再只使用 `string[]`；页面内已保留轻量 tag 对象并通过 `getTagLabel(tag, lang)` 显示英文
- “当前风格标签”摘要也已同步显示双语标签名
- 验证：`cd frontend && npm run build` 通过；构建路由表共 33 条，包含 `/` 与 `/_not-found`，按当前项目口径 app 页面数仍为 32
- 已执行 `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend`，前端容器重建完成

## Activity 模板双语字段接入完成

- 后端已为 `activity_templates` 增加 `name_en`、`scenario_en` 两列，并在 `ensure_runtime_schema()` 中追加 runtime schema SQL
- `backend/app/models/activity_template.py`、`backend/app/schemas/activity_template.py`、`backend/app/routers/activity_workflows.py` 已接入双语字段；创建/更新接口会拒绝空 `name_en`
- `frontend/app/admin/activity-templates/page.tsx` 已新增 `name_en` 必填和 `scenario_en` 可选字段；英文模式下列表标题优先显示 `name_en`
- `frontend/app/workflows/activity/page.tsx` 模板卡片、已选模板、当前模板、usage scenario 英文模式下已优先显示 `name_en / scenario_en`
- 验证：
  - 数据库列确认：`name_en | character varying(255)`，`scenario_en | text`
  - 后端测试：`Ran 135 tests ... OK`
  - 前端构建：`cd frontend && npm run build` 通过；构建路由表共 33 条，包含 `/` 与 `/_not-found`，按当前项目口径 app 页面数仍为 32
  - 已执行 `docker-compose up -d --build backend` 与 `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend`

## 素材卡片「已选」badge 复核完成

- `frontend/app/assets/page.tsx` 中「已选」badge 已经是 `{t("已选")}`，本次无需额外业务代码修改
- `frontend/lib/i18n.ts` 已存在词条：`已选 -> Selected`
- 验证：`cd frontend && npm run build` 通过；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成

## 中英文双语改造 — 完整收口（2026-05-06）

### 基础设施
- `frontend/lib/i18n.ts`：翻译字典，覆盖导航、按钮、状态、表单等 UI 固定文字
- `frontend/lib/LanguageContext.tsx`：全局语言状态 Context，含 `localStorage` 持久化
- `frontend/components/common/LanguageToggle.tsx`：右上角切换按钮
- `frontend/app/providers.tsx`：客户端边界包装，解决 Next.js SSR hydration 问题
- `frontend/components/layout/Topbar.tsx`：接入语言切换按钮
- `frontend/components/layout/Sidebar.tsx`：导航文字全部走 `t()`
- `frontend/components/layout/AppShell.tsx`：接入 Topbar

### 标签双语系统
- `asset_tags` / `gallery_tags` 加 `name_en` / `name_zh` 字段，前端统一通过 `getTagLabel()` 解析显示
- `backend/app/routers/translate.py`：AI 批量翻译接口，复用项目现有 OpenAI key
- `frontend/lib/tag-display.ts`：`getTagLabel()` 解析函数 + 标签辅助逻辑
- `frontend/components/common/TagCombobox.tsx`：双字段创建表单
- 历史标签已补全：`asset_tags` 86 条、`gallery_tags` 7 条

### Activity 模板双语
- `activity_templates` 加 `name_en` / `scenario_en` 字段
- 7 个现有模板已补填英文名和场景描述
- 管理页和工作流卡片英文模式下优先显示英文内容

### 页面全量接入
- 第一批：`dashboard`、`login`
- 第二批：`assets`、`gallery`、`review`、`stats`、`prompts`、`instructions`
- 第三批：`admin/*`
- 第四批：所有工作流页面（`expression`、`activity`、`background`、`daily-post`、`share`、`trending`、`trending-news`）
- 共享组件：`StepLayout`、`TagCombobox`、`WhitespacePositionPicker` 等

### 验证基线
- 全量后端测试：`Ran 135 tests — OK`
- 前端构建：通过；构建表显示 33 条路由（包含 `/` 与 `/_not-found`），按当前项目口径 app 页面数为 32
- `i18n.ts`：本轮接入页面所需 key 已补齐，构建通过
- 所有 UI 固定文字已完成双语接入；源码中仍可能保留中文业务常量、词典 key、动态内容示例，不等于界面残留中文
