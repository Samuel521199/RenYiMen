# Handoff

## What Was Just Completed

Latest update:

- `frontend/components/workflow/StepLayout.tsx` now uses `useLanguage` for its shared navigation copy.
- Fixed both shared hardcoded labels:
  - back button: `上一步` -> `t("上一步")`
  - default next label: from hardcoded `"下一步"` to `nextLabel ?? t("下一步")`
- Verification:
  - `cd frontend && npm run build` passed
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully

- Added the missing `frontend/app/workflows/page.tsx` dictionary keys into `frontend/lib/i18n.ts`.
- This includes the explicitly reported keys (`草稿`, `工作流任务`, `任务名`, `进度`, and the workflow-management description) plus the other missing `t()` keys used on the page such as copy/list action text and loading/error text.
- Verification:
  - `grep` confirmed the new keys exist in `frontend/lib/i18n.ts`
  - `cd frontend && npm run build` passed
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` completed successfully

- Completed another targeted workflow/task i18n cleanup pass.
- Updated:
  - `frontend/app/workflows/expression/page.tsx`
  - `frontend/app/workflows/activity/page.tsx`
  - `frontend/app/workflows/daily-post/page.tsx`
  - `frontend/lib/i18n.ts`
- This pass fixed more remaining fixed UI Chinese in expression Step 3-7 summaries, action maps, confirmation dialogs, generation labels, and user-facing status/error text.
- Activity workflow now translates the remaining fixed select/switch/validation copy and intro text.
- Daily-post removed the last hardcoded Chinese fallback asset label.
- Verification:
  - `cd frontend && npm run build` passed
  - Docker frontend rebuild passed
  - latest Next.js build route table shows 33 app routes total (`/`, `/_not-found`, plus 31 page routes)
- Suggested next step if more UI residue is reported:
  - continue with the same targeted method: inspect only the specific workflow page plus `frontend/lib/i18n.ts`
  - avoid translating dynamic API data or model prompt bodies unless explicitly desired by product

- `frontend/app/workflows/expression/page.tsx` now autosaves generated workflow state immediately after draft/final/consistency generation events, review routing actions, return-to-refine, and every successful Step 9 archive upload.
- Autosaves are silent, serialized through a queue, save complete `workflowState` snapshots via `stateOverride`, and log failures only to the browser console.
- Step 9 archive progress is now saved per image by removing archived images from `confirmedImages` and incrementing `archivedImageCount` before continuing.
- Verification: `npm run build` completed with 22 routes; `docker-compose up -d --build frontend` rebuilt/restarted the frontend container.
- `frontend/app/workflows/expression/page.tsx` Step 7 now supports per-image and batch `精修`, `直接通过`, `跳过`, and `删除`, with a `全选` checkbox and selected-count batch toolbar.
- `Step 7` direct-pass now appends into `confirmedImages` without replacing existing confirmed items; `跳过` and `删除` only remove from `toRefineImages`.
- Step 7 `下一步` no longer blocks on unfinished refine items, so Step 8 can be entered while leftovers remain.
- Verification: `node --test frontend/lib/asset-grid.test.ts frontend/lib/asset-categories.test.ts frontend/lib/expression-workflow.test.ts` passed 48 tests; `npm run build` completed with 22 routes; `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `backend/app/routers/assets.py` now exposes `GET /api/assets/stats`, returning asset image counts as `{ total, by_category }`.
- `frontend/app/assets/page.tsx` loads those stats and displays category filter labels like `全部 (168)`, `表情 (90)`, with smaller/lighter count text and existing selected-state highlighting.
- Asset stats refresh after upload, delete, and batch migration.
- Verification: backend tests passed 65 tests; frontend asset/category/workflow tests passed 46 tests; `npm run build` completed with 22 routes; `docker-compose up -d --build backend frontend` rebuilt/restarted containers; `/assets`, `/docs`, and authenticated `/api/assets/stats` smoke checks passed.
- Running Postgres received a universal asset-tag relation repair across all categories: every non-empty `assets.tags` value was split, missing same-name tags were created under the asset's actual `category`, and missing `asset_tag_relations` were inserted.
- Verification shows zero remaining asset/tag category mismatches; `game_content` has category-scoped tags, including `看牌紧张`.
- `backend/app/routers/assets.py` upload and edit paths were checked and are category-dynamic: upload uses the submitted asset category, while `PATCH /api/assets/{id}/tags` uses the asset's actual current category.
- Backend tests now cover `game_content` upload and tag edit behavior; full backend tests passed 64 tests. Backend was rebuilt with `docker-compose up -d --build backend`; `/docs` returned HTTP 200, and authenticated `GET /api/assets/tags?category=game_content` returned `["看牌紧张"]`.
- `backend/app/routers/assets.py` adds `PATCH /api/assets/batch-move` for bulk asset category migration.
- Batch migration now also migrates source-category tag relations to same-name target-category tags, creating missing target tags while retaining old category tags for other assets.
- `frontend/app/assets/page.tsx` adds `批量迁移` mode with card checkboxes, selected count, current-filter select-all, target category dropdown, confirm, and cancel controls.
- Migration select-all uses the currently loaded/filtered asset list, so it respects the active category/tag filter.
- Current verification: backend tests passed 64 tests; frontend migration/category/workflow tests passed 45 tests; `npm run build` in `frontend/` completed with 22 routes; `docker-compose up -d --build backend frontend` rebuilt/restarted containers; `GET http://localhost:3010/assets` and `GET http://localhost:8000/docs` returned HTTP 200.

Implemented the frontend foundation, build configuration, and page batches:

