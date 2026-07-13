"""
AI 社媒图片生产工作台 — FastAPI 后端入口
运行方式: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

app = FastAPI(
    title="AI Image Workbench API",
    description="AI 社媒图片生产工作台后端接口",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────
# 统一响应格式
# ─────────────────────────────────────────

def ok(data=None, msg="success"):
    return {"code": 0, "msg": msg, "data": data or {}}

def err(msg="error", code=1):
    return {"code": code, "msg": msg, "data": {}}


# ─────────────────────────────────────────
# M2 用户权限中心
# ─────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "operator"  # admin | operator | reviewer | viewer

class ApiKeyCreateRequest(BaseModel):
    provider: str           # openai | google | midjourney
    api_key: str
    daily_limit: float = 0  # USD，0 表示不限制


@app.post("/api/auth/login", summary="用户登录")
def login(req: LoginRequest):
    return ok({
        "token": "mock-jwt-token",
        "user": {"id": 1, "username": req.username, "role": "admin"},
    })


@app.get("/api/auth/me", summary="获取当前用户信息")
def get_me():
    return ok({"id": 1, "username": "admin", "role": "admin"})


@app.post("/api/users/create", summary="创建用户")
def create_user(req: UserCreateRequest):
    return ok({"id": 2, "username": req.username, "role": req.role})


@app.get("/api/users", summary="用户列表")
def list_users():
    return ok([])


@app.post("/api/api-keys/create", summary="添加 API Key")
def create_api_key(req: ApiKeyCreateRequest):
    return ok({"provider": req.provider, "daily_limit": req.daily_limit})


@app.get("/api/api-keys", summary="API Key 列表")
def list_api_keys():
    return ok([])


# ─────────────────────────────────────────
# M3 任务管理中心
# ─────────────────────────────────────────

class TaskCreateRequest(BaseModel):
    title: str
    scene: str              # Tongits | Pusoy | Payday | Holiday
    size: str               # 1080x1350 | 1080x1920 | 1200x628 | 1080x1080
    purpose: Optional[str] = None
    budget: float = 0       # USD
    description: Optional[str] = None

class TaskUpdateStatusRequest(BaseModel):
    # created | exploring | selecting | finalizing | reviewing | done | published | closed
    status: str


@app.post("/api/tasks/create", summary="创建任务")
def create_task(req: TaskCreateRequest):
    return ok({
        "id": 1001,
        "title": req.title,
        "scene": req.scene,
        "size": req.size,
        "budget": req.budget,
        "status": "created",
    })


@app.get("/api/tasks", summary="任务列表")
def list_tasks(status: Optional[str] = None):
    return ok([])


@app.get("/api/tasks/{task_id}", summary="任务详情")
def get_task(task_id: int):
    return ok({
        "id": task_id,
        "title": "菲律宾发薪日牛图",
        "scene": "Payday",
        "size": "1080x1350",
        "status": "created",
        "budget": 20,
        "description": "发薪日，牛在牌桌开心赢钱",
    })


@app.post("/api/tasks/{task_id}/status", summary="更新任务状态")
def update_task_status(task_id: int, req: TaskUpdateStatusRequest):
    return ok({"task_id": task_id, "status": req.status})


# ─────────────────────────────────────────
# M4 素材库系统
# ─────────────────────────────────────────

@app.post("/api/assets/upload", summary="上传素材")
async def upload_asset(
    file: UploadFile = File(...),
    category: str = "bull_reference",   # bull_reference | expression | action | background | props
    tags: Optional[str] = None,
):
    return ok({
        "filename": file.filename,
        "category": category,
        "tags": tags,
        "url": f"/storage/assets/{file.filename}",
    })


@app.get("/api/assets", summary="素材列表")
def list_assets(category: Optional[str] = None):
    return ok([])


@app.delete("/api/assets/{asset_id}", summary="删除素材")
def delete_asset(asset_id: int):
    return ok({"deleted": asset_id})


# ─────────────────────────────────────────
# M5 Prompt 模板中心
# ─────────────────────────────────────────

class PromptTemplateCreateRequest(BaseModel):
    name: str
    mode: str       # draft（低价探索）| final（高价定稿）
    content: str    # 支持变量 {{theme}} {{scene}} {{size}}
    active: bool = True

class PromptBuildRequest(BaseModel):
    task_id: int
    mode: str               # draft | final
    theme: Optional[str] = None
    scene: Optional[str] = None
    size: Optional[str] = None
    asset_ids: List[int] = []


@app.post("/api/prompts/create", summary="创建 Prompt 模板")
def create_prompt_template(req: PromptTemplateCreateRequest):
    return ok(req.model_dump())


@app.get("/api/prompts", summary="Prompt 模板列表")
def list_prompt_templates(mode: Optional[str] = None):
    return ok([])


@app.post("/api/prompts/build", summary="根据任务构建 Prompt")
def build_prompt(req: PromptBuildRequest):
    prompt = (
        f"A cartoon bull mascot in a Filipino social media gaming scene. "
        f"Theme: {req.theme}. Scene: {req.scene}. Target size: {req.size}. "
        f"No readable text, no watermark, no distorted limbs, no deformed face. "
        f"Bright, colorful, suitable for Facebook ad creative."
    )
    return ok({"task_id": req.task_id, "mode": req.mode, "prompt": prompt})


# ─────────────────────────────────────────
# M6 AI 模型网关系统
# ─────────────────────────────────────────

class ImageGenerateRequest(BaseModel):
    task_id: int
    model_provider: str     # openai | google | midjourney
    model_name: str         # gpt-image-1 | gemini-2.0-flash-preview-image-generation
    prompt: str
    size: str               # 1080x1350 等
    count: int = 4          # 每次生成张数
    reference_asset_ids: List[int] = []
    draft_image_id: Optional[int] = None  # 定稿时传入草图 ID


@app.post("/api/generate/image", summary="调用 AI 模型生成图片")
def generate_image(req: ImageGenerateRequest):
    return ok({
        "task_id": req.task_id,
        "model_provider": req.model_provider,
        "model_name": req.model_name,
        "images": [
            {"image_id": 1, "url": "/storage/task-drafts/mock-1.png", "type": "draft"},
            {"image_id": 2, "url": "/storage/task-drafts/mock-2.png", "type": "draft"},
        ],
        "token_used": 2300,
        "cost_usd": 0.22,
    })


@app.get("/api/generate/logs", summary="生成日志")
def list_generation_logs(task_id: Optional[int] = None):
    return ok([])


# ─────────────────────────────────────────
# M7 审核与 Checklist 系统
# ─────────────────────────────────────────

class ReviewSubmitRequest(BaseModel):
    image_id: int
    score: int              # 0-100
    status: str             # pass | reject
    reason: Optional[str] = None
    # 问题标签：bad_face | bad_limbs | garbled_text | bad_composition | off_brand
    tags: List[str] = []


@app.post("/api/review/submit", summary="提交审核结果")
def submit_review(req: ReviewSubmitRequest):
    return ok(req.model_dump())


@app.get("/api/review/pending", summary="待审核图片列表")
def list_pending_reviews():
    return ok([])


# ─────────────────────────────────────────
# M8 成品图库系统
# ─────────────────────────────────────────

class FinalImageSaveRequest(BaseModel):
    task_id: int
    image_id: int
    tags: List[str] = []
    suitable_for_video: bool = False
    video_prompt_note: Optional[str] = None


@app.post("/api/gallery/save-final", summary="存档成品图")
def save_final_image(req: FinalImageSaveRequest):
    return ok(req.model_dump())


@app.get("/api/gallery", summary="成品图库列表")
def list_gallery(keyword: Optional[str] = None):
    return ok([])


@app.get("/api/gallery/{image_id}", summary="成品图详情")
def get_gallery_image(image_id: int):
    return ok({"image_id": image_id})


# ─────────────────────────────────────────
# 投放数据记录
# ─────────────────────────────────────────

class PublishStatsRequest(BaseModel):
    image_id: int
    publish_date: str       # YYYY-MM-DD
    channel: Optional[str] = None  # facebook | tiktok | instagram
    likes: int = 0
    comments: int = 0
    shares: int = 0
    notes: Optional[str] = None


@app.post("/api/publish-stats/create", summary="记录投放数据")
def create_publish_stats(req: PublishStatsRequest):
    return ok(req.model_dump())


@app.get("/api/publish-stats", summary="投放数据列表")
def list_publish_stats(image_id: Optional[int] = None):
    return ok([])


# ─────────────────────────────────────────
# M9 数据统计系统
# ─────────────────────────────────────────

@app.get("/api/stats/dashboard", summary="首页看板统计")
def dashboard_stats():
    return ok({
        "today_tasks": 0,
        "today_cost_usd": 0,
        "today_images": 0,
        "pending_reviews": 0,
    })


@app.get("/api/stats/cost-daily", summary="每日花费统计")
def cost_daily():
    return ok([])


@app.get("/api/stats/model", summary="模型使用统计")
def model_stats():
    return ok([])


@app.get("/api/stats/user", summary="用户花费统计")
def user_stats():
    return ok([])


# ─────────────────────────────────────────
# M10 日志审计系统
# ─────────────────────────────────────────

@app.get("/api/audit-logs", summary="审计日志列表")
def list_audit_logs():
    return ok([])
