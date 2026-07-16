# AI 社媒工作台 — 完整接入文档

> 基于交付包 `ai-workbench-code-20260521.tar.gz` + `ai-workbench-data-20260510.tar.gz`  
> 本文档说明该系统的部署步骤、所需外部服务、注意事项，以及与现有 WorkFlow 项目的关系。

---

## 〇、已合并到 WorkFlow 统一平台（2026-05-21）

运营交付的 **AI 社媒工作台** 已集成进本仓库，与 RunningHub **AI 创作工作室** 共用一套 Next.js 前端与 NextAuth 登录。

| 模块 | 路由 | 说明 |
|------|------|------|
| AI 创作（WorkFlow 主界面） | `/studio` | RunningHub / 百炼 SKU 画廊与生成 |
| 社媒工作台（运营交付） | `/workbench/*` | 表情/活动图/视频流水线/素材库/成品库等 33 个页面 |
| API 代理 | `/api/workbench/*` | 转发至 FastAPI 后端 `ai-workflow-code/backend` |
| SSO | `/api/workbench/auth/sso` | NextAuth 会话 → Workbench JWT |

**架构：**

```
浏览器 → Next.js (WorkFlow) :3001
           ├─ /studio          → RunningHub 网关（Prisma DB）
           └─ /api/workbench/* → FastAPI :8000（Workbench DB + storage/）
```

**本地启动（开发）：**

```bash
# 1. 根目录 .env 增加（与 ai-workflow-code/.env 中 SECRET 保持一致）
WORKBENCH_BACKEND_URL=http://localhost:8000
WORKBENCH_SSO_SECRET=change-me-workbench-sso-secret

# 2. 启动 Workbench 后端（需 PostgreSQL + Redis，见 docker-compose.yml）
cd ai-workflow-code/backend && pip install -r requirements.txt
# 或使用：docker compose up workbench-backend workbench-db workbench-redis -d

# 3. 导入历史数据（可选）
psql ... -f ai-workflow-data/backup_20260510.sql

# 4. 启动 Next.js
npm run dev
```

**生产：** 使用根目录 `docker-compose.yml`，已包含 `workbench-backend`、`workbench-db`、`workbench-redis` 服务。

---

## 一、交付物说明

| 文件 | 大小 | 内容 |
|------|------|------|
| `ai-workbench-code-20260521.tar.gz` | ~14 MB | 完整源代码 + Docker 配置 + SQL 脚本 |
| `ai-workbench-data-20260510.tar.gz` | ~1.4 GB | 历史素材（storage/）+ 数据库备份 |

**代码包结构：**

```
ai-workbench/
├── frontend/              # Next.js 14 前端
├── backend/               # FastAPI 后端（Python）
│   ├── app/
│   │   ├── routers/       # 28 个 API 路由模块
│   │   ├── services/      # AI 网关、视频生成、存储等
│   │   └── models/        # 数据库 ORM 模型
│   └── migrations/
│       └── init.sql       # 建表脚本
├── docker-compose.prod.yml
├── .env.example
├── fix_urls.sql           # 部署后修复图片 URL
└── DEPLOY.md
```

**数据包结构：**

```
storage/
├── assets/     # 素材库（牛标准图、表情、背景等）  ~570 MB
├── task/       # 历史任务出图草稿               ~802 MB
├── video/      # 视频成品文件                   ~103 MB
└── logo/       # Logo 文件                      ~5 MB
backup_20260510.sql   # 完整数据库备份（含用户、素材记录、成品图库等）
```

---

## 二、系统架构

```
用户浏览器
    ↓
前端 (Next.js 14)  :3010
    ↓
后端 (FastAPI)     :8000
    ↓
┌──────────┬──────────┬──────────────┐
│          │          │              │
PostgreSQL  Redis      外部 AI API    阿里云 OSS
(数据持久化) (任务队列)  (见第三节)    (文件存储)
```

**服务组件（docker-compose.prod.yml）：**

| 容器 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| `frontend` | 自建 Next.js | 3001:3001 | Web 界面 |
| `backend` | 自建 FastAPI | 8000:8000 | REST API |
| `db` | postgres:16 | 内部 | 默认含内置 PG（可改为 RDS） |
| `redis` | redis:7-alpine | 内部 | 任务/缓存 |

