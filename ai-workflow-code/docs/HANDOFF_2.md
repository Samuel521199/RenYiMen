# 交接文档 v3（2026-05-08）

## 当前状态
7步视频工作流全部实现并验证，核心流程可用。

## 上次会话未完成的事
- 程序动效（第 51 条）已实现未测试
- 中文字幕 FFmpeg 字体问题未处理

## 新会话需要优先做的
1. 测试第 51 条程序动效效果
2. 处理中文字幕字体（FFmpeg 需要指定字体文件）
3. 音频素材库（等 API key）

## 重要注意事项
- 302.ai key 已泄露一次，记得检查是否已更换
- test1 任务 `job_id=79f009c8-fb22-4776-bf70-edde4cfcdf59`
- 原始终稿 `56bee2e3`（有声音）是主要测试用的
- storage volume 已挂载，合成视频不会丢失

## Step 3 AI 自动提炼 Handoff

- 完成了什么：视频工作流 Step 3 新增 AI 全自动动作提炼模式，用户点击一个按钮即可由 Gemini 自动分析草稿视频并填充关键帧，无需手动标记
- 后端结果：
  - `backend/app/schemas/model_config.py` 的 `ModelPurposeType` 新增 `video_analysis` 枚举值
  - `backend/app/routers/video_motion.py` 新增 `POST /api/video/motion/auto-extract/{job_id}`：根据 model_config_id 查询 video_analysis 模型配置，下载草稿视频转 base64，调用 302.ai Gemini 兼容接口（`/v1/chat/completions`），解析 segments 并转换为 keypoints 格式返回
  - 使用模型：`gemini-2.5-flash-nothink`（关闭思考模式，节省 token，约 2153 tokens/次）
- 前端结果：
  - `frontend/app/admin/models/page.tsx` 的 `MODEL_PURPOSE_OPTIONS` 新增 `{ value: "video_analysis", zh: "视频分析", en: "Video Analysis" }`
  - `frontend/components/video/MotionExtractor.tsx` 新增 `jobId` / `modelConfigId` props、`handleAutoExtract` 函数、「✨ AI 自动提炼」按钮（视频播放器右上角 overlay 紫色按钮）、loading/error 状态、`LABEL_DISPLAY_MAP` 英文转中文+emoji 映射、关键帧列表和动作序列预览改为中文+emoji 主显示+英文副标题
  - `frontend/app/workflows/video/page.tsx` 新增 `analysisModelId` state，启动时请求 `GET /api/model-configs?purpose=video_analysis` 加载模型 ID，传给 Step 3 的 `MotionExtractor`
- 后台操作：需在管理后台「模型配置」页新增一条 purpose 为「视频分析」的配置，模型填 `gemini-2.5-flash-nothink`，Base URL 填 `https://api.302.ai/v1`，API Key 填 302.ai Key
- 验证：前端 `npm run build` 通过；后端 `py_compile` 语法检查通过；实测点击按钮约 15 秒后自动填充 5-6 个关键帧，时间轴标记点正确，动作序列和中文+emoji 显示正常

## Logo 水印工作流 + 多项修复 Handoff（2026-05-09）

### Logo 水印工作流（新功能）
- 新建 `backend/app/routers/logo_workflows.py`：
  - `POST /api/logo/apply`：Pillow 合成，支持多图批量叠加 PNG logo，位置/大小用相对百分比
  - `POST /api/logo/archive`：归档合成结果到 `final_images`（source_type=logo）
  - `GET /api/logo/download-zip`：多图打包 zip 下载
  - 路径映射用 `STORAGE_LOCAL_PATH` 环境变量，修复了 `/static/` 双重替换 bug
- `backend/app/routers/gallery.py` SOURCE_TYPES 新增 `{"code": "logo", "label": "有Logo图", "label_en": "With Logo"}`
- `backend/app/main.py` 注册 logo_router
- 新建 `frontend/app/workflows/logo/page.tsx`：3步工作流（选图→配置Logo→生成下载）
  - Step 1：成品图库多选（source_type + tag 筛选）
  - Step 2：Logo 素材选择 + 拖拽定位 + 大小滑块，多图用第一张做模板
  - Step 3：批量合成结果展示，单图预览/下载（fetch blob），一键 zip 下载，归档到成品图库
- `frontend/components/layout/Sidebar.tsx` 新增「Logo水印」入口
- 拖拽边界放开为 `-50` 到 `150`，允许 logo 贴边甚至部分超出

### Daily 工作流归档 Bug 修复
- 问题：多张图共用同一个 job，归档时都写入 `job.generated_image_url`（最后一张），导致成品图库重复
- 修复：`backend/app/schemas/daily_post.py` `DailyPostJobQC` 新增 `image_url` 字段
- 修复：`backend/app/routers/daily_post_workflows.py` 归档改用 `archive_url = req.image_url or job.generated_image_url`
- 历史重复数据已清理：DELETE 保留每组最早一条，清理后 17 条全部唯一

### 成品图库双语修复
- `backend/app/routers/gallery.py` SOURCE_TYPES 所有条目补 `label_en`
- `backend/app/routers/gallery.py` `get_gallery_categories` 返回 dict 加入 `label_en`
- `backend/app/routers/gallery.py` `/api/gallery/tags` 接口改为 join `gallery_tags` 表返回对象（含 `name_en`/`name_zh`），不再返回纯字符串数组
- `frontend/lib/gallery-browser.ts` `GalleryCategory` 新增 `label_en` 字段，`normalizeGalleryCategories` 解析时带入
- `frontend/app/gallery/page.tsx` 分类列表和标题改为按 `lang` 选择 `label` 或 `label_en`
- `frontend/components/layout/AppShell.tsx` 顶部标题接入 `useLanguage`，英文显示「AI Social Media Workbench」
- `frontend/lib/i18n.ts` 新增「🎬 视频成品库」带 emoji 的双语词条，修复 Sidebar 英文模式显示
## Logo 水印工作流 + 多项修复 Handoff（2026-05-09）

