# AI 社媒工作台 — 海外部署交接文档

**版本**：v1.0  
**日期**：2026-05-21  
**交接方**：总部技术团队  
**接收方**：海外部署技术负责人

---

## 一、项目概述

AI 社媒工作台（ai-image-workbench）是一套多人协作的 AI 图片/视频生产系统，支持：

- 多工作流出图（表情制作、活动图、热点借势、视频制作等）
- 素材库管理（牛标准图、表情、背景等角色资产）
- 成品图库归档与统计
- 用户权限管理（模块级、工作流级权限控制）
- AI 模型调度（OpenAI GPT Image、Kling Video 等）

**用户角色**：

| 角色 | 权限 |
|------|------|
| 管理员（admin） | 全部权限，用户管理，模型配置 |
| 操作员（operator） | 创建任务、出图、归档 |
| 审核员（reviewer） | 审核图片、打分 |
| 查看者（viewer） | 只读查看成品图库 |

---

## 二、交付物清单

部署包共两个文件，存放于总部共享目录：

| 文件 | 大小 | 内容 |
|------|------|------|
| `ai-workbench-code-20260510.tar.gz` | ~14MB | 完整代码 + 部署配置 + SQL |
| `ai-workbench-data-20260510.tar.gz` | ~1.4GB | 历史素材文件（storage/）+ 数据库备份 |

**代码包内含：**
- `frontend/` — Next.js 前端
- `backend/` — FastAPI 后端
- `docker-compose.prod.yml` — 生产环境启动配置
- `.env.example` — 环境变量模板
- `fix_urls.sql` — 部署后修复图片 URL 的脚本
- `backend/migrations/init.sql` — 数据库表结构
- `DEPLOY.md` — 详细部署步骤文档

---

## 三、服务器要求

| 项目 | 最低要求 | 推荐 |
|------|----------|------|
| 操作系统 | Ubuntu 20.04 | Ubuntu 22.04 LTS |
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 系统盘 | 40 GB SSD | 80 GB SSD |
| 开放端口 | 22、3010、8000 | 22、80、443 |

**必须预装：**
- Docker 20.10+
- docker-compose 1.29+

---

## 四、部署前准备（需总部提供）

部署前请向总部索取以下信息，填入 `.env` 文件：

### 4.1 AI 模型 API Key

| 变量 | 说明 | 向谁申请 |
|------|------|----------|
| `OPENAI_API_KEY` | GPT Image 出图 | 总部提供 |
| `OPENAI_BASE_URL` | API 中转地址 | 总部提供（如用中转） |

### 4.2 阿里云 OSS（图片/视频存储）

需在阿里云控制台创建一个 OSS Bucket：

| 变量 | 说明 |
|------|------|
| `OSS_ACCESS_KEY_ID` | AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | AccessKey Secret |
| `OSS_BUCKET_NAME` | Bucket 名称（如 `ai-workbench-sea`） |
| `OSS_ENDPOINT` | 地域节点（如 `oss-ap-southeast-1.aliyuncs.com`） |
| `OSS_PUBLIC_URL` | 文件访问前缀（如 `https://ai-workbench-sea.oss-ap-southeast-1.aliyuncs.com`） |

**OSS Bucket 创建要求：**
- 地域：与服务器同地域（降低延迟）
- 读写权限：**公共读**

### 4.3 云数据库 PostgreSQL（RDS）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 格式：`postgresql://ai_workbench:密码@RDS地址:5432/ai_workbench` |

**RDS 配置要求：**
- 版本：PostgreSQL 14 或以上
- 账号名：`ai_workbench`
- 数据库名：`ai_workbench`
- 字符集：UTF8
- 白名单：添加服务器公网 IP

---

## 五、部署步骤

### Step 1：上传文件到服务器

```bash
# 在本地执行，替换 user 和 SERVER_IP
scp ai-workbench-code-20260510.tar.gz user@SERVER_IP:~/
scp ai-workbench-data-20260510.tar.gz user@SERVER_IP:~/
```

### Step 2：服务器解压

```bash
# SSH 登录服务器
ssh user@SERVER_IP

# 解压代码
mkdir -p ~/ai-workbench
tar -xzf ai-workbench-code-20260510.tar.gz -C ~/ai-workbench
cd ~/ai-workbench

# 解压数据（素材 + 数据库备份）
tar -xzf ~/ai-workbench-data-20260510.tar.gz -C ~/ai-workbench
ls storage/   # 应看到 assets/ task/ video/ 等目录
```

### Step 3：配置环境变量

```bash
cd ~/ai-workbench
cp .env.example .env
nano .env     # 按 Ctrl+X 保存退出
```

**必填项：**

```env
DATABASE_URL=postgresql://ai_workbench:YOUR_DB_PASSWORD@YOUR_RDS_HOST:5432/ai_workbench
SECRET_KEY=        # 执行 openssl rand -hex 32 生成
NEXT_PUBLIC_API_BASE=http://YOUR_SERVER_IP:8000
PUBLIC_BACKEND_URL=http://YOUR_SERVER_IP:8000
STORAGE_TYPE=oss
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET_NAME=
OSS_ENDPOINT=
OSS_PUBLIC_URL=
OPENAI_API_KEY=
OPENAI_BASE_URL=
```

### Step 4：初始化数据库

```bash
# 安装 psql 客户端
sudo apt install postgresql-client -y

# 导入历史数据（含素材、成品图、用户等）
psql "postgresql://ai_workbench:YOUR_DB_PASSWORD@YOUR_RDS_HOST:5432/ai_workbench" \
  -f ~/ai-workbench/backup_20260510.sql

# 如果是全新部署（不需要历史数据），只跑建表 SQL
# psql "..." -f ~/ai-workbench/backend/migrations/init.sql
```

