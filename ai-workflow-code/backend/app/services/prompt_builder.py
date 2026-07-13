import re

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import _model_imports as _model_imports
from app.models.prompt import PromptTemplate
from app.models.task import Task
from app.schemas.prompt import PromptBuildResponse


VARIABLE_PATTERN = re.compile(r"{{\s*(theme|scene|size)\s*}}")


def render_template(template: str, variables: dict[str, str | None]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        value = variables.get(key)
        return str(value) if value is not None else match.group(0)

    return VARIABLE_PATTERN.sub(replace, template)


async def build_prompt(
    db: AsyncSession,
    task_id: int,
    mode: str,
    theme: str | None = None,
    scene: str | None = None,
    size: str | None = None,
) -> PromptBuildResponse:
    task_result = await db.execute(select(Task).where(Task.id == task_id))
    task = task_result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    template_result = await db.execute(
        select(PromptTemplate)
        .where(PromptTemplate.mode == mode, PromptTemplate.active.is_(True))
        .order_by(PromptTemplate.id.desc())
    )
    template = template_result.scalars().first()
    content = (
        template.content
        if template is not None
        else "Theme: {{theme}}. Scene: {{scene}}. Target size: {{size}}."
    )
    prompt = render_template(
        content,
        {
            "theme": theme or task.title,
            "scene": scene or task.scene,
            "size": size or task.size,
        },
    )
    return PromptBuildResponse(task_id=task_id, mode=mode, prompt=prompt)