- `frontend/lib/auth.ts`: token storage, login check, JWT payload decode.
- `frontend/components/layout/Topbar.tsx`: page title, user display, logout.
- `frontend/components/common/PageHeader.tsx`
- `frontend/components/common/StatCard.tsx`
- `frontend/components/common/ConfirmDialog.tsx`
- `frontend/components/tasks/TaskStatusBadge.tsx`
- `frontend/components/tasks/TaskTable.tsx`
- `frontend/components/image/ImageCard.tsx`
- `frontend/components/image/ImageGrid.tsx`
- `frontend/components/prompt/PromptEditor.tsx`
- `frontend/package.json`: Next.js 14 scripts and dependencies.
- `frontend/tsconfig.json`: standard App Router TypeScript config with `@/*` alias.
- `frontend/next.config.js`: basic Next config.
- `frontend/tailwind.config.js`: Tailwind content coverage for app, components, and lib.
- `frontend/postcss.config.js`: Tailwind and autoprefixer plugins.
- `frontend/app/globals.css`: global Tailwind entry stylesheet.
- `frontend/components/layout/AppShell.tsx`: route-aware shell; `/login` renders without Sidebar.
- `frontend/app/login/page.tsx`: username/password login form, token save, redirect to dashboard.
- `frontend/app/dashboard/page.tsx`: dashboard stats cards and chart placeholders.
- `frontend/app/tasks/page.tsx`: task list page using `TaskTable`.
- `frontend/app/tasks/create/page.tsx`: task creation form using scene and size constants.
- `frontend/app/tasks/[id]/page.tsx`: task detail view, status badge, image grid, available-model loading, model selector, and draft/final generation actions that submit `model_config_id`.
- `frontend/app/prompts/page.tsx`: prompt template table, inline create/edit form, delete confirmation.
- `frontend/app/assets/page.tsx`: asset category filter, batch upload with progress, upload-time category-scoped dropdown tag multi-select, custom Enter-created tags, concrete-category-only dropdown multi-tag filtering, backend-backed thumbnail URLs, asset grid, tag chips, delete confirmation.
- `frontend/app/review/page.tsx`: pending image review workflow with checklist, score, pass/reject submission.
- `frontend/app/gallery/page.tsx`: searchable final image grid, download, Prompt copy, and detail modal.
- `frontend/app/stats/page.tsx`: dashboard, daily cost, model, user, and image performance table areas.
- `frontend/app/admin/users/page.tsx`: user table, inline create form, enable/disable action.
- `frontend/app/admin/users/page.tsx`: per-user model permission panel with grant/revoke controls.
- `frontend/app/admin/api-keys/page.tsx`: API key table and inline create form.
- `frontend/app/admin/logs/page.tsx`: audit log table.
- `frontend/app/admin/models/page.tsx`: model configuration table, inline create/edit form, usage-type dropdown, toggle, and delete confirmation.
- `frontend/app/instructions/page.tsx`: workflow-scoped instruction library with workflow switching, list, inline create/edit, toggle, and delete confirmation.
- `frontend/app/workflows/expression/page.tsx`: 9-step expression-production wizard with full/direct-refine modes, task creation, instruction selection, reference asset selection, spec setup, draft generation, final refinement, consistency refinement, review confirmation, and asset archive flow.
- `frontend/app/workflows/expression/page.tsx`: Step 4 now uses an action list instead of an output-count dropdown. It starts with 4 blank rows, supports add/delete, labels rows as `第1张`, `第2张`, etc., and requires at least 1 filled action before Step 5.
- `frontend/app/workflows/expression/page.tsx`: Step 5 draft prompt preview and generation now use shared helpers from `frontend/lib/expression-workflow.ts`; all selected fixed prompts are joined, freeform prompt is appended intact, `{{action}}` is replaced with `见下方编号动作表`, and arrangement sentences containing `排列` or `一排` are removed before sending.
- `frontend/app/workflows/expression/page.tsx`: Step 5 sends one `POST /api/generate/image` request with `count` equal to the filled action count. The prompt asks for one numbered collage draft and requires each cell to show a clear numeric label matching the action-number table.
- `frontend/app/workflows/expression/page.tsx`: Step 5 summary includes the action-number table and a collapsible full preview of the numbered-collage prompt; stale drafts are cleared before generation; returned draft image(s) are displayed as collage reference material.
- `frontend/app/workflows/expression/page.tsx`: Step 6 full-flow mode now shows the Step 5 collage draft plus action-number table as a reference-only image area. It shows action rows with checkboxes, defaults all actions selected, and records choices in `workflowState.selectedActionIndices`.
- `frontend/app/workflows/expression/page.tsx`: Step 6 full-flow final generation no longer uses draft-image selection. It calls `POST /api/generate/image` once per selected action with the high-price model, `count: 1`, Step 3 reference assets, the refine prompt, and the selected action. If the refine prompt contains `{{action}}`, the selected action replaces that placeholder; otherwise `动作：{action}` is appended. Each finished image is appended immediately and labeled with its full action description.
- `frontend/app/workflows/expression/page.tsx`: Step 6 draft and final image displays are enlarged. The collage draft reference is at least 200x200, final result images are at least 240x240, action descriptions wrap without truncation, and clicking a draft/final image opens a full-screen preview that closes on overlay click or ESC.
- `frontend/app/workflows/expression/page.tsx`: Step 5 model choices are filtered to `draft`/`both`; Step 6 and Step 7 model choices are filtered to `final`/`both`; restored invalid model IDs are auto-synchronized to the current recommended model.
- `frontend/app/workflows/expression/page.tsx`: Step 7 consistency refinement preserves source selections/prompts when returning to Step 6, can reuse or reselect Step 3 reference assets with category/tag filtering, calls `POST /api/generate/image`, stores results in `workflowState.consistencyImages`, and feeds those results into Step 8 review alongside Step 6 final images.
- `frontend/app/workflows/expression/page.tsx`: Step 7 consistency generation now uses a 660000 ms frontend timeout and supports skipping a failed source image. The failure panel shows `跳过此图`, moves that source from `toRefineImages` into `confirmedImages`, removes related consistency results, and keeps skipped images available for Step 8 review / Step 9 archive.
- `frontend/lib/expression-workflow.ts`: added `skipRefineSourceImage()` to keep Step 7 skip behavior deterministic and covered by tests.
- `frontend/app/workflows/expression/page.tsx`: workflow draft persistence with `保存草稿`, silent autosave on step changes, `?session_id=xxx` restoration, and completed-session marking after archive.
- `frontend/app/workflows/expression/page.tsx`: Step 1 now has a category dropdown backed by `ASSET_CATEGORIES`, limited to `表情`, `动作`, `游戏内容`, and `节日形象`; the selected `workflowState.category` defaults Step 3 reference category loading and is submitted as the Step 9 archive category.
- `frontend/app/workflows/expression/page.tsx`: archive tags now mirror Step 1 task tags into `workflowState.taskTags`, initialize per confirmed image when entering Step 9, fill missing per-image defaults without overwriting edits, render a tag editor under each image, and submit each image's own `tags` field to `/api/assets/upload`.
- `frontend/lib/expression-workflow.ts`: archive-tag helpers normalize tags, create/merge per-image default archive-tag maps, and resolve image-specific tag overrides while preserving explicit empty tag lists.
- `frontend/app/workflows/page.tsx`: workflow task list with draft/completed tabs, full/direct-refine subtabs, continue/delete actions for drafts, and copy-to-new-draft actions for completed sessions.
- `frontend/lib/constants.ts`: Sidebar navigation now supports grouped children; `任务中心` contains `表情制作`.
- `frontend/lib/constants.ts`: `任务中心` now also contains `任务列表` at `/workflows`.
- `frontend/components/layout/Sidebar.tsx`: expandable/collapsible child navigation.
- `frontend/lib/api.ts`: shared `apiPut`, `apiPatch`, and `apiDelete` helpers.
- `backend/app/models/model_config.py`: ORM model for `model_configs`.
- `backend/app/models/model_config.py`: `usage_type` maps the intended model purpose (`draft`, `final`, `both`).
- `backend/app/schemas/model_config.py`: create/update/response schemas include `usage_type`; response masks API keys to last 4 characters.
- `backend/app/routers/model_configs.py`: model configuration create/list/update/delete/toggle endpoints.
- `backend/app/models/user_model_permission.py`: ORM model for `user_model_permissions`.
- `backend/app/schemas/user_model_permission.py`: permission grant/response schemas.
- `backend/app/routers/permissions.py`: grant/revoke/user-permission-list and available-model endpoints.
- `backend/app/models/instruction.py`: ORM models for `workflow_types` and `instructions`.
- `backend/app/schemas/instruction.py`: workflow type and instruction create/update/response schemas.
- `backend/app/routers/instructions.py`: workflow type list/create and instruction list/create/update/delete/toggle endpoints.
- `backend/app/models/workflow_session.py`: ORM model for persisted workflow drafts/completions.
- `backend/app/routers/workflow_sessions.py`: save/list/detail/delete endpoints for workflow sessions.
- `backend/app/schemas/generate.py`: image generation requests now include `model_config_id` and optional `mode` so the gateway can distinguish draft collage calls from final generation calls.
- `backend/app/routers/generate.py`: generation checks current-user permission for the selected model config before provider calls; admin bypasses this check. It also resolves `reference_asset_ids` and `draft_image_id` into image URLs and passes them to the gateway.
- `backend/app/services/ai_gateway.py`: generation loads `api_key`, optional `base_url`, `provider`, and `model_name` from `model_configs` instead of env API keys. Non-empty `base_url` means OpenAI-compatible relay regardless of provider, with normalized `/v1` paths; Gemini-style relays use `/chat/completions` for both text-only and reference-image generation. OpenAI-compatible image API models such as `gpt-image-2-all`, `gpt-image-2`, `gpt-image-1`, `chatgpt-image`, and `dall-e` bypass chat/completions: with reference images they use `{base_url}/images/edits` as `multipart/form-data` with `image[]` file parts, and without references they use `{base_url}/images/generations` JSON with `n=1`. The older `gpt-image-2-all` `/chat/completions` helper remains in code for fallback/reference but is no longer selected by normal `base_url` routing. The gateway downloads up to 2 reference images, compresses each with Pillow to JPEG at max 1024x1024/about 500KB before base64 encoding, sends relay references as `image_url` data URIs in multimodal chat content, loops once per requested `count` for non-draft chat relays, but calls draft chat relays only once when `mode == "draft"` and `count > 1` so prompt-controlled N-grid collage generation is stable. It logs individual relay-generation failures without discarding prior successes, parses relay image URLs or base64 images from `choices[].message.multi_mod_content`, `choices[].message.images`, and `choices[].message.content`, including Markdown image data URIs such as `![image](data:image/jpeg;base64,...)`, parses image API pure `b64_json` responses, saves base64 images with `chat-generated-{task_id}-{uuid}-{index}` filenames to avoid repeated same-task overwrites, uses a 600-second provider JSON timeout with 30-second HTTP 429 waits and 5/10-second retry backoff for other HTTP errors, falls back to text-only generation if downloads fail, and then updates `used_today`.
- `backend/app/main.py`: mounts configured local storage under `/static` for browser-accessible uploaded files.
- `backend/app/routers/assets.py`: accepts multipart file uploads and stores uploaded bytes before creating asset rows.
- `backend/app/services/storage_service.py`: returns `/static/...` URLs for stored task and asset files.
- `backend/requirements.txt`: includes `python-multipart` for FastAPI file uploads.
- `backend/app/models/asset_tag.py`: ORM model for category-scoped reusable asset tags and the `asset_tag_relations` join table.
- `backend/migrations/init.sql`: includes `asset_tags` with category, `(category, name)` uniqueness, and `asset_tag_relations`.
- `backend/app/routers/assets.py`: `GET /api/assets/tags`, upload-time tag creation/linking, and multi-tag intersection filtering for `GET /api/assets`.
- `backend/app/routers/assets.py`: upload metadata now accepts multipart form fields for `filename`, `category`, and `tags`, while keeping query-parameter compatibility.
- `backend/app/routers/assets.py`: tag management endpoints `POST /api/assets/tags/create`, `GET /api/assets/tags/manage`, `PATCH /api/assets/tags/{tag_id}`, and `DELETE /api/assets/tags/{tag_id}`.
- `backend/app/routers/assets.py`: existing asset tags can be edited through `PATCH /api/assets/{id}/tags`, which updates `assets.tags` and rebuilds `asset_tag_relations`.
- `frontend/app/assets/page.tsx`: existing asset cards have an inline `编辑标签` flow with category-scoped existing-tag choices, custom Enter-created tags, save/cancel controls, and live card updates through `PATCH /api/assets/{id}/tags`.
- `frontend/app/assets/tags/page.tsx`: tag management page with category switcher, rename, image count, and delete confirmation.
- `backend/migrations/init.sql`: includes `model_configs`.
- `backend/migrations/init.sql`: includes `model_configs.usage_type` and an idempotent `ALTER TABLE` for existing databases.
- `backend/migrations/init.sql`: includes `user_model_permissions`.
- `backend/migrations/init.sql`: includes `workflow_types`, `instructions`, and default `表情制作` / `expression`.
- `backend/migrations/init.sql`: includes `workflow_sessions`.
- `backend/app/utils/response.py`: preserves empty list payloads as `data: []`.
- `backend/app/routers/users.py`: API key create/list endpoints for admin API key page; list responses expose only the last 4 key characters.
- `backend/app/routers/stats.py`: image performance ranking endpoint backed by `publish_stats`.
- `frontend/app/stats/page.tsx`: image performance table now calls `/api/stats/images`.
- `docker-compose.yml`: E2E stack with frontend, backend, Postgres 16, Redis, and MinIO.
- `.env.example`: local development defaults for Docker E2E.
- `.env`: local Docker defaults; `FRONTEND_PORT=3010` because ports 3000 and 3001 are occupied locally.
- `backend/Dockerfile`: Python 3.11 slim backend image running Uvicorn.
- `frontend/Dockerfile`: Node 20 Alpine frontend image running Next.js.
- `backend/.dockerignore`
- `frontend/.dockerignore`
- `backend/app/routers/audit.py`: added explicit `datetime` import for Python 3.11 Docker runtime.
- `backend/app/routers/gallery.py`: added explicit `datetime` import for Python 3.11 Docker runtime.
- `frontend/app/page.tsx`: redirects `/` to `/dashboard`.
- Frontend array-shape hardening for API list data and component render boundaries:
  - `frontend/app/tasks/page.tsx`
  - `frontend/app/tasks/[id]/page.tsx`
  - `frontend/app/prompts/page.tsx`
  - `frontend/app/assets/page.tsx`
  - `frontend/app/gallery/page.tsx`
  - `frontend/app/review/page.tsx`
  - `frontend/app/stats/page.tsx`
  - `frontend/app/dashboard/page.tsx`
  - `frontend/app/tasks/create/page.tsx`
  - `frontend/app/admin/users/page.tsx`
  - `frontend/app/admin/api-keys/page.tsx`
  - `frontend/app/admin/logs/page.tsx`
  - `frontend/components/tasks/TaskTable.tsx`
  - `frontend/components/image/ImageGrid.tsx`
  - `frontend/components/prompt/PromptEditor.tsx`
  - `frontend/components/layout/Sidebar.tsx`
