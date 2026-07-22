# Docker 镜像离线发布

适用于“本机构建镜像、导出 tar、人工上传服务器、服务器加载并重启”的发布方式。除非用户明确要求，自动化工具不负责上传服务器。

## 1. 本地构建

在仓库根目录 `D:\project\RenYiMen` 执行：

```powershell
docker compose build web workbench-backend
docker images | findstr /i "workflow-web workflow-workbench-backend"
```

根 Compose 显式指定了镜像名：

```powershell
docker save workflow-web:latest -o workflow-web.tar
docker save workflow-workbench-backend:latest -o workflow-workbench-backend.tar
```

如实际标签不同，以 `docker images` 输出为准。

## 2. 人工上传

将 tar 和服务器部署所需的 Compose、Prisma 迁移、Nginx 配置及环境文件上传到约定目录，例如 `/opt/workflow/`。环境文件必须单独安全传递，不能打进镜像或提交仓库。

## 3. 服务器加载与迁移

```bash
cd /opt/workflow
docker load -i workflow-web.tar
docker load -i workflow-workbench-backend.tar
docker compose --profile migrate run --rm migrate
docker compose up -d web workbench-backend nginx
```

只在存在新的主站 Prisma migration 时执行 migrate。Workbench 数据库变更按 `ai-workflow-code/backend/migrations/` 对应发布说明执行。

## 4. 发布验证

```bash
docker compose ps
docker compose logs --tail=200 web workbench-backend nginx
```

至少检查：

- Nginx 首页和 `/api/auth/session` 返回正常；
- `workbench-backend` 健康检查通过；
- `/studio` 与 `/workbench` 均可登录访问；
- 数据库迁移无失败；
- 生成任务能创建并轮询；
- 静态素材和 OSS/CDN URL 可访问。

## 5. 注意事项

- 前端源码变更必须重建 `workflow-web`，仅重启容器不会更新已打包页面。
- Workbench Python 代码或依赖变更必须重建后端镜像。
- 只修改服务端运行时环境变量通常不需重建，但要重建/重启受影响容器；构建期 `NEXT_PUBLIC_*` 变量变更必须重建 web。
- `docker compose up -d` 不会自动执行 `migrate` profile。
- 不要使用 `down -v`，否则可能删除数据库卷。