---

## 三、外部 API 依赖（重要）

该系统使用 **3 类外部 AI API**，**API Key 均通过管理后台动态配置，无需写死环境变量**（除非使用 `.env` 初始化）。

### 3.1 OpenAI 图片生成 API

**用途：** 所有图片类工作流（表情、活动图、热点借势、日常贴文、分享图等）

| 项目 | 说明 |
|------|------|
| 接口地址 | `https://api.openai.com/v1`（或中转地址） |
| 认证方式 | `Authorization: Bearer <API_KEY>` |
| 使用模型 | `gpt-image-2`、`gpt-image-1`、`gpt-image-2-all`、`dall-e-3` 等 |
| 配置方式 | 管理后台 → 模型配置 → 新增 provider=`openai`，purpose=`image` |
| 环境变量 | `OPENAI_API_KEY`（可选初始值）、`OPENAI_BASE_URL`（支持中转） |

**调用逻辑：**
- 无参考图 → 调 `/v1/images/generations`
- 有参考图 → 调 `/v1/images/edits`
- 支持多参考图（最多 4 张）拼合

### 3.2 302.ai 视频生成 API（Kling 系列）

**用途：** 视频工作流（7步视频制作流程的草稿生成、精品生成）

| 项目 | 说明 |
|------|------|
| 接口地址 | `https://api.302.ai/ws/api/v3` |
| 认证方式 | `Authorization: Bearer <302.ai_KEY>` |
| 使用模型 | `kling_v2.6-std`（草稿）、`kling_v2.6`（精品/Kling O3 Pro） |
| 轮询地址 | `GET /ws/api/v3/predictions/{requestId}/result` |
| 配置方式 | 管理后台 → 模型配置 → 新增 provider=`kling_video`，purpose=`video` |
| 备注 | 交接文档提到 302.ai Key 曾泄露一次，**部署前务必更换新 Key** |

**调用逻辑（异步）：**
```
POST /ws/api/v3/{model_name}   →  返回 requestId
每隔 8s 轮询，最多 60 次（约 8 分钟超时）
GET /predictions/{requestId}/result  →  返回视频 URL
```

### 3.3 302.ai Gemini API（视频分析）

**用途：** 视频工作流 Step 3 "AI 自动提炼动作关键帧"功能

| 项目 | 说明 |
|------|------|
| 接口地址 | `https://api.302.ai/v1/chat/completions` |
| 使用模型 | `gemini-2.5-flash-nothink`（关闭思考模式节省 token） |
| 配置方式 | 管理后台 → 模型配置 → 新增 provider=`openai`，purpose=`video_analysis`，Base URL=`https://api.302.ai/v1` |
| 备注 | 约消耗 2153 tokens/次，分析草稿视频约 15 秒 |

### 3.4 API 关系汇总

```
图片类工作流（6个）  →  OpenAI API（或 OpenAI 兼容中转）
视频草稿生成        →  302.ai Kling kling_v2.6-std
视频精品生成        →  302.ai Kling kling_v2.6 (O3-pro)
视频动作分析        →  302.ai Gemini gemini-2.5-flash-nothink
标签翻译（中→英）   →  OpenAI API（gpt-4o-mini，自动调用）
```

---

## 四、服务器要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| 操作系统 | Ubuntu 20.04 | Ubuntu 22.04 LTS |
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 系统盘 | 40 GB SSD | 80 GB SSD |
| 网络端口 | 22、3010、8000 | 22、80、443 |

**必须预装：**
```bash
Docker 20.10+
docker-compose 1.29+
```

---

## 五、部署前准备清单

在开始部署前，必须先准备好以下全部内容：

### ✅ 必备项

| # | 需要什么 | 从哪里获取 |
|---|---------|----------|
| 1 | **OpenAI API Key**（或中转地址+Key） | 总部提供，或自行申请 |
| 2 | **302.ai API Key**（视频生成+分析） | 总部提供 / 302.ai 注册，**需确认未泄露** |
| 3 | **阿里云 OSS Bucket**（图片/视频存储） | 自行在阿里云控制台创建 |
| 4 | **PostgreSQL 实例**（推荐 RDS） | 自行在阿里云 RDS 创建 / 可先用 compose 内置 PG |
| 5 | **服务器 SSH 访问权限** | 运维提供 |