- `frontend/lib/constants.ts`: Sidebar nav includes `/admin/models` and `/instructions`.

## How To Verify

Run:

```bash
cd frontend
npm install
npm run build
```

Latest observed frontend result: `npm run build` compiled successfully and generated 22 routes after the Step 7 consistency-refinement wizard update.

Latest Step 7 skip-failure verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 36 tests.
- `npm run build` in `frontend/` completed successfully and generated 22 routes.
- `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; Compose also rebuilt/recreated backend due dependency handling.
- `docker-compose ps` showed frontend on `0.0.0.0:3010->3000/tcp` and backend on `0.0.0.0:8000->8000/tcp`, with db/redis/storage healthy.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.

Latest page-batch verification: `node --test frontend/lib/expression-workflow.test.ts` passed 11 tests covering model recommendation, usage-type filtering, asset query helpers, 9-step ordering, and Step 6/7 review image merging.

Latest backend reference-image verification: `PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 45 tests after switching OpenAI-compatible relays to `/chat/completions`, sending reference images as data-URI `image_url` parts, parsing relay URL/data-URI/raw-base64 image responses including aihubmix `multi_mod_content`, looping once per requested `count`, and adding model `usage_type` schema/ORM coverage.

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
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/workflows` returned HTTP 200.

Latest numbered-collage workflow verification:

- `node --test frontend/lib/expression-workflow.test.ts` passed 18 tests, including numbered-collage draft prompt generation, final single-action prompt generation, and stale-draft clearing.
- `node --test frontend/lib/model-config-form.test.ts` passed 3 tests.
- `npm run build` in `frontend/` completed successfully and generated 22 app routes.
- `docker-compose up -d --build frontend` rebuilt/restarted the frontend container successfully.
- `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- `GET http://localhost:3010/workflows` returned HTTP 200.

