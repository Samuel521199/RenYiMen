# 项目关键文件路径

## 后端
- 主入口：`backend/app/main.py`
- 视频路由：`backend/app/routers/video_jobs.py`
- 草稿路由：`backend/app/routers/video_draft.py`
- 动作路由：`backend/app/routers/video_motion.py`
- 视频生成服务：`backend/app/services/video_generate_service.py`
- 模型配置路由：`backend/app/routers/model_configs.py`
- 视频模型：`backend/app/models/video.py`
- 视频 Schema：`backend/app/schemas/video.py`
- 设置：`backend/app/config.py`

## 前端
- 视频工作流页面：`frontend/app/workflows/video/page.tsx`
- 视频列表页：`frontend/app/videos/page.tsx`
- 管理后台模型配置：`frontend/app/admin/models/page.tsx`
- 工作流状态类型：`frontend/lib/video-workflow.ts`
- 国际化：`frontend/lib/i18n.ts`
- 常量（供应商/分类）：`frontend/lib/constants.ts`

## 视频组件
- Step 1: `frontend/components/video/FirstFramePicker.tsx`
- Step 2: `frontend/components/video/DraftExplorer.tsx`
- Step 3: `frontend/components/video/MotionExtractor.tsx`
- Step 4: `frontend/components/video/MotionFXConfig.tsx`
- Step 5: `frontend/components/video/FinalGenerator.tsx`
- Step 6: `frontend/components/video/PostProcessor.tsx`
- Step 7: `frontend/components/video/ExportArchiver.tsx`

## 数据库表
- `video_jobs`：视频任务主表
- `video_drafts`：草稿和终稿（`draft_type=draft/final`，`operation=null/compose_all`）
- `video_motion_data`：动作结构数据
- `model_configs`：模型配置（`purpose=video_draft/video_final`）
- `workflow_sessions`：工作流 session 持久化

## 存储路径
- 本地存储根目录：`./storage`（挂载到容器 `/app/storage`）
- 视频文件：`storage/video/{job_id}/`
- 资产文件：`storage/assets/`
- 静态访问：`http://localhost:8000/static/`

## API 关键端点
- 视频任务列表：`GET /api/video/jobs`
- 创建任务：`POST /api/video/jobs/create`
- 更新状态：`PATCH /api/video/jobs/{job_id}/status`
- 草稿生成：`POST /api/video/draft/generate`
- 草稿列表：`GET /api/video/draft/{job_id}/list`
- 草稿选择：`POST /api/video/draft/{job_id}/select/{draft_id}`
- 动作保存：`POST /api/video/motion/{job_id}`
- 多层合成：`POST /api/video/jobs/{job_id}/compose-all`
- 视频下载：`GET /api/video/jobs/{job_id}/download`
- 视频模型列表：`GET /api/model-configs/video?usage=draft|final`

## 302.ai Kling 视频模型
- Base URL：`https://api.302.ai/ws/api/v3`
- 草稿模型：`kwaivgi/kling-v2.6-std/image-to-video`（$0.21/条）
- 精品模型：`kwaivgi/kling-video-o3-pro/image-to-video`（$0.56/条）
- 提交：`POST {base_url}/{model_id}`
- 轮询：`GET {base_url}/predictions/{request_id}/result`
- 完成状态：`status=completed`，结果在 `data.outputs[0]`

## 关键设计决策
- 图片传输：base64（不需要公网 URL）
- 视频版本：`originalFinalId`（原始）/ `composedFinalId`（合成）分离
- 蒙版合成：Step 6 只预览，Step 7 点「合成全部效果」才执行 FFmpeg
- `draft_type`：`draft` = 草稿，`final` = 终稿
- `operation`：`null` = 原始，`compose_all` = 合成版本
