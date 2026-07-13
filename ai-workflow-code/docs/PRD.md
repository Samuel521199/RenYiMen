# AI 社媒图片生产工作台 — 产品需求文档

**文档版本**：v1.0  
**项目代号**：ai-image-workbench

---

## 一、项目目标

打造一套可多人协作、可远程操作、可统计成本、可沉淀资产的图片生产系统。

解决以下核心问题：
- 出图靠个人经验，不稳定
- Prompt 混乱，不可复制
- 素材散落，角色不统一
- 成本不可控，API Key 混用
- 同事协作困难
- 成品无法复盘，不知道哪张图真正有效

**定位**：图片生产管理系统 + AI 模型调度系统 + 内容资产系统 + 投放复盘系统

---

## 二、系统模块总览

| 编号 | 模块名称 | 说明 |
|------|----------|------|
| M1 | WebUI 工作台 | 前端主界面 |
| M2 | 用户权限中心 | 用户/角色/API Key 管理 |
| M3 | 任务管理中心 | 任务单驱动全流程 |
| M4 | 素材库系统 | 参考图资产管理 |
| M5 | Prompt 模板中心 | 模板版本管理与变量填充 |
| M6 | AI 模型网关系统 | 多模型调度、成本统计 |
| M7 | 审核与 Checklist 系统 | 人工审核与打分 |
| M8 | 成品图库系统 | 定稿存档与投放记录 |
| M9 | 数据统计系统 | 花费/成功率/ROI 分析 |
| M10 | 日志审计系统 | 操作记录与溯源 |

---

## 三、模块详细需求

### M1 WebUI 工作台

**页面清单**：

| 路径 | 页面 | 核心组件 |
|------|------|----------|
| `/login` | 登录 | 用户名、密码、登录按钮 |
| `/dashboard` | 首页看板 | 今日任务/花费/图片/待审核 四卡片；7日花费折线图；模型占比饼图 |
| `/tasks` | 任务中心 | 任务列表（ID/标题/场景/状态/成本/创建人）；创建/查看/出图/关闭 操作 |
| `/tasks/create` | 创建任务 | 标题、场景、尺寸、主题描述、预算 |
| `/tasks/[id]` | 任务详情 | 基础信息、Prompt展示、草图/定稿结果、审核记录、成本记录 |
| `/prompts` | Prompt 模板中心 | 模板列表（名称/类型/启用状态）；新建/编辑/删除 |
| `/assets` | 素材库 | 分类筛选（牛标准图/表情/动作/背景/道具）；上传/删除/标签筛选 |
| `/review` | 审核中心 | 图片预览、任务名、评分、通过/驳回、驳回原因 |
| `/gallery` | 成品图库 | 缩略图网格、标签/模型/成本/投放数据；下载/复制Prompt/查看历史 |
| `/stats` | 统计中心 | 每日花费/每用户花费/每模型花费/图片表现排行 |
| `/admin` | 管理员后台 | 用户管理、权限管理、API Key 管理、每日额度、系统日志 |

---

### M2 用户权限中心

**角色定义**：

| 角色 | 权限 |
|------|------|
| Admin | 全部权限，含用户管理、API Key 管理 |
| Operator | 创建任务、出图、下载 |
| Reviewer | 审核图片、打分、驳回 |
| Viewer | 只读查看成品图库 |

**功能**：用户 CRUD、角色分配、API Key 授权与每日额度控制、禁用用户

---

### M3 任务管理中心

任务单驱动全流程，状态机如下：

```
待创建 → 探索中 → 待选图 → 定稿中 → 待审核 → 已完成 → 已发布 → 已关闭
```

每个任务包含：标题、场景、尺寸、预算、描述、创建人、关联图片列表、成本汇总。

---

### M4 素材库系统

**素材分类**：牛标准图、表情图、动作图、服装规则、背景素材、道具素材、禁止变化清单

**功能**：上传、分类、标签、搜索、权限维护

---

### M5 Prompt 模板中心

**模板分类**：

| 类型 | 模板名 |
|------|--------|
| 低价探索（draft） | 场景模板、节日模板、广告模板 |
| 高价定稿（final） | 角色锁定模板、重绘模板、清细节模板 |

**功能**：变量插槽（`{{theme}}`、`{{scene}}`、`{{size}}`）、版本管理、一键生成 Prompt

---

### M6 AI 模型网关系统

**支持模型**：
- OpenAI GPT Image（gpt-image-1）
- Google Gemini Flash
- Midjourney（后续）
- Runway（后续）

**功能**：API 多 Key 池调度、Token 统计、成本换算（USD + token 双记录）、失败重试、返回图片 URL

---

### M7 审核与 Checklist 系统

**Checklist 项目**：
- [ ] 牛脸是否正确
- [ ] 手脚是否正常
- [ ] 是否有乱码文字
- [ ] 构图是否可投放
- [ ] 是否适合转视频
- [ ] 是否品牌统一

**功能**：人工打分（0-100）、驳回原因填写、自动记录问题标签

---

### M8 成品图库系统

**功能**：成品图存档、分类搜索、相似图检测、下载权限控制、投放记录绑定

---

### M9 数据统计系统

统计维度：每日花费、每用户花费、每模型花费、出图成功率、返工率、热门模板、高 ROI 图片

---

### M10 日志审计系统

记录：谁创建任务、谁调用模型、花费多少、下载了什么图、修改了什么模板

---

## 四、数据库核心表

```
users, roles, api_keys, tasks, task_images,
assets, prompt_templates, generation_logs,
review_logs, final_images, publish_stats,
daily_cost_stats, audit_logs
```

详细 DDL 见 `backend/migrations/init.sql`

---

## 五、技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React + Next.js (App Router) + TypeScript + Tailwind CSS |
| 后端 | FastAPI (Python) |
| 数据库 | PostgreSQL |
| 缓存 | Redis |
| 文件存储 | MinIO / 阿里云 OSS（本地开发用 `/storage/` 目录） |
| 任务队列 | Celery / RQ |
| 部署 | Docker + docker-compose |

---

## 六、模块接口对接规范

### 统一响应格式

所有接口必须返回：
```json
{
  "code": 0,
  "msg": "success",
  "data": {}
}
```

### 核心调用链

```
M1(创建任务) → POST /api/tasks/create
M3 → M5(构建Prompt) → POST /api/prompts/build { task_id, mode }
M5 → M6(发起生成) → POST /api/generate/image { task_id, model, prompt }
M6(返回) → { images: ["url1","url2"], token: 2300, cost: 0.22 }
M7(审核提交) → POST /api/review/submit { image_id, score, status, tags }
M8(存档) → POST /api/gallery/save-final
M9(统计) → GET /api/stats/daily | /api/stats/user | /api/stats/model
```

### 模块间调用规则

1. **禁止跨模块直连数据库**，必须走 HTTP API
2. **文件路径规范**：`/task/{task_id}/draft/` 和 `/task/{task_id}/final/`
3. **成本单位**：USD 美元 + token 数量双记录
4. **接口详细定义**见 `backend/app/main.py`