### OSS Bucket 创建要求

1. 地域：与服务器同地域（降低延迟）
2. 读写权限：**公共读**（图片/视频须能被浏览器直接访问）
3. 记录以下信息填入 `.env`：

```
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET_NAME=           # 如 ai-workbench-sea
OSS_ENDPOINT=              # 如 oss-ap-southeast-1.aliyuncs.com
OSS_PUBLIC_URL=            # 如 https://ai-workbench-sea.oss-ap-southeast-1.aliyuncs.com
```

### RDS PostgreSQL 配置要求（如用 RDS）

- 版本：PostgreSQL 14+
- 账号名：`ai_workbench`，数据库名：`ai_workbench`，字符集：UTF8
- 白名单：添加服务器公网 IP

---

## 六、完整部署步骤

### Step 1：上传文件到服务器

```bash
# 在本地执行（替换 user 和 SERVER_IP）
scp ai-workbench-code-20260521.tar.gz user@SERVER_IP:~/
scp ai-workbench-data-20260510.tar.gz user@SERVER_IP:~/
```

### Step 2：服务器解压

```bash
ssh user@SERVER_IP

mkdir -p ~/ai-workbench
tar -xzf ai-workbench-code-20260521.tar.gz -C ~/ai-workbench
cd ~/ai-workbench

# 解压数据包（素材 + 数据库备份）
tar -xzf ~/ai-workbench-data-20260510.tar.gz -C ~/ai-workbench

# 验证目录结构
ls storage/
# 期望看到：assets/  task/  video/  logo/
ls backup_20260510.sql
```

### Step 3：配置环境变量

```bash
cd ~/ai-workbench
cp .env.example .env
nano .env
```

**必填的环境变量：**

```env
# ── 数据库 ──────────────────────────────────────────────
# 方案A：使用 compose 内置 PostgreSQL（快速启动）
DATABASE_URL=postgresql+asyncpg://ai_workbench:ai_workbench@db:5432/ai_workbench

# 方案B：使用阿里云 RDS（生产推荐）
# DATABASE_URL=postgresql+asyncpg://ai_workbench:密码@RDS地址:5432/ai_workbench

# ── 安全 ────────────────────────────────────────────────
SECRET_KEY=              # 执行 openssl rand -hex 32 生成，务必修改

# ── 前端 API 地址 ────────────────────────────────────────
NEXT_PUBLIC_API_BASE=http://YOUR_SERVER_IP:8000
PUBLIC_BACKEND_URL=http://YOUR_SERVER_IP:8000

# ── 文件存储 ─────────────────────────────────────────────
# 方案A：先用本地存储（快速验证）
STORAGE_TYPE=local

# 方案B：使用阿里云 OSS（生产推荐）
# STORAGE_TYPE=oss
# OSS_ACCESS_KEY_ID=
# OSS_ACCESS_KEY_SECRET=
# OSS_BUCKET_NAME=
# OSS_ENDPOINT=
# OSS_PUBLIC_URL=

# ── AI API（可选，也可在管理后台动态配置）──────────────────
# OPENAI_API_KEY=         （图片生成，也可在管理后台添加模型配置）
# OPENAI_BASE_URL=        （可选，使用中转地址时填写）
```

> **提示：** AI API Key **不需要**写在 `.env` 里，可以全部在管理后台的「模型配置」页面动态添加。

### Step 4：初始化数据库

```bash
sudo apt install postgresql-client -y

# ── 如果是迁移部署（含历史数据，推荐）──────────────────────
psql "postgresql://ai_workbench:密码@RDS地址:5432/ai_workbench" \
  -f ~/ai-workbench/backup_20260510.sql

# ── 如果是全新部署（只建表，无历史数据）──────────────────────
# psql "..." -f ~/ai-workbench/backend/migrations/init.sql
```

> **注意：** 使用 compose 内置 PostgreSQL 时，数据库会在 Step 5 启动后自动创建。  
> 但仍推荐连接后再跑 SQL：`psql "postgresql://ai_workbench:ai_workbench@localhost:5433/ai_workbench" -f backup_20260510.sql`

### Step 5：启动服务

```bash
cd ~/ai-workbench
docker-compose -f docker-compose.prod.yml up -d --build

# 等待约 1-2 分钟，查看启动状态
docker-compose -f docker-compose.prod.yml ps
```