Latest live relay verification: after `docker-compose up -d --build backend`, `POST /api/generate/image` with model config `7` (`provider=google`, `base_url=https://aihubmix.com/v1`) and reference asset `18` returned HTTP 200 with `/static/task/5/draft/chat-generated-5-1.jpg`; fetching that URL returned HTTP 200 `image/jpeg`.

Latest relay count verification: `POST /api/generate/image` with `count=2` returned two images, `/static/task/5/draft/chat-generated-5-1.jpg` and `/static/task/5/draft/chat-generated-5-2.jpg`; both static URLs returned HTTP 200 `image/jpeg`.

Latest reference compression verification: after adding Pillow and rebuilding backend, a request with three selected reference asset IDs downloaded/sent only two compressed references. Backend log showed `Request payload size: 674558 bytes, images: 2`, reduced from the previous 9.1MB single-reference payload, and generation returned HTTP 200 with one image.

Latest frontend hardening verification: `npm run build` completed successfully with 17 app routes generated after adding array guards for API list data and `.map()` render paths.

Latest model configuration verification: `npm run build` completed successfully with 18 app routes generated, including `/admin/models`.

Latest permission UI verification: `npm run build` completed successfully with 18 app routes generated after adding the user model permission panel.

Latest generation model-config verification: `npm run build` completed successfully with 18 app routes generated after adding task-detail model selection.

Latest asset upload verification: `npm run build` completed successfully with 18 app routes generated after batch upload and static thumbnail URL support.

Latest asset tag verification: `npm run build` completed successfully with 18 app routes generated after upload tags, autocomplete, filter chips, and card tag chips.

Latest asset tag interaction verification: `npm run build` completed successfully with 18 app routes generated after hiding tag filters in the "全部" view and separating upload tag choices from filter tags.

Latest asset upload metadata fix verification: `npm run build` completed successfully with 18 app routes generated after switching frontend upload metadata to FormData-only submission.

Latest asset tag management verification: `npm run build` completed successfully with 19 app routes generated, including `/assets/tags`.

Latest asset tag dropdown redesign verification: `npm run build` completed successfully with 19 app routes generated after replacing upload/filter tag chips with dropdown multi-select controls and simplifying `/assets/tags` to rename/delete management.

Latest existing asset tag-edit verification: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 54 tests, including `PATCH /api/assets/{id}/tags` route registration and relation rebuild behavior; `npm run build` in `frontend/` completed successfully with 22 routes; `docker-compose up -d --build backend frontend` rebuilt/restarted both app containers; smoke uploaded a temporary expression asset, patched its tags, confirmed the response and tag list reflected the edited tags, then deleted the smoke asset and smoke tags; `GET http://localhost:3010/assets` returned HTTP 200.

Latest instruction library verification: `npm run build` completed successfully with 20 app routes generated, including `/instructions`.

Latest workflow session verification: `npm run build` completed successfully with 22 app routes generated, including `/workflows` and `/workflows/expression`.

Latest expression archive-tag verification: `node --test frontend/lib/expression-workflow.test.ts` passed 27 tests, including Step 1 task-tag defaults, per-image archive-tag initialization, missing-default merge without replacing edited image tags, and image-specific tag overrides; `npm run build` in `frontend/` completed successfully with 22 routes; backend upload smoke check confirmed multipart `tags` are returned on upload and appear in `GET /api/assets/tags?category=expression`; `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/workflows/expression` returned HTTP 200.

Latest expression prompt verification: `node --test frontend/lib/expression-workflow.test.ts` passed 21 tests, including Step 6 `{{action}}` replacement without duplicate action lines, cow-character locking, and enlarged Step 6 image grid classes; `npm run build` in `frontend/` completed successfully with 22 routes; `docker-compose up -d --build frontend` rebuilt/restarted the frontend container; `GET http://localhost:3010/workflows/expression` returned HTTP 200.

Docker E2E verification:

```bash
docker-compose up -d --build
curl --noproxy '*' -s -o /tmp/e2e-login.html -w '%{http_code}' http://localhost:3010/login
curl --noproxy '*' -s -o /tmp/e2e-docs.html -w '%{http_code}' http://localhost:8000/docs
curl --noproxy '*' -s -o /tmp/e2e-root.html -w '%{http_code} %{redirect_url}' http://localhost:3010/
```

Latest observed Docker E2E result:

- `docker-compose ps` shows `db`, `redis`, `storage`, `backend`, and `frontend` running.
- `db` is healthy.
- Backend logs show `DATABASE_HOST=db` and Uvicorn on `0.0.0.0:8000`.
- `http://localhost:8000/docs` returns HTTP 200.
- `http://localhost:3010/login` returns HTTP 200 with login page HTML.
- `http://localhost:3010/` returns HTTP 307 to `http://localhost:3010/dashboard`.

