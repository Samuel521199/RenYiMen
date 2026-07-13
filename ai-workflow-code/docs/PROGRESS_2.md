# Progress 2

## aspectRatio 持久化修复 + 视频枚举动态化（2026-05-10 完成）

### Bug 修复
- `aspectRatio` 持久化：`page.tsx` 初始 state 补默认 `16:9`，session 恢复多分支补 `motionConfig.aspectRatio`，宽高比切换时同步 `setState` + `autoSave`

### 新功能
- 新建 `backend/app/routers/video_workflows.py`，新增 `GET /api/video/enums?type=emotion|action` 和 `POST /api/video/enums`
- `main.py` runtime schema 新建 `video_enum_configs` 表和唯一索引，注册 video_workflows router
- `page.tsx` 启动时加载 emotion / action 枚举并传入子组件
- `DraftExplorer.tsx` 情绪标签改为动态列表，支持「+ 自定义」内联新增
- `MotionExtractor.tsx` 动作标签改为动态列表，支持「+ 自定义」内联新增

### 验证
- 后端语法检查通过
- 前端构建通过（37 routes）
- 后端测试：162 tests OK
- 接口冒烟：GET emotion/action 均返回 200，POST 自定义新增后实时返回完整列表

## 用户权限管理（2026-05-10 完成）

### 后端
- `users` 表新增 `permissions` JSONB 字段（runtime schema + ORM + Pydantic schema）
- 新增接口：
  - `GET /api/users/me` — 当前登录用户信息
  - `POST /api/users/{user_id}/reset-password` — 管理员重置他人密码
  - `POST /api/users/me/change-password` — 用户自改密码（需验证旧密码）
  - `GET /api/users/{user_id}/permissions` — 读取用户权限
  - `PUT /api/users/{user_id}/permissions` — 更新用户权限（管理员账号拒绝修改）
- 管理员账号永远全开，普通用户默认全关

### 前端
- 新建 `frontend/lib/PermissionContext.tsx`：全局权限 Context，提供 `canDelete` / `canView` / `canViewWorkflow` / `canViewTemplate` / `canViewAdmin`
- `providers.tsx` 注册 `PermissionProvider`，登录 token 变化后自动加载权限
- `Sidebar.tsx` 按权限隐藏模块、工作流、模板、管理后台各入口；父级无权限时整组隐藏
- `admin/users/page.tsx` 新增：权限编辑内联面板（含全选/联动）、重置他人密码弹窗、修改我的密码弹窗
- `assets/page.tsx` 删除按钮改为受 `canDelete("assets")` 控制

### 验证
- 后端语法检查通过
- 后端测试：162 tests OK
- 前端构建通过（37 routes）

### Bug 修复（2026-05-10 补充）
- `PermissionContext.tsx` 原使用原生 `fetch("/api/users/me")` 未携带 token，改为 `apiGet("/api/users/me")` 走 `NEXT_PUBLIC_API_BASE` 并自动附带 Authorization header
- `users.py` 路由路径采用完整路径写法（`/api/users/me`），与 `main.py` 批量无 prefix 注册方式一致，无需修改
- 权限面板已验证：删除权限、模块可见性、任务中心、模版中心、管理后台五个区块均正常加载和勾选保存
