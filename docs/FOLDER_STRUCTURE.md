# 目录结构说明

仓库根目录（节选）：

```text
WorkFlow/
├── .cursorrules              # Cursor / 团队约定（技术栈与架构原则）
├── .env.example              # 环境变量模板（本地复制为 .env）
├── .env.development.example  # Docker dev 场景示例（可选）
├── Dockerfile                # 多阶段：deps / development / production
├── docker-compose.yml        # profiles: dev（web-dev）、prod（web）
├── README.md
├── docs/
│   ├── ARCHITECTURE.md       # 动态表单与 RunningHub 解耦设计
│   └── FOLDER_STRUCTURE.md   # 本文件
├── public/                   # 静态资源（图片、favicon 等）
├── src/
│   ├── app/                  # Next.js App Router：路由、布局、页面
│   ├── components/
│   │   ├── ui/               # Shadcn 等通用无业务组件（CLI 生成后存放）
│   │   ├── forms/            # 动态表单组合、字段注册表
│   │   └── workflow/       # 工作流业务相关展示（卡片、步骤条等）
│   ├── hooks/                # 复用逻辑 hooks（如 useJobPolling）
│   ├── lib/                  # 与框架无关的工具、config、常量
│   ├── services/             # API 与外部服务；含 RunningHub 适配与 map 函数
│   ├── store/                # Zustand：工作流参数、会话 UI 状态等
│   └── types/                # TypeScript 类型：Schema、DTO、供应商类型分文件
├── next.config.ts
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

## 各目录职责简述

| 路径 | 职责 |
|------|------|
| `src/app` | 路由 segment、`layout.tsx`、`page.tsx`、route handlers（若使用） |
| `src/components/ui` | 按钮、输入等可复用原子组件 |
| `src/components/forms` | 由 Schema 驱动的表单布局与字段渲染 |
| `src/components/workflow` | 工作流场景下的组合 UI（仍保持展示为主） |
| `src/hooks` | 数据获取、订阅、媒体上传等可复用副作用封装 |
| `src/lib` | `config.ts`、日期/格式化、与 React 无关的纯函数 |
| `src/services` | `fetch` 封装、各 REST 资源、**供应商适配器** |
| `src/store` | 全局或跨页工作流参数状态 |
| `src/types` | 领域与 API 类型；供应商专用类型建议单独子目录 |

## 当前已包含的起步文件

| 文件 | 说明 |
|------|------|
| `src/types/workflow-schema.ts` | UI Schema 基础类型（与 Comfy/RunningHub 解耦） |
| `src/lib/config.ts` | 读取 `NEXT_PUBLIC_API_BASE_URL` 等运行时配置 |
| `src/services/api-client.ts` | 统一 `fetch`、超时、`ApiError` |
| `src/store/use-workflow-parameter-store.ts` | Zustand 示例：按字段 id 存参数 |

新增文件时优先归入上表对应目录，避免在 `app` 内堆积大段业务逻辑。