Port note: direct `localhost:3001` verification was not reliable because an unrelated local `AnythingL` process was already listening on IPv4 `127.0.0.1:3001`. The verified frontend host port is `3010`.

Latest frontend rebuild command:

```bash
docker-compose up -d --build backend frontend
```

Latest observed rebuild result:

- Backend and frontend images rebuilt successfully; Next.js generated 18 routes during the Docker build.
- `docker-compose ps` shows all five services running.
- `http://localhost:3010/admin/models` returns HTTP 200.
- `http://localhost:3010/admin/users` returns HTTP 200.
- `GET /api/model-configs` returns `data: []` when empty.
- Model config create/toggle/delete smoke check passed; create returned only the last 4 API key characters.
- Permission grant/revoke smoke check passed:
  - Admin `/api/model-configs/available` returns all active model configs.
  - Operator `/api/model-configs/available` returns no models before grant.
  - `POST /api/permissions/grant` grants access.
  - `GET /api/permissions/user/{user_id}` returns the granted model.
  - `DELETE /api/permissions/revoke` removes access.
- Generation integration smoke check passed without calling external AI providers:
  - Admin `/api/model-configs/available` includes a newly created active model config.
  - Operator `/api/generate/image` with that `model_config_id` returns HTTP 403 before grant.
  - Operator `/api/model-configs/available` includes the model after grant and excludes it after revoke.
  - `http://localhost:3010/tasks/1` returns HTTP 200.
- Asset upload smoke check passed:
  - `POST /api/assets/upload` accepted a multipart image upload.
  - The response returned `/static/assets/aiwb-smoke.svg`.
  - `http://localhost:8000/static/assets/aiwb-smoke.svg` returns HTTP 200 with `image/svg+xml`.
  - `http://localhost:3010/assets` returns HTTP 200.
- Asset tag smoke check passed:
  - Running Postgres was updated with `asset_tags` and `asset_tag_relations`.
  - `POST /api/assets/upload?...&tags=高兴` created a tagged asset.
  - `GET /api/assets/tags?category=bull_reference` returns `["高兴"]`.
  - `GET /api/assets?category=bull_reference&tags=高兴` returns the uploaded tagged asset.
  - `http://localhost:8000/static/assets/aiwb-happy.svg` returns HTTP 200 with `image/svg+xml`.
- Asset tag interaction smoke check passed:
  - `POST /api/assets/upload?...&category=expression&tags=高兴` created a tagged expression asset.
  - `GET /api/assets/tags?category=expression` returns `["高兴"]`.
  - `GET /api/assets?category=expression&tags=高兴` returns the uploaded tagged expression asset.
  - `http://localhost:3010/assets` returns HTTP 200 after rebuilding the frontend container.
- Asset upload metadata fix smoke check passed:
  - `POST /api/assets/upload` with multipart form fields `category=expression` and `tags=高兴,开心` returns an asset with `category: "expression"` and `tags: "高兴,开心"`.
  - `GET /api/assets/tags?category=expression` returns both `开心` and `高兴`.
  - `GET /api/assets?category=expression&tags=高兴` returns the uploaded `aiwb-form-tag-fix.png` asset with tags.
  - `http://localhost:8000/static/assets/aiwb-form-tag-fix.png` returns HTTP 200 with `image/png`.
  - `http://localhost:3010/assets` returns HTTP 200 after rebuilding backend and frontend containers.
- Asset tag persistence and management smoke check passed:
  - Running Postgres was updated with `asset_tags.category` and a `(category, name)` unique index.
  - `POST /api/assets/tags/create` creates a temporary persistent tag under `expression` with `image_count: 0`.
  - Uploading an image with that tag makes `GET /api/assets/tags/manage?category=expression` return `image_count: 1`.
  - Deleting the image leaves the tag available through `GET /api/assets/tags?category=expression`.
  - `GET /api/assets/tags/manage?category=expression` then returns the tag with `image_count: 0`.
  - `http://localhost:3010/assets/tags` returns HTTP 200.
- Instruction library smoke check passed:
  - Running Postgres was updated with `workflow_types` and `instructions`.
  - `GET /api/workflow-types` returns the default `expression` workflow type.
  - `POST /api/instructions/create` creates a temporary instruction.
  - `GET /api/instructions?workflow_type_id=...` returns that instruction.
  - The temporary smoke instruction was deleted.
  - `http://localhost:3010/instructions` returns HTTP 200.
  - API route inspection shows 53 API method/path pairs.
- Expression workflow smoke check passed:
  - `http://localhost:3010/workflows/expression` returns HTTP 200 after rebuilding the frontend container.
  - `http://localhost:3010/instructions` still returns HTTP 200.
- Workflow session smoke check passed:
  - Running Postgres was updated with `workflow_sessions`.
  - `POST /api/workflow-sessions/save` created a Step 3 full-flow draft.
  - `GET /api/workflow-sessions?workflow_type=expression&status=draft&mode=full` returned the saved session.
  - `GET /api/workflow-sessions/{id}` returned `state_json` containing the saved task name.
  - `http://localhost:3010/workflows` and `http://localhost:3010/workflows/expression?session_id=...` returned HTTP 200.
  - The temporary smoke session was deleted after verification.
- Asset tag dropdown redesign smoke check passed:
  - Running Postgres smoke tags matching `持久%` were deleted.
  - `POST /api/assets/upload` with multipart form fields `category=expression` and `tags=哭泣` returns an uploaded asset with `tags: "哭泣"`.
  - `GET /api/assets/tags?category=expression` includes `哭泣`.
  - `GET /api/assets?category=expression&tags=哭泣` returns the uploaded asset.
  - `http://localhost:3010/assets` and `http://localhost:3010/assets/tags` return HTTP 200 after rebuilding the frontend container.
- Expression workflow Step 6/7/8 review flow has changed:
  - Step 6 final images are now individually routed to `workflowState.confirmedImages` via `直接归档` or `workflowState.toRefineImages` via `需要精修`.
  - Step 6 next is blocked until all final images have been routed; it skips directly to Step 8 when `toRefineImages` is empty.
  - Step 7 uses only `toRefineImages` as the consistency refinement queue. Confirmed refinement results are appended to `confirmedImages` and remove their source from `toRefineImages`.
  - Step 8 reviews only `confirmedImages`; `退回精修` removes the image from `confirmedImages`, adds it to `toRefineImages`, and returns to Step 7.
  - Latest frontend checks: `node --test frontend/lib/expression-workflow.test.ts` passed 29 tests, `npm run build` completed successfully with 22 routes, `docker-compose up -d --build frontend` rebuilt/restarted containers, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Completed workflow re-entry has been added:
  - `/workflows` completed-session rows include `查看/补充归档`.
  - The link targets `/workflows/expression?session_id=...&step=9`.
  - The expression workflow reads a valid `step=N` URL parameter during session restore.
  - Step 9 can still archive remaining `confirmedImages` even when `workflowState.archived` is true; after successful archive, `confirmedImages` and legacy `confirmedFinalImageIds` are cleared before saving.
  - Latest frontend checks: `node --test frontend/lib/expression-workflow.test.ts` passed 31 tests, `npm run build` completed successfully with 22 routes, `docker-compose up -d --build frontend` rebuilt/restarted containers, and `GET http://localhost:3010/workflows` plus `GET http://localhost:3010/workflows/expression?session_id=1&step=9` returned HTTP 200.