### Logo 水印工作流
- 新建 `backend/app/routers/logo_workflows.py`：`POST /api/logo/apply`（Pillow 多图批量叠加 PNG logo，位置/大小用 0-1 相对百分比）、`POST /api/logo/archive`（归档到 final_images source_type=logo）、`GET /api/logo/download-zip`（zip 打包下载）
- 路径映射用 `STORAGE_LOCAL_PATH` 环境变量，修复 `/static/` 双重替换 bug（改为 `str.replace(..., 1)` 只替换一次）
- `backend/app/routers/gallery.py` SOURCE_TYPES 新增 `{"code": "logo", "label": "有Logo图", "label_en": "With Logo"}`
- `backend/app/main.py` 注册 `logo_router`
- 新建 `frontend/app/workflows/logo/page.tsx`：3步工作流
  - Step 1：成品图库多选（source_type + tag 筛选，网格展示，蓝色边框+勾选角标）
  - Step 2：Logo 素材选择（category=logo）+ 拖拽定位（百分比坐标，边界 -50~150）+ 大小滑块，多图用第一张做模板
  - Step 3：批量合成结果，单图预览（modal）、单图下载（fetch blob）、一键 zip 下载、归档到成品图库
- `frontend/components/layout/Sidebar.tsx` 新增「Logo水印」导航入口
- `frontend/lib/i18n.ts` 新增 Logo 工作流相关词条

### Daily 工作流归档 Bug 修复
- 问题根因：多张图共用同一个 job，`generated_image_url` 只保存最后一张，归档时所有图都写同一个 URL
- `backend/app/schemas/daily_post.py` `DailyPostJobQC` 新增 `image_url: str | None = None`
- `backend/app/routers/daily_post_workflows.py` 改为 `archive_url = req.image_url or job.generated_image_url`
- 历史重复数据清理：执行 DELETE 保留每组 MIN(id)，清理后 17 条全部唯一

### 成品图库双语完整修复
- `backend/app/routers/gallery.py` SOURCE_TYPES 所有条目补 `label_en`，`get_gallery_categories` 返回 dict 加 `label_en`
- `backend/app/routers/gallery.py` `/api/gallery/tags` 从返回纯字符串数组改为 join `gallery_tags` 表，返回含 `name_en`/`name_zh` 的对象列表
- `frontend/lib/gallery-browser.ts` `GalleryCategory` 新增 `label_en`，`normalizeGalleryCategories` 带入
- `frontend/app/gallery/page.tsx` 分类列表和标题改为按 `lang` 选 `label`/`label_en`
- `frontend/components/layout/AppShell.tsx` 接入 `useLanguage`，顶部标题英文显示「AI Social Media Workbench」
- `frontend/lib/i18n.ts` 补「🎬 视频成品库」带 emoji 词条（constants.ts 中 label 含 emoji，需完整匹配）

### 模型选择器规范化
- `backend/app/routers/permissions.py` `/api/model-configs/available` 新增 `purpose: str | None = None` 参数，查询时 `if purpose: query = query.where(ModelConfig.purpose == purpose)`
- 6 个图片类工作流前端统一改为 `apiGet("/api/model-configs/available?purpose=image")`：expression、activity、daily-post、share、trending、trending-news
- 视频工作流保持不变（草稿用 `/api/model-configs/video?usage=draft`，精品用 `usage=final`，分析用 `purpose=video_analysis`）
- background 工作流保持不变（用独立的 `/api/background/available-models`）

## 首页看板图表 Handoff（2026-05-09）

- 完成了什么：实现首页看板两个占位图表，合并图片和视频花费数据
- 后端结果：
  - `backend/app/routers/stats.py` `/api/stats/cost-daily` 改为按 `stat_date` GROUP BY 合并多 provider 记录，同时 UNION 合并 `video_drafts.generation_cost`（按 `created_at` 日期聚合），返回最近7天升序数据
  - `backend/app/routers/stats.py` `/api/stats/model` 改为按 `model_name + model_provider` 分组（原为仅 model_provider），同时合并 `video_drafts` 视频花费，只返回 total_cost > 0 的模型
  - 新增 `VideoDraft` model 引用用于视频花费统计
- 前端结果：
  - `frontend/app/dashboard/page.tsx` 新增 recharts LineChart（7日花费折线图）和 PieChart（模型占比饼图）
  - 折线图：X轴显示 MM-DD 日期，Y轴金额4位小数，tooltip显示每日合计花费
  - 饼图：donut 样式（innerRadius=34, outerRadius=88），标签只在占比>5%时显示百分比，图例水平排列在底部，tooltip显示完整模型名和金额
  - 新增 `shortenModelName()` 函数：Kling/Gemini/GPT/ChatGPT 等长模型名转为短显示名，超20字符截断
  - 数据加载中显示「加载中」，无数据显示「暂无数据」
  - 容器高度 `h-80`，饼图卡片 `overflow-visible` 避免标签截断
- 验证：后端 py_compile OK，前端 npm run build 通过，实测5个模型正确显示，折线图7天数据完整
