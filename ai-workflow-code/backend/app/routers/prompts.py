from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.prompt import PromptTemplate
from app.schemas.prompt import (
    PromptBuildRequest,
    PromptTemplateCreate,
    PromptTemplateResponse,
    PromptTemplateUpdate,
)
from app.services import prompt_builder
from app.utils.response import ok


router = APIRouter()


@router.post("/api/prompts/create")
async def create_prompt_template(
    req: PromptTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    prompt = PromptTemplate(
        name=req.name,
        mode=req.mode,
        content=req.content,
        active=req.active,
        created_by=req.created_by or int(current_user["id"]),
    )
    db.add(prompt)
    await db.commit()
    await db.refresh(prompt)
    return ok(PromptTemplateResponse.model_validate(prompt).model_dump(mode="json"))


@router.get("/api/prompts")
async def list_prompt_templates(
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(PromptTemplate).order_by(PromptTemplate.id.desc())
    if mode is not None:
        query = query.where(PromptTemplate.mode == mode)
    result = await db.execute(query)
    prompts = [PromptTemplateResponse.model_validate(prompt) for prompt in result.scalars().all()]
    return ok([prompt.model_dump(mode="json") for prompt in prompts])


@router.put("/api/prompts/{id}")
async def update_prompt_template(
    id: int,
    req: PromptTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    prompt = await _get_prompt(db, id)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(prompt, field, value)
    await db.commit()
    await db.refresh(prompt)
    return ok(PromptTemplateResponse.model_validate(prompt).model_dump(mode="json"))


@router.delete("/api/prompts/{id}")
async def delete_prompt_template(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    prompt = await _get_prompt(db, id)
    await db.delete(prompt)
    await db.commit()
    return ok({"deleted": id})


@router.post("/api/prompts/build")
async def build_prompt(
    req: PromptBuildRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    response = await prompt_builder.build_prompt(
        db,
        task_id=req.task_id,
        mode=req.mode,
        theme=req.theme,
        scene=req.scene,
        size=req.size,
    )
    return ok(response.model_dump(mode="json"))


async def _get_prompt(db: AsyncSession, prompt_id: int) -> PromptTemplate:
    result = await db.execute(select(PromptTemplate).where(PromptTemplate.id == prompt_id))
    prompt = result.scalar_one_or_none()
    if prompt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prompt not found")
    return prompt