- Step 8 multi-image review and Step 9 task stats have been updated:
  - Final/consistency generated images are assigned workflow-local unique ids before entering state, avoiding repeated provider ids collapsing Step 8 to one rendered image.
  - Step 8 renders the complete `workflowState.confirmedImages` queue.
  - Step 9 shows five summary cards: actions, drafts, final generated images, refined images, and archived images.
  - New counters: `finalGeneratedCount`, `refinedImageCount`, `archivedImageCount`.
  - Latest frontend checks: `node --test frontend/lib/expression-workflow.test.ts` passed 33 tests, `npm run build` completed successfully with 22 routes, `docker-compose up -d --build frontend` rebuilt/restarted containers, and `GET http://localhost:3010/workflows/expression` returned HTTP 200.
- Expression workflow generated-state autosave has been strengthened:
  - Step 5 draft completion, Step 6 per-image final completion, Step 7 per-image consistency completion, Step 6/7 routing actions, Step 8 return-to-refine, and Step 9 per-image archive success now enqueue silent saves.
  - Saves use full `workflowState` snapshots through `stateOverride`, including generated image URLs, `confirmedImages`, `toRefineImages`, `consistencyImages`, and archive counters.
  - Silent failures log to the browser console and do not block the user.
  - The frontend autosave queue serializes writes and reuses the latest session id to avoid stale-state/session duplication during rapid image routing.
  - Step 9 removes each successfully archived image from `confirmedImages` and increments `archivedImageCount` before continuing, so partial archive progress survives leaving the page.
  - Latest frontend checks: `npm run build` completed successfully with 22 routes, and `docker-compose up -d --build frontend` rebuilt/restarted containers.
- Pucoding image edit multipart compatibility has been added:
  - `get_image_field_name(base_url)` returns `image` for pucoding base URLs and `image[]` for apiyi/default relays.
  - `_call_image_edit` uses that field name when building multipart `files`.
  - Backend tests cover both the field-name helper and pucoding `gpt-image-2` multipart edit routing.
  - Verification at that point: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 56 tests, `docker-compose up -d --build backend` rebuilt/restarted backend, and `GET http://localhost:8000/docs` returned HTTP 200. Newer backend verification is 59 tests after the Gemini Markdown parsing and draft collage routing fixes.
- Gemini relay Markdown image parsing has been added:
  - OpenAI-compatible chat relay parsing now extracts `![image](data:image/...;base64,...)` from `choices[].message.content`.
  - Parser order is `multi_mod_content`, then `images`, then `content`, preserving existing aihubmix `multi_mod_content` behavior while covering apiyi Gemini Markdown output.
  - Verification at that point: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 58 tests, `docker-compose up -d --build backend` rebuilt/restarted backend, and `GET http://localhost:8000/docs` returned HTTP 200. Newer backend verification is 59 tests after the draft collage routing fix.
- Draft collage relay calls have been stabilized:
  - `/api/generate/image` now preserves `mode`, and OpenAI-compatible relay calls with `mode == "draft"` and `count > 1` make a single provider request instead of looping `count` times.
  - The single draft call accepts either one returned collage image or multiple returned base64/URL images; all parsed images are saved and returned.
  - Non-draft relay generation still loops per requested `count`.
  - Latest backend checks: `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests` passed 59 tests.
- `http://localhost:8000/docs` returns HTTP 200.

Manual DB migration note:

```bash
docker-compose exec db psql -U ai_workbench -d ai_workbench -c "CREATE TABLE IF NOT EXISTS model_configs (...);"
docker-compose exec db psql -U ai_workbench -d ai_workbench -c "CREATE TABLE IF NOT EXISTS user_model_permissions (...);"
docker-compose exec db psql -U ai_workbench -d ai_workbench -c "CREATE TABLE IF NOT EXISTS workflow_sessions (...);"
```

The local Docker database user is `ai_workbench`; `-U postgres` fails in this environment.

Important: the frontend container is not bind-mounted to local source. Use `docker-compose up -d --build frontend` after frontend source changes; `docker-compose restart frontend` alone can leave the container on old code.

Backend verification remains:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend .venv/bin/python -m unittest \
  backend.tests.test_base_layer \
  backend.tests.test_models \
  backend.tests.test_schemas \
  backend.tests.test_routers \
  backend.tests.test_services \
  backend.tests.test_main