**正常输出：**
```
NAME                       STATUS
ai-workbench-frontend      running
ai-workbench-backend       running
ai-workbench-db            running   # 仅使用内置 PG 时
ai-workbench-redis         running
```

**查看后端日志确认启动成功：**
```bash
docker-compose -f docker-compose.prod.yml logs backend | tail -20
# 应看到：
# STORAGE_TYPE=local（或 oss）
# DATABASE_HOST=...
# INFO:     Application startup complete.
```

### Step 6：修复图片 URL（含历史数据时必做）

```bash
# 替换 SQL 文件中的占位 IP
sed -i 's/YOUR_SERVER_IP/你的服务器IP/g' ~/ai-workbench/fix_urls.sql

# 执行修复
psql "postgresql://ai_workbench:密码@RDS地址:5432/ai_workbench" \
  -f ~/ai-workbench/fix_urls.sql
```

> 该脚本将数据库中 `localhost:8000` 开头的图片/视频 URL 批量替换为服务器公网 IP。

### Step 7：创建第一个管理员账号

```bash
# 进入后端容器
docker-compose -f docker-compose.prod.yml exec backend sh

# 生成密码 hash（替换 your_password）
python3 -c "from app.utils.security import get_password_hash; print(get_password_hash('your_password'))"
# 复制输出的 hash 值

exit

# 写入数据库
psql "postgresql://ai_workbench:密码@RDS地址:5432/ai_workbench" -c "
INSERT INTO users (username, password_hash, is_admin, is_active, created_at)
VALUES ('admin', 'PASTE_HASH_HERE', true, true, NOW())
ON CONFLICT (username) DO NOTHING;
"
```

> 如果导入了备份数据，历史用户账号已存在，可跳过此步骤（或直接重置密码）。

### Step 8：配置 AI 模型（在管理后台完成）

浏览器访问 `http://YOUR_SERVER_IP:3010`，用 admin 账号登录后进入：  
**管理后台 → 模型配置 → 新增**

**图片类工作流至少需要 1 条配置：**

| 字段 | 值 |
|------|-----|
| 名称 | GPT Image（随意填） |
| Provider | `openai` |
| 模型名称 | `gpt-image-2` 或 `gpt-image-2-all` |
| API Key | 你的 OpenAI Key |
| Base URL | 留空（直连）或填中转地址 |
| Purpose | `image` |
| 状态 | 启用 |

**视频草稿生成：**

| 字段 | 值 |
|------|-----|
| Provider | `kling_video` |
| 模型名称 | `kling_v2.6-std` |
| API Key | 你的 302.ai Key |
| Base URL | `https://api.302.ai/ws/api/v3` |
| Purpose | `video` |
| Usage Type | `draft` |

**视频精品生成：**

| 字段 | 值 |
|------|-----|
| Provider | `kling_video` |
| 模型名称 | `kling_v2.6` |
| API Key | 你的 302.ai Key |
| Base URL | `https://api.302.ai/ws/api/v3` |
| Purpose | `video` |
| Usage Type | `final` |

**视频动作分析（AI 自动提炼关键帧）：**

| 字段 | 值 |
|------|-----|
| Provider | `openai` |
| 模型名称 | `gemini-2.5-flash-nothink` |
| API Key | 你的 302.ai Key |
| Base URL | `https://api.302.ai/v1` |
| Purpose | `video_analysis` |

### Step 9：验证部署

```bash
# 前端可访问
curl -s -o /dev/null -w "%{http_code}" http://YOUR_SERVER_IP:3010
# 期望：200

# 后端健康检查
curl -s http://YOUR_SERVER_IP:8000
# 期望：{"status":"ok","service":"ai-image-workbench-backend","version":"1.0.0"}

# 登录接口
curl -s -X POST http://YOUR_SERVER_IP:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}'
# 期望：返回含 token 的 JSON
```

---

## 七、素材文件迁移到 OSS（使用 OSS 存储时）

交付数据包中的 `storage/` 目录是文件系统存储，若要切换到 OSS，需要：

### 方案 A：先用本地存储，之后迁移（推荐）

1. 先以 `STORAGE_TYPE=local` 验证系统可用
2. 确认 OSS 配置正确后：