### Step 5：启动服务

```bash
cd ~/ai-workbench
docker-compose -f docker-compose.prod.yml up -d --build

# 查看状态（等待约 1-2 分钟）
docker-compose -f docker-compose.prod.yml ps
```

正常输出：
```
NAME                    STATUS
ai-workbench-frontend   running
ai-workbench-backend    running
ai-workbench-redis      running
```

### Step 6：修复图片 URL

```bash
# 将文件里的 YOUR_SERVER_IP 替换为实际 IP
sed -i 's/YOUR_SERVER_IP/实际IP地址/g' ~/ai-workbench/fix_urls.sql

# 执行修复
psql "postgresql://ai_workbench:YOUR_DB_PASSWORD@YOUR_RDS_HOST:5432/ai_workbench" \
  -f ~/ai-workbench/fix_urls.sql
```

### Step 7：创建管理员账号

```bash
# 进入后端容器
docker-compose -f docker-compose.prod.yml exec backend sh

# 生成密码 hash（替换 your_password）
python3 -c "from app.utils.security import get_password_hash; print(get_password_hash('your_password'))"
# 复制输出的 hash

exit

# 写入数据库（替换 HASH 和连接信息）
psql "postgresql://ai_workbench:YOUR_DB_PASSWORD@YOUR_RDS_HOST:5432/ai_workbench" -c "
INSERT INTO users (username, password_hash, is_admin, is_active, created_at)
VALUES ('admin', 'PASTE_HASH_HERE', true, true, NOW())
ON CONFLICT (username) DO NOTHING;
"
```

### Step 8：验证

```bash
# 前端
curl -s -o /dev/null -w "%{http_code}" http://YOUR_SERVER_IP:3010
# 期望：200

# 后端
curl -s -X POST http://YOUR_SERVER_IP:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}'
# 期望：返回含 token 的 JSON
```

浏览器访问 `http://YOUR_SERVER_IP:3010`，用 admin 账号登录。

---

## 六、现有素材说明

数据包中包含总部积累的历史素材，解压后位于 `storage/` 目录：

| 目录 | 内容 | 大小 |
|------|------|------|
| `storage/assets/` | 素材库（牛标准图、表情、背景等） | ~570MB |
| `storage/task/` | 历史任务出图草稿 | ~802MB |
| `storage/video/` | 视频成品文件 | ~103MB |
| `storage/logo/` | Logo 文件 | ~5MB |

> 注意：素材文件部署后需迁移到 OSS 才能正常显示（Step 6 fix_urls.sql 只修复数据库 URL，文件本身需要单独上传到 OSS）。
>
> 临时方案：先不用 OSS，将 `STORAGE_TYPE=local` 写入 `.env`，服务器直接用本地 storage 目录，图片通过后端静态文件服务访问。待 OSS 配置好后再迁移。

---

## 七、用户管理说明

部署完成后，管理员可在「管理后台 → 用户管理」页面：

1. **新建操作员账号**：填写用户名、密码、角色
2. **分配模块权限**：控制每个用户可见的模块和工作流
3. **重置密码**：直接在页面重置任意用户密码

**权限面板说明：**
- 删除权限：素材库/成品图库/视频成品库各自独立控制
- 模块可见性：控制左侧导航哪些模块可见
- 任务中心：可单独授权每个工作流（表情/活动图/视频等）
- 管理后台：可控制哪些管理页面可见

---

## 八、日常运维

```bash
# 查看服务状态
docker-compose -f ~/ai-workbench/docker-compose.prod.yml ps

# 查看日志
docker-compose -f ~/ai-workbench/docker-compose.prod.yml logs -f

# 重启服务
docker-compose -f ~/ai-workbench/docker-compose.prod.yml restart

# 停止服务
docker-compose -f ~/ai-workbench/docker-compose.prod.yml down

# 代码更新后重建
docker-compose -f ~/ai-workbench/docker-compose.prod.yml up -d --build

# 数据库备份
pg_dump "postgresql://ai_workbench:PASSWORD@RDS_HOST:5432/ai_workbench" \
  > backup_$(date +%Y%m%d).sql
```

---

## 九、常见问题

**Q：前端显示「权限加载失败」红色提示**
检查 `NEXT_PUBLIC_API_BASE` 是否填写了正确的服务器 IP，后端服务是否正常运行。

**Q：图片/视频无法显示，显示空白或 404**
- 使用本地存储时：检查 `storage/` 目录是否解压到正确位置
- 使用 OSS 时：检查 `OSS_PUBLIC_URL` 格式，Bucket 是否设为公共读

**Q：AI 生成超时或失败**
检查 `OPENAI_API_KEY` 是否有效，`OPENAI_BASE_URL` 是否可访问（海外服务器直连 api.openai.com 可能需要确认网络）。

**Q：数据库连接失败**
检查 RDS 白名单是否添加了服务器公网 IP，`DATABASE_URL` 格式是否正确。

**Q：docker-compose 找不到命令**
```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose
```

---

## 十、联系支持

部署遇到问题时，请收集以下信息发给总部：

```bash
# 1. 服务状态
docker-compose -f ~/ai-workbench/docker-compose.prod.yml ps

# 2. 错误日志
docker-compose -f ~/ai-workbench/docker-compose.prod.yml logs --tail=50 > logs.txt

# 3. 环境变量（隐去密码和 Key）
cat ~/ai-workbench/.env | sed 's/=.*/=***/'
```

将以上输出截图或文件发给总部技术对接人。