```

Latest observed backend result: 59 tests pass.

## Suggested Next Step

Next recommended step: add an automated Docker E2E smoke script so this startup check can be rerun without manual curl/log inspection.

## Tag I18n Handoff

- 完成了什么：后端标签 i18n 改造已完成，包含 ORM / Schema / Router / translate 路由 / DB 迁移
- 下一步：执行前端指令②（`tag-display.ts` + `TagCombobox` + 两个标签管理页）
- 遗留：`fill-all` 补全接口部署后需手动调用一次；admin 账号密码待确认（401 阻断了接口冒烟）

## Tag I18n Frontend Handoff

- 完成了什么：前端标签双语改造已完成，包含 `frontend/lib/tag-display.ts`、`TagCombobox` 双字段创建，以及素材标签/成品图标签管理页双语表单
- 验证：`cd frontend && npm run build` 通过，当前前端路由数量为 31 条
- 遗留：`fill-all` 历史标签英文补全接口仍需部署后手动触发一次

## Language Switch Handoff

- 完成了什么：语言切换功能已完整接入，包含 `i18n.ts`、`LanguageContext.tsx`、`LanguageToggle.tsx`、Topbar 按钮和根布局 Provider
- 验证：`cd frontend && npm run build` 通过，当前前端路由数量为 31 条
- 补充：`AppShell` 已接入 `Topbar`，语言切换按钮现在在非登录页顶部可见
- 补充：`Sidebar` 已接入 `useLanguage`，侧边导航文案现在也会跟随语言切换
- 补充：`i18n.ts` 已补齐导航 key，`NAV_GROUPS` 标签不再因词条缺失而回退中文原文
- 补充：`layout.tsx` 现通过 `frontend/app/providers.tsx` 包装 `LanguageProvider`，客户端边界问题已修复

## First Batch Handoff

- 完成了什么：`dashboard` / `login` 已接入 `useLanguage`，页面内写死中文均改为 `t()`
- 验证：`cd frontend && npm run build` 通过，当前前端路由数量为 31 条
- 下一步：继续第二批 `assets` / `gallery` / `review` / `stats` / `prompts` / `instructions`

## Second Batch Handoff

- 完成了什么：`assets` / `gallery` / `review` / `stats` / `prompts` / `instructions` 已接入 `useLanguage`，页面中文文案已改为 `t()`
- 验证：`cd frontend && npm run build` 通过，当前前端路由数量为 33 条
- 下一步：继续第三批 `admin/*`

## Third Batch Handoff

- 完成了什么：`admin/*` 第三批已完成，`users` / `api-keys` / `models` / `logs` / `activity-templates` / `daily-post-templates` / `hotspot-import` / `share-instructions` 均已接入 `useLanguage`
- 词条状态：`frontend/lib/i18n.ts` 已补齐后台页面所需文案，并清理重复 key，当前可通过构建期类型检查
- 验证：`cd frontend && npm run build` 通过，当前前端路由数量为 32 条（含 `/_not-found`）；`docker-compose up -d --build frontend` 已执行完成
- 下一步：继续第四批 `workflows/*`
- 遗留：`fill-all` 历史标签英文补全接口部署后仍需手动触发一次

## Fourth Batch Upper Handoff

- 完成了什么：第四批上半已完成，`workflows/page`、`tasks/page`、`tasks/create/page`、`tasks/[id]/page`、`workflows/expression/page`、`workflows/activity/page` 已接入 `useLanguage`
- 词条状态：`frontend/lib/i18n.ts` 已补齐这 6 个页面当前使用到的 `t("...")` key，工作流上半页切换英文时不再回退中文原文
- 验证：`cd frontend && npm run build` 通过；普通页面路由 31 条，含 `/_not-found` 共 32 条；`docker-compose up -d --build frontend` 已执行完成
- 下一步：继续第四批下半 `workflows/background` / `daily-post` / `share` / `trending` / `trending-news`
- 遗留：`fill-all` 历史标签英文补全接口部署后仍需手动触发一次

## Fourth Batch Lower Handoff

- 完成了什么：第四批下半已完成，`workflows/background`、`daily-post`、`share`、`trending`、`trending-news` 已全部接入 `useLanguage`
- 词条状态：`frontend/lib/i18n.ts` 已补齐这 5 个页面当前使用到的全部 `t("...")` key，校验结果为 `NO_MISSING_KEYS`
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条；`docker-compose up -d --build frontend` 已执行完成
- 当前状态：前端导航、标签管理页、管理后台、任务页、全部工作流页都已接入双语，整体前端 i18n 改造完成
- 遗留：`POST /api/translate/tags/fill-all` 历史标签英文补全接口部署后仍需手动触发一次

## Shared Component Cleanup Handoff

- 完成了什么：`WhitespacePositionPicker`、`TagCombobox`、`assets/page.tsx` 的残留中文和标签显示链路已修复
- 具体结果：留白位置方向文案已随语言切换；`TagCombobox` 的 placeholder / 创建操作文字已接入 `t()`；`assets` 页的标签筛选、上传、编辑选项已改为通过 `getTagLabel(tag, lang)` 显示
- 词条状态：`frontend/lib/i18n.ts` 已补入这次修复所需方向词和 TagCombobox 交互文案
- 验证：`cd frontend && npm run build` 通过；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成
- 当前状态：前端双语改造现已覆盖页面级文案和共享组件级文案，`fill-all` 历史标签英文补全接口仍需部署后手动触发一次

## Assets Category Translation Handoff

- 完成了什么：`frontend/app/assets/page.tsx` 的分类 helper 已改为在组件内通过 `t()` 返回文案，修复了分类按钮相关链路回退中文的问题
- 具体结果：上传标签区分类名、素材卡片分类摘要、迁移目标分类下拉框现在都会跟随语言切换；尺寸按钮 `小 / 中 / 大` 的字典词条也已补齐
- 词条状态：`frontend/lib/i18n.ts` 新增了 `牛标准图`、`游戏内容`、`节日形象`、`热点运营`、`小`、`中`、`大` 等本次修复所需 key
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成

## Expression Step Title Handoff

- 完成了什么：`frontend/app/workflows/expression/page.tsx` 的步骤导航已改为使用组件内 `workflowSteps`，在渲染时通过 `t(label)` 翻译步骤名称
- 具体结果：步骤导航不再依赖模块级中文 `WORKFLOW_STEPS`；`WorkflowStepHeader` 继续通过 `t(STEP_TITLES[currentStep - 1])` 渲染当前步骤标题，因此顶部步骤条和页面标题现在都会跟随语言切换
- 词条状态：`frontend/lib/i18n.ts` 已补入 `任务基础信息`、`提示词配置`、`参考素材选择`、`规格设置`、`草稿生成`、`精修成品`
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成

## Workflow Category And Tags Handoff

- 完成了什么：工作流页面里剩余的静态分类 label 和 tag 显示链路已补齐双语渲染
- 具体结果：`expression/page.tsx` 的分类下拉已统一改为 `t(category.label)`，并把 tag 选项保留为对象后通过 `getTagLabel(..., lang)` 显示；`activity/page.tsx` 的参考图分类侧栏与标签列表也做了同样修复
- 覆盖范围：`daily-post/page.tsx`、`share/page.tsx`、`trending/page.tsx`、`trending-news/page.tsx`、`background/page.tsx` 中可见的 tag 按钮 / chip 也都已经切到 `getTagLabel(..., lang)`
- 词条状态：`frontend/lib/i18n.ts` 本次新增了转发工作流步骤 key：`选择转发类型`、`输入传播内容`、`图片语言`、`生成配置`、`生成图片 + 审核 QC`
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成

## Expression Step 4 Copy Handoff

- 完成了什么：`frontend/app/workflows/expression/page.tsx` Step 4 里残留的固定中文已全部接入 `t()`
- 具体结果：`尺寸`、`背景`、`白底PNG`、`透明背景`、`增加动作`、`第 N 张`、`当前有效动作 ... 个，将生成 ... 张草稿。` 已全部可跟随语言切换；Step 5 规格摘要中的背景文案也已同步修复
- 额外确认：`上一步 / 下一步` 不直接写在 `expression/page.tsx` 中，而是由 `StepLayout` 渲染，因此这次无需在本页调整
- 词条状态：`frontend/lib/i18n.ts` 已补入 `透明背景`、`增加动作`、`白底PNG`、`当前有效动作`、`个，将生成`、`张草稿。`
- 验证：`cd frontend && npm run build` 通过；构建路由表含 `/` 共 33 条，按既有业务口径普通页面 31 条、含 `/_not-found` 共 32 条；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成

## Workflow Bulk Scan Handoff

- 完成了什么：按指定范围对 `workflows/*`、`workflows/page.tsx`、`tasks/*` 做了全量中文扫描，并完成一轮集中批量修复
- 本轮重点结果：
  - `frontend/app/workflows/page.tsx` 的状态 / 模式 tabs、工作流类型、步骤进度和复制默认标题已接入 `t()`
  - `frontend/app/workflows/activity/page.tsx`、`background/page.tsx` 的错误提示、alt 文案、标签区域文案又补齐了一轮
  - `frontend/app/workflows/share/page.tsx`、`trending/page.tsx`、`trending-news/page.tsx` 的参考图区、步骤底部导航和部分固定提示已补入 `t()`
  - 之前完成的 `expression` / `daily-post` / 分类下拉 / tag label 修复仍然保留
- 词条状态：`frontend/lib/i18n.ts` 本轮新增了多组工作流词条，包括 `步`、`已选：`、`背景用途`、`场景类型`、`氛围`、`颜色风格`、`参考图（选填）`、`当前分类：`、`，最多选择 4 张参考图` 等
- 验证：`cd frontend && npm run build` 通过；`docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成
- 说明：按 `grep '[^\\x00-\\x7F]'` 的统计，各页面仍有较多非 ASCII 行；这是因为该指标会把热点分类、动作映射、标签常量、步骤 key 等中文源文本一并算入，不等同于仍有多少未包裹 `t()` 的界面文案

## Batch UI Cleanup Handoff

- 完成了什么：按截图问题一次性修复了 `activity`、`daily-post`、`trending`、`trending-news`、`share`、`admin/activity-templates`、`admin/share-instructions`、`gallery`、`assets/tags`、`gallery/tags` 这批页面的固定中文残留
- 关键结果：
  - `assets/tags` / `gallery/tags` 已正式接入 `useLanguage`，标签管理页可随语言切换
  - `activity` 模板分类按钮改为 `t(type.name)`；`admin/activity-templates` 的模板类型下拉、分类 tab 和类型列也同步改为翻译显示
  - `daily-post` 参考图区剩余固定文案已全部走 `t()`
  - `share`、`trending`、`trending-news`、`gallery` 本轮主要通过补齐 `i18n.ts` 精确 key 修复英文态显示
  - `frontend/lib/i18n.ts` 已新增标签管理、活动分类、转发类型、热点分类、成品图库目录等缺失词条，并清理了重复 key `选热点`
- 验证：
  - `cd frontend && npm run build` 通过
  - 路由表显示 33 条（包含 `/` 与 `/_not-found`）；按当前项目口径 app 页面数仍为 32
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成，前端容器已重建
- 遗留：
  - `fill-all` 历史标签英文补全接口部署后仍需手动触发一次
  - 若后续还有截图发现英文态残留，优先先查 `i18n.ts` 是否缺 exact key，再决定是否动页面代码

## Asset/Gallery Tag Label Handoff

- 完成了什么：修复了 `assets/page.tsx` 素材卡片标签 chip 和 `gallery/page.tsx` style tag 筛选在英文模式下仍显示中文的问题
- 关键结果：
  - `frontend/app/assets/page.tsx` 现在会按卡片 tag name 去当前已加载的 tag option 集合中查找对应对象，再通过 `getTagLabel(tagObj, lang)` 显示
  - 若素材卡片上的 tag 在当前 option 集合里找不到，仍会安全回退显示原始 tag name
  - `frontend/app/gallery/page.tsx` 现在把 gallery tags 保留为轻量对象 `{ name, name_en, name_zh }`，style tag 筛选 chip 和顶部“当前风格标签”摘要都已走 `getTagLabel(..., lang)`
- 验证：
  - `cd frontend && npm run build` 通过
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成
  - 路由表显示 33 条（包含 `/` 与 `/_not-found`）；按当前项目口径 app 页面数仍为 32

## Activity Template Bilingual Fields Handoff

- 完成了什么：给 Activity 模板补上了 `name_en` 和 `scenario_en`，覆盖了数据库、ORM、schema、router、管理页和工作流页
- 后端结果：
  - `backend/app/main.py` 的 `ensure_runtime_schema()` 已追加 `activity_templates.name_en` 与 `activity_templates.scenario_en`
  - `backend/app/models/activity_template.py` 已新增 ORM 字段
  - `backend/app/schemas/activity_template.py` 响应体已带双语字段；创建/更新请求链路已接入
  - `backend/app/routers/activity_workflows.py` 创建/更新入口会校验空 `name_en`
- 前端结果：
  - `frontend/app/admin/activity-templates/page.tsx` 已新增 `name_en` 必填、`scenario_en` 可选输入；英文模式列表标题优先显示 `name_en`
  - `frontend/app/workflows/activity/page.tsx` 模板卡片、已选模板、当前模板、使用场景英文模式下优先显示 `name_en / scenario_en`
- 验证：
  - Live DB schema confirmed: `name_en` 和 `scenario_en` 列已存在
  - 后端测试通过：`Ran 135 tests ... OK`
  - `docker-compose up -d --build backend` 已执行完成
  - `cd frontend && npm run build` 通过
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成

## Asset Selected Badge Handoff

- 完成了什么：复核了 `frontend/app/assets/page.tsx` 里的素材卡片「已选」badge
- 结果：源码中该位置已经是 `{t("已选")}`，无需再改业务代码
- 词条状态：`frontend/lib/i18n.ts` 已存在 `已选: { zh: '已选', en: 'Selected' }`
- 验证：
  - `grep -n '已选' frontend/app/assets/page.tsx` 命中 1 行
  - `cd frontend && npm run build` 通过
  - `docker-compose -f /Volumes/AIWork/projects/ai-image-workbench/docker-compose.yml up -d --build frontend` 已执行完成

## Final Bilingual Rollout Handoff

- 完成了什么：完整的中英文双语改造，覆盖基础设施、标签系统、Activity 模板，以及当前项目已接入的全部页面与共享组件
- 覆盖范围：
  - 基础设施：`i18n.ts`、`LanguageContext.tsx`、`providers.tsx`、`LanguageToggle.tsx`、`Topbar`、`Sidebar`、`AppShell`
  - 标签系统：`asset_tags` / `gallery_tags` 双语字段、`translate.py`、`tag-display.ts`、`TagCombobox`
  - Activity 模板：`activity_templates.name_en / scenario_en`，管理页与工作流页均已接入
  - 页面接入：dashboard、login、assets、gallery、review、stats、prompts、instructions、admin 页面、tasks 页面、全部 workflow 页面
- 遗留事项：
  1. 其他工作流模板表（如 share 指令、daily-post 模板等）如需双语，可参照 `activity_templates` 的做法补 `name_en` 类字段
  2. 新建 Activity 模板时需填写 `name_en`，当前已强制
  3. 新建标签时需填写英文名，当前已强制
- 下一步建议：按业务优先级继续推进其他模板表的双语字段，而不是继续扩展页面层 i18n 基础设施