```bash
# 安装阿里云 ossutil 工具
# https://help.aliyun.com/document_detail/120075.html

# 批量上传 storage/ 到 OSS
ossutil cp -r ~/ai-workbench/storage/ oss://你的BUCKET名/

# 更新 .env：STORAGE_TYPE=oss
# 重启服务
docker-compose -f docker-compose.prod.yml restart backend
```

3. 在后台验证图片/视频是否可正常显示

### 方案 B：直接用本地存储（小规模部署可行）

将 `.env` 中保持 `STORAGE_TYPE=local`，图片通过后端静态服务 `/static/` 路径访问。  
需注意：磁盘空间（当前数据约 1.5GB）和服务器重启后的目录挂载（compose 已配置 `./storage:/storage`）。

---

## 八、系统功能模块说明

| 模块 | 路径 | 说明 |
|------|------|------|
| 首页看板 | `/dashboard` | 7日花费折线图、模型占比饼图 |
| 素材库 | `/assets` | 牛标准图、表情、背景、Logo 等分类管理 |
| 工作流-表情 | `/workflows/expression` | 表情图制作 |
| 工作流-活动图 | `/workflows/activity` | 活动主题图批量生成 |
| 工作流-日常贴文 | `/workflows/daily-post` | 日常社媒图文 |
| 工作流-分享图 | `/workflows/share` | 分享卡片类图片 |
| 工作流-热点借势 | `/workflows/trending` | 热点新闻配图 |
| 工作流-Logo水印 | `/workflows/logo` | 批量为成品图叠加 Logo |
| 工作流-视频制作 | `/workflows/video` | 7步视频工作流（首帧→草稿→动效→精品→字幕→合成→归档） |
| 成品图库 | `/gallery` | 归档的最终成品图，支持按类型/标签筛选 |
| 视频成品库 | `/videos` | 视频成品管理 |
| 管理-用户管理 | `/admin/users` | 创建账号、分配权限、重置密码 |
| 管理-模型配置 | `/admin/models` | 动态添加/修改 AI 模型的 Key 和地址 |

---

## 九、用户权限配置

部署完成后在管理后台创建操作账号：

**角色说明：**

| 角色 | 权限范围 |
|------|---------|
| `admin` | 全部功能，含用户管理和模型配置 |
| `operator` | 创建任务、出图、归档成品 |
| `reviewer` | 审核图片、打分 |
| `viewer` | 只读查看成品图库 |

**权限面板（每个用户可独立配置）：**
- 各素材库/成品库的删除权限
- 左侧导航模块可见性（哪些工作流可见）
- 管理后台页面可见性

---

## 十、Nginx 反代配置（有域名或需要 80/443 端口时）

```nginx
server {
    listen 80;
    server_name your-domain.com;   # 或直接写服务器 IP

    # 前端
    location / {
        proxy_pass http://localhost:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 500m;      # 视频上传需要大 body
        proxy_read_timeout 600s;         # AI 生成耗时较长（视频最长约 8 分钟）
        proxy_connect_timeout 60s;
    }

    # 后端静态文件（本地存储模式）
    location /static/ {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
    }
}
```

配置后将 `.env` 中的地址改为域名：
```env
NEXT_PUBLIC_API_BASE=http://your-domain.com/api
PUBLIC_BACKEND_URL=http://your-domain.com/api
```

---

## 十一、当前已知待完成项

根据交接文档（`docs/HANDOFF_2.md`），以下功能**代码已存在但未完全完成**：

| 功能 | 状态 | 说明 |
|------|------|------|
| 音频素材库 | ❌ 未完成 | 等待 API Key 接入音频服务 |
| 中文字幕字体 | ⚠️ 未处理 | FFmpeg 合成字幕时需指定中文字体文件 |
| 程序动效（Step 51）| ⚠️ 已实现未测试 | 视频工作流某步骤动效功能 |

---

## 十二、与 WorkFlow 项目的关系

**两个系统已在同一 Next.js 应用中合并运行**，共享登录壳层，后端仍分两套：

