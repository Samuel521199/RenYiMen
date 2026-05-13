# Workflow Frontend

面向 **AI 工作流 SaaS** 的前端应用：将 ComfyUI / RunningHub 的复杂 JSON 工作流动态封装为图生视频、文生图等友好界面。技术栈遵循项目根目录 `.cursorrules`（Next.js App Router、TypeScript 严格模式、Tailwind CSS、Zustand、面向 Docker/K8s 的无状态部署）。

## 项目简介

- **Schema 驱动 UI**：表单由工作流输入 JSON Schema 动态生成，而非手写每个业务表单。
- **分层清晰**：展示组件、服务层（API）、状态（Zustand）与类型定义分离。
- **容器化**：默认提供多阶段 `Dockerfile` 与 `docker-compose.yml`，通过环境变量注入 API 地址等配置。

> **Shadcn UI**：尚未执行 `shadcn` 初始化；接入组件库时请运行官方 CLI 并将通用组件放在 `src/components/ui/`。

## 本地运行（不使用 Docker）

环境要求：**Node.js 20+**、**npm**。

```bash
cp .env.example .env
# 编辑 .env，将 NEXT_PUBLIC_API_BASE_URL 指向你的后端网关地址

npm install
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)。

其他脚本：

| 命令 | 说明 |
|------|------|
| `npm run build` | 生产构建 |
| `npm run start` | 启动生产构建产物（需先 `build`） |
| `npm run lint` | ESLint |

## Docker 启动指引

### 开发（热更新，`development` 阶段）

```bash
docker compose --profile dev up --build web-dev
```

- 源码通过卷挂载到容器，依赖使用命名卷 `web_node_modules` 缓存。
- 默认将 `NEXT_PUBLIC_API_BASE_URL` 设为 `http://host.docker.internal:8080`（便于容器内前端访问宿主机后端）。可在项目根目录创建 `.env` 覆盖：

```env
NEXT_PUBLIC_API_BASE_URL=http://your-backend:8080
WEB_PORT=3000
```

### 生产（`standalone` 镜像）

```bash
# 构建时注入浏览器可见的 API 基地址（Next.js 会将 NEXT_PUBLIC_* 打入客户端包）
set NEXT_PUBLIC_API_BASE_URL=https://api.example.com
docker compose --profile prod up --build web
```

Linux/macOS 可使用：

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.example.com docker compose --profile prod up --build web
```

说明：**在客户端代码中使用的 `NEXT_PUBLIC_*` 变量在构建阶段被内联**；若仅修改运行容器时的环境变量而不重新构建，客户端包内的地址不会变。服务端组件可单独使用运行时环境变量（后续在 `services` 层按需区分）。

### Kubernetes 提示

- 前端无状态：不依赖本地磁盘会话。
- 为 `NEXT_PUBLIC_API_BASE_URL` 提供构建时 CI 参数或 ConfigMap/Secret 注入构建流水线；运行时仅服务端变量可通过 Deployment `env` 注入。

## 文档

- [架构说明：动态表单与 RunningHub 解耦](docs/ARCHITECTURE.md)
- [目录结构说明](docs/FOLDER_STRUCTURE.md)

## 许可证

私有项目或未声明前，默认保留所有权利。