| 对比维度 | AI 社媒工作台（/workbench） | AI 创作工作室（/studio） |
|---------|---------------------------|-------------------------|
| 前端 | 已迁入 `src/app/(platform)/workbench/` | `WorkflowStudio` |
| 后端 | FastAPI（`ai-workflow-code/backend`） | Next.js API Routes + Provider 适配器 |
| 数据库 | PostgreSQL `ai_workbench` | PostgreSQL `workflow`（Prisma） |
| AI 上游 | OpenAI + 302.ai（Kling/Gemini） | RunningHub + 阿里云百炼 |
| 用户体系 | Workbench JWT（SSO 自动同步） | NextAuth + 积分 |

如需独立部署 Workbench，仍可参考下文第五～八节的原版 Docker 步骤。

---

## 十三、日常运维命令

```bash
# 查看所有服务状态
docker-compose -f ~/ai-workbench/docker-compose.prod.yml ps

# 查看实时日志
docker-compose -f ~/ai-workbench/docker-compose.prod.yml logs -f

# 只看后端日志
docker-compose -f ~/ai-workbench/docker-compose.prod.yml logs -f backend

# 重启某个服务
docker-compose -f ~/ai-workbench/docker-compose.prod.yml restart backend

# 代码更新后重建
docker-compose -f ~/ai-workbench/docker-compose.prod.yml up -d --build

# 数据库备份
pg_dump "postgresql://ai_workbench:密码@RDS地址:5432/ai_workbench" \
  > backup_$(date +%Y%m%d_%H%M).sql

# 停止所有服务
docker-compose -f ~/ai-workbench/docker-compose.prod.yml down
```

---

## 十四、常见问题

**Q：前端显示「权限加载失败」红色提示**  
检查 `NEXT_PUBLIC_API_BASE` 是否填写正确的服务器 IP 和端口，后端是否正常运行。

**Q：图片/视频空白或 404**  
- 本地存储：检查 `storage/` 是否解压到项目根目录
- OSS 存储：检查 `OSS_PUBLIC_URL` 格式（末尾不加 `/`），Bucket 是否设为公共读

**Q：AI 图片生成失败**  
检查管理后台模型配置中 OpenAI API Key 是否有效，`base_url` 是否可访问。

**Q：视频生成任务卡着不动**  
检查 302.ai Key 是否有效（进入管理后台确认模型配置），查看后端日志：
```bash
docker-compose -f docker-compose.prod.yml logs backend | grep "video"
```

**Q：302.ai Key 疑似泄露**  
前往 [302.ai 控制台](https://302.ai) 立即更换 Key，然后在管理后台更新所有视频模型配置。

**Q：数据库连接失败**  
检查 RDS 白名单是否添加了服务器公网 IP，`DATABASE_URL` 中的用户名/密码/地址是否正确。

**Q：docker-compose 命令找不到**  
```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose
```

---

## 十五、部署前 Checklist

在正式上线前，逐项确认：

- [ ] 服务器满足配置要求（4核8G推荐）
- [ ] Docker + docker-compose 已安装
- [ ] **OpenAI API Key**（或中转）已获取
- [ ] **302.ai API Key** 已获取并确认未泄露（重新生成一个）
- [ ] 阿里云 OSS Bucket 已创建（公共读）
- [ ] PostgreSQL RDS 已创建并配置白名单（或先用内置 PG）
- [ ] 两个压缩包已上传到服务器
- [ ] `.env` 中 `SECRET_KEY` 已用 `openssl rand -hex 32` 生成新值（不能用默认值）
- [ ] `NEXT_PUBLIC_API_BASE` 填写了正确的服务器 IP
- [ ] 数据库备份已成功导入
- [ ] `fix_urls.sql` 已执行（替换了 IP）
- [ ] 管理员账号已创建并可正常登录
- [ ] 管理后台已添加至少 1 条图片模型配置
- [ ] 管理后台已添加视频草稿 + 精品模型配置
- [ ] 测试图片生成工作流可正常出图
- [ ] 测试视频生成工作流可提交并轮询到结果

---

## 联系支持

遇到问题时，收集以下信息发给总部：

```bash
# 1. 服务状态
docker-compose -f ~/ai-workbench/docker-compose.prod.yml ps

# 2. 错误日志
docker-compose -f ~/ai-workbench/docker-compose.prod.yml logs --tail=50 > logs.txt

# 3. 环境变量（隐去密钥）
cat ~/ai-workbench/.env | sed 's/=.*/=***/'
```
